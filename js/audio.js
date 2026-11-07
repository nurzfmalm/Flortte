/** Playback, the training clock, and the two audio channels. */
const AudioPlayer = (() => {
  let context;
  let active;
  let activeMusic;
  let volume = readLevel('volume', 0.8);
  const mix = {
    music: readLevel('flortte_music_volume', 0.75),
    cues: readLevel('flortte_cues_volume', 0.55),
  };
  const voices = { music: new Set(), cues: new Set() };
  const gains = {};
  const melody = [60, 64, 67, 64, 62, 65, 69, 65, 64, 67, 72, 67, 62, 65, 67, 71];
  const bass = [48, 53, 45, 55];

  function normalizeLevel(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
  }

  function readLevel(key, fallback) {
    try {
      const saved = localStorage.getItem(key);
      return saved === null ? fallback : normalizeLevel(saved, fallback);
    } catch (_) {
      return fallback;
    }
  }

  function saveLevel(key, value) {
    try { localStorage.setItem(key, value); } catch (_) {}
  }

  function applyMix() {
    for (const channel of Object.keys(gains)) {
      gains[channel].gain.value = volume * mix[channel];
    }
    if (activeMusic) activeMusic.volume = volume * mix.music;
  }

  function resumeCtx() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    if (!context) {
      context = new AudioContext();
      for (const channel of Object.keys(mix)) {
        gains[channel] = context.createGain();
        gains[channel].connect(context.destination);
      }
      applyMix();
    }
    if (context.state === 'suspended') context.resume().catch(() => {});
  }

  function tone(channel, note, peak, duration, start = context?.currentTime) {
    if (!context || context.state !== 'running') return;
    const gain = context.createGain();
    const oscillator = context.createOscillator();
    oscillator.type = channel === 'cues' ? 'triangle' : 'sine';
    oscillator.frequency.value = 440 * Math.pow(2, (note - 69) / 12);
    oscillator.connect(gain);
    gain.connect(gains[channel]);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    voices[channel].add(oscillator);
    oscillator.onended = () => {
      voices[channel].delete(oscillator);
      oscillator.disconnect();
      gain.disconnect();
    };
    oscillator.start(start);
    oscillator.stop(start + duration);
  }

  function silence() {
    for (const channel of Object.values(voices)) {
      for (const oscillator of channel) oscillator.stop();
      channel.clear();
    }
  }

  function play(session, { onNote, onEnd, onError, stopAtTrackEnd = false, startAt = 0 } = {}) {
    active?.stop();
    resumeCtx();

    let paused = false;
    let stopped = false;
    let raf;
    let audioFailed = false;
    let playAttempt = 0;
    let wallTime = performance.now();
    let offset = Math.max(0, Number(startAt) || 0);
    let noteIndex = session.notes.findIndex(note => note.time >= offset);
    if (noteIndex < 0) noteIndex = session.notes.length;

    const audio = session.audioUrl ? new Audio(session.audioUrl) : null;
    const pulse = session.audioRhythm && 60000 / session.audioRhythm.bpm;
    const firstBeat = pulse ? session.audioRhythm.anchorMs % pulse : 0;
    const beatAt = time => Math.max(0, Math.ceil((time - firstBeat) / pulse));
    let beat = beatAt(offset);

    function failAudio() {
      if (stopped || audioFailed) return;
      audioFailed = true;
      audio.pause();
      onError?.();
    }

    function startAudio() {
      if (!audio || audioFailed) return;
      const attempt = ++playAttempt;
      audio.play().catch(() => {
        if (!paused && attempt === playAttempt) failAudio();
      });
    }

    function currentMs() {
      return paused || stopped ? offset : performance.now() - wallTime + offset;
    }

    function scheduleRhythm(elapsed) {
      if (!pulse || context?.state !== 'running') return;
      // Skip past beats after a stalled frame. Schedule the next beats on the audio clock.
      beat = Math.max(beat, beatAt(elapsed - 35));
      const beatsBeforeAnchor = Math.round((session.audioRhythm.anchorMs - firstBeat) / pulse);
      while (firstBeat + beat * pulse <= Math.min(elapsed + 90, session.durationMs)) {
        const start = context.currentTime + Math.max(0, (firstBeat + beat * pulse - elapsed) / 1000);
        const phase = ((beat - beatsBeforeAnchor) % 16 + 16) % 16;
        tone('music', melody[phase], 0.14, Math.min(0.38, pulse / 1400), start);
        if (phase % 4 === 0) tone('music', bass[phase / 4], 0.21, 0.5, start);
        beat++;
      }
    }

    function tick() {
      if (paused || stopped) return;
      const elapsed = currentMs();
      while (noteIndex < session.notes.length && session.notes[noteIndex].time <= elapsed) {
        const note = session.notes[noteIndex++];
        if ((!audio || audioFailed) && !pulse && elapsed - note.time < 100) {
          tone('cues', note.note, 0.22, Math.max(0.06, note.duration / 1000));
        }
        onNote?.(note, elapsed);
      }
      if (elapsed >= session.durationMs) {
        controller.stop();
        onEnd?.();
        return;
      }
      scheduleRhythm(elapsed);
      raf = requestAnimationFrame(tick);
    }

    const controller = {
      pause() {
        if (paused || stopped) return;
        offset = currentMs();
        paused = true;
        playAttempt++;
        audio?.pause();
        silence();
        cancelAnimationFrame(raf);
      },
      resume() {
        if (!paused || stopped) return;
        paused = false;
        wallTime = performance.now();
        beat = beatAt(offset);
        resumeCtx();
        startAudio();
        raf = requestAnimationFrame(tick);
      },
      stop() {
        if (stopped) return;
        controller.pause();
        stopped = true;
        if (audio) {
          audio.onerror = null;
          audio.onended = null;
        }
        if (active === controller) {
          active = null;
          activeMusic = null;
        }
      },
      get currentMs() { return currentMs(); },
    };

    active = controller;
    if (audio) {
      audio.preload = 'auto';
      audio.loop = session.audioLoop !== false;
      audio.currentTime = Math.max(0, Number(session.audioOffsetMs) || 0) / 1000;
      audio.onerror = failAudio;
      if (stopAtTrackEnd) audio.onended = () => {
        controller.stop();
        onEnd?.();
      };
      activeMusic = audio;
      applyMix();
      startAudio();
    }
    raf = requestAnimationFrame(tick);
    return controller;
  }

  function validateFile(url) {
    return new Promise(resolve => {
      const audio = new Audio();
      const done = valid => {
        clearTimeout(timeout);
        audio.onloadedmetadata = null;
        audio.onerror = null;
        audio.removeAttribute('src');
        audio.load();
        resolve(valid);
      };
      const timeout = setTimeout(() => done(false), 5000);
      audio.preload = 'metadata';
      audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) && audio.duration > 0);
      audio.onerror = () => done(false);
      audio.src = url;
    });
  }

  function setVolume(value) {
    volume = normalizeLevel(value, volume);
    saveLevel('volume', volume);
    applyMix();
  }

  function setMix(channel, value) {
    mix[channel] = normalizeLevel(value, mix[channel]);
    saveLevel('flortte_' + channel + '_volume', mix[channel]);
    applyMix();
  }

  function noteOn(note) {
    tone('cues', note, 0.27, 0.19);
  }

  return { play, noteOn, validateFile, setVolume, getVolume: () => volume, setMix, getMix: channel => mix[channel], resumeCtx };
})();
