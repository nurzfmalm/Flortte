import argparse
import math
import os
import shutil
import struct
import subprocess
import tempfile
import wave
from pathlib import Path


SAMPLE_RATE = 8000
FRAME_SIZE = 4096
HOP_SIZE = 1024
BPM = 120
TICKS_PER_BEAT = 480


def check_ffmpeg():
    if shutil.which("ffmpeg") is None:
        raise RuntimeError(
            "FFmpeg не найден. Установи его командой: winget install Gyan.FFmpeg"
        )


def mp3_to_wav(mp3_path, wav_path):
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(mp3_path),
        "-ac",
        "1",
        "-ar",
        str(SAMPLE_RATE),
        "-f",
        "wav",
        str(wav_path),
    ]

    result = subprocess.run(
        cmd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    if result.returncode != 0:
        raise RuntimeError("FFmpeg не смог прочитать MP3 файл")


def read_wav_mono(wav_path):
    with wave.open(str(wav_path), "rb") as wf:
        channels = wf.getnchannels()
        sample_width = wf.getsampwidth()
        rate = wf.getframerate()

        if channels != 1:
            raise RuntimeError("WAV должен быть mono")

        if sample_width != 2:
            raise RuntimeError("WAV должен быть 16-bit PCM")

        if rate != SAMPLE_RATE:
            raise RuntimeError("Неверная частота WAV")

        raw = wf.readframes(wf.getnframes())

    count = len(raw) // 2
    samples = struct.unpack("<" + "h" * count, raw)
    return [s / 32768.0 for s in samples]


def fft(values):
    n = len(values)
    j = 0

    for i in range(1, n):
        bit = n >> 1

        while j & bit:
            j ^= bit
            bit >>= 1

        j ^= bit

        if i < j:
            values[i], values[j] = values[j], values[i]

    length = 2

    while length <= n:
        angle = -2 * math.pi / length
        wlen = complex(math.cos(angle), math.sin(angle))
        half = length // 2

        for i in range(0, n, length):
            w = 1 + 0j

            for k in range(i, i + half):
                u = values[k]
                v = values[k + half] * w

                values[k] = u + v
                values[k + half] = u - v

                w *= wlen

        length *= 2

    return values


def freq_to_midi(freq):
    note = round(69 + 12 * math.log2(freq / 440.0))
    return max(0, min(127, note))


def rms(frame):
    total = 0.0

    for x in frame:
        total += x * x

    return math.sqrt(total / len(frame))


def detect_pitch(frame, min_freq=50, max_freq=1200, threshold=0.015):
    volume = rms(frame)

    if volume < threshold:
        return None, 0

    windowed = []

    for i, sample in enumerate(frame):
        hann = 0.5 - 0.5 * math.cos(2 * math.pi * i / (len(frame) - 1))
        windowed.append(complex(sample * hann, 0.0))

    spectrum = fft(windowed)

    half = len(spectrum) // 2
    magnitudes = [0.0] * half

    for i in range(half):
        c = spectrum[i]
        magnitudes[i] = math.sqrt(c.real * c.real + c.imag * c.imag)

    min_bin = max(1, int(min_freq * FRAME_SIZE / SAMPLE_RATE))
    max_bin = min(half - 1, int(max_freq * FRAME_SIZE / SAMPLE_RATE))

    best_bin = 0
    best_score = 0.0

    for b in range(min_bin, max_bin + 1):
        score = magnitudes[b]

        h2 = b * 2
        h3 = b * 3
        h4 = b * 4

        if h2 < half:
            score += magnitudes[h2] * 0.50

        if h3 < half:
            score += magnitudes[h3] * 0.33

        if h4 < half:
            score += magnitudes[h4] * 0.25

        if score > best_score:
            best_score = score
            best_bin = b

    if best_bin == 0:
        return None, 0

    freq = best_bin * SAMPLE_RATE / FRAME_SIZE
    midi_note = freq_to_midi(freq)

    velocity = int(max(30, min(127, volume * 600)))
    return midi_note, velocity


def analyze_audio(samples):
    notes = []

    current_note = None
    start_time = 0.0
    velocities = []

    frame_count = 0

    for pos in range(0, len(samples) - FRAME_SIZE, HOP_SIZE):
        frame = samples[pos:pos + FRAME_SIZE]
        time_sec = pos / SAMPLE_RATE

        midi_note, velocity = detect_pitch(frame)

        if current_note is None:
            if midi_note is not None:
                current_note = midi_note
                start_time = time_sec
                velocities = [velocity]
        else:
            if midi_note is None:
                end_time = time_sec
                duration = end_time - start_time

                if duration >= 0.10:
                    notes.append(
                        {
                            "note": current_note,
                            "start": start_time,
                            "end": end_time,
                            "velocity": int(sum(velocities) / len(velocities)),
                        }
                    )

                current_note = None
                velocities = []
            else:
                if abs(midi_note - current_note) <= 1:
                    velocities.append(velocity)
                else:
                    end_time = time_sec
                    duration = end_time - start_time

                    if duration >= 0.10:
                        notes.append(
                            {
                                "note": current_note,
                                "start": start_time,
                                "end": end_time,
                                "velocity": int(sum(velocities) / len(velocities)),
                            }
                        )

                    current_note = midi_note
                    start_time = time_sec
                    velocities = [velocity]

        frame_count += 1

        if frame_count % 50 == 0:
            print(f"Анализ: {time_sec:.1f} сек")

    if current_note is not None:
        end_time = len(samples) / SAMPLE_RATE
        duration = end_time - start_time

        if duration >= 0.10:
            notes.append(
                {
                    "note": current_note,
                    "start": start_time,
                    "end": end_time,
                    "velocity": int(sum(velocities) / len(velocities)),
                }
            )

    return notes


def var_len(value):
    bytes_out = [value & 0x7F]
    value >>= 7

    while value > 0:
        bytes_out.append((value & 0x7F) | 0x80)
        value >>= 7

    bytes_out.reverse()
    return bytes(bytes_out)


def seconds_to_ticks(seconds):
    return int(seconds * BPM * TICKS_PER_BEAT / 60)


def write_midi(notes, midi_path):
    events = []

    for item in notes:
        note = item["note"]
        velocity = item["velocity"]

        start_tick = seconds_to_ticks(item["start"])
        end_tick = seconds_to_ticks(item["end"])

        if end_tick <= start_tick:
            end_tick = start_tick + 1

        events.append((start_tick, bytes([0x90, note, velocity])))
        events.append((end_tick, bytes([0x80, note, 0])))

    events.sort(key=lambda x: (x[0], x[1][0]))

    track = bytearray()

    tempo = int(60_000_000 / BPM)

    track += var_len(0)
    track += bytes([0xFF, 0x51, 0x03])
    track += tempo.to_bytes(3, "big")

    track += var_len(0)
    track += bytes([0xC0, 0])

    last_tick = 0

    for tick, event_data in events:
        delta = tick - last_tick
        track += var_len(delta)
        track += event_data
        last_tick = tick

    track += var_len(0)
    track += bytes([0xFF, 0x2F, 0x00])

    header = bytearray()
    header += b"MThd"
    header += struct.pack(">I", 6)
    header += struct.pack(">H", 0)
    header += struct.pack(">H", 1)
    header += struct.pack(">H", TICKS_PER_BEAT)

    chunk = bytearray()
    chunk += b"MTrk"
    chunk += struct.pack(">I", len(track))
    chunk += track

    with open(midi_path, "wb") as f:
        f.write(header)
        f.write(chunk)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input_mp3", help="Путь к MP3 файлу")
    parser.add_argument("output_midi", help="Путь для MIDI файла")
    args = parser.parse_args()

    input_mp3 = Path(args.input_mp3)
    output_midi = Path(args.output_midi)

    if not input_mp3.exists():
        raise FileNotFoundError(f"Файл не найден: {input_mp3}")

    check_ffmpeg()

    with tempfile.TemporaryDirectory() as temp_dir:
        wav_path = Path(temp_dir) / "temp.wav"

        print("Читаю MP3 через FFmpeg...")
        mp3_to_wav(input_mp3, wav_path)

        print("Загружаю WAV...")
        samples = read_wav_mono(wav_path)

        print("Ищу ноты...")
        notes = analyze_audio(samples)

        print(f"Найдено нот: {len(notes)}")

        write_midi(notes, output_midi)

    print(f"Готово: {output_midi}")


if __name__ == "__main__":
    main()