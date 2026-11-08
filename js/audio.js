/** Playback, the training clock, and the two audio channels. */
const AudioPlayer = (() => {
  let context;
  let active;
  let activeMusic;
  let volume = readLevel('volume', 0.8);
  const mix = {
    music: readLevel('flortte_music_volume', 0.75),
  };
  const voices = new Set();
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

  function tone(note, peak, duration, start) {
    if (!context || context.state !== 'running') return;
    const gain = context.createGain();
    const oscillator = context.createOscillator();
    oscillator.type = 'triangle';
    oscillator.frequency.value = 440 * Math.pow(2, (note - 69) / 12);
    oscillator.connect(gain);
    gain.connect(gains.music);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + Math.min(0.012, duration / 3));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    voices.add(oscillator);
    oscillator.onended = () => {
      voices.delete(oscillator);
      oscillator.disconnect();
      gain.disconnect();
    };
    oscillator.start(start);
    oscillator.stop(start + duration);
  }

  function silence() {
    for (const oscillator of voices) oscillator.stop();
    voices.clear();
  }

  function play(session, { onEnd, onError, stopAtTrackEnd = false, startAt = 0 } = {}) {
    active?.stop();
    resumeCtx();

    let paused = false;
    let stopped = false;
    let raf;
    let audioFailed = false;
    let trackFinished = false;
    let lastPositionMs = 0;
    let trackCycles = 0;
    let playAttempt = 0;
    let wallTime = performance.now();
    let offset = Math.max(0, Number(startAt) || 0);
    const rate = session.playbackRate || 1;
    const lead = session.playbackLeadMs || 0;
    let audioStarted = false;
    const audio = session.audioUrl ? new Audio(session.audioUrl) : null;
    const midi = session.midiNotes;
    const cycleMs = session.trackDurationMs / rate;
    let midiCycle = 0;
    let midiIndex = 0;
    function seekMidi(elapsed) {
      if (!midi?.length) return;
      const musicTime = Math.max(0, elapsed - lead);
      midiCycle = Math.floor(musicTime / cycleMs);
      const position = (musicTime - midiCycle * cycleMs) * rate;
      midiIndex = midi.findIndex(note => note.time >= position);
      if (midiIndex < 0) midiIndex = midi.length;
    }
    seekMidi(offset);
    const pulse = session.audioRhythm && 60000 / session.audioRhythm.bpm;
    const firstBeat = pulse ? session.audioRhythm.anchorMs % pulse : 0;
    const beatAt = time => Math.max(0, Math.ceil((time - firstBeat) / pulse));
    let beat = beatAt(offset);

    function switchToWallClock() {
      offset = currentMs();
      wallTime = performance.now();
    }

    function failAudio() {
      if (stopped || audioFailed) return;
      switchToWallClock();
      audioFailed = true;
      audio.pause();
      onError?.();
    }

    function startAudio() {
      if (!audio || audioFailed || trackFinished) return;
      audioStarted = true;
      const attempt = ++playAttempt;
      audio.play().catch(() => {
        if (!paused && attempt === playAttempt) failAudio();
      });
    }

    function currentMs() {
      if (paused || stopped) return offset;
      if (audioStarted && session.trackDurationMs && !audioFailed && !trackFinished) {
        const positionMs = audio.currentTime * 1000;
        if (audio.loop && lastPositionMs - positionMs > audio.duration * 500) trackCycles++;
        lastPositionMs = positionMs;
        const durationMs = audio.duration * 1000;
        const sourceMs = Number.isFinite(durationMs) && durationMs > 0
          ? positionMs * session.trackDurationMs / durationMs
          : positionMs;
        return lead + trackCycles * cycleMs + sourceMs / rate;
      }
      return performance.now() - wallTime + offset;
    }

    function scheduleRhythm(elapsed) {
      if (!pulse || context?.state !== 'running') return;
      // Skip past beats after a stalled frame. Schedule the next beats on the audio clock.
      beat = Math.max(beat, beatAt(elapsed - 35));
      const beatsBeforeAnchor = Math.round((session.audioRhythm.anchorMs - firstBeat) / pulse);
      while (firstBeat + beat * pulse <= Math.min(elapsed + 90, session.durationMs)) {
        const start = context.currentTime + Math.max(0, (firstBeat + beat * pulse - elapsed) / 1000);
        const phase = ((beat - beatsBeforeAnchor) % 16 + 16) % 16;
        tone(melody[phase], 0.14, Math.min(0.38, pulse / 1400), start);
        if (phase % 4 === 0) tone(bass[phase / 4], 0.21, 0.5, start);
        beat++;
      }
    }

    function scheduleMidi(elapsed) {
      if (!midi?.length || context?.state !== 'running') return;
      if (elapsed > lead + (midiCycle + 1) * cycleMs + 90) seekMidi(elapsed);
      while (session.audioLoop !== false || midiCycle === 0) {
        if (midiIndex === midi.length) {
          midiCycle++;
          midiIndex = 0;
          continue;
        }
        const note = midi[midiIndex];
        const time = lead + midiCycle * cycleMs + note.time / rate;
        if (time > Math.min(elapsed + 90, session.durationMs)) return;
        const remaining = note.duration / rate - Math.max(0, elapsed - time);
        if (remaining > 0) {
          const start = context.currentTime + Math.max(0, (time - elapsed) / 1000);
          tone(note.pitch, 0.15 * note.velocity / 127, remaining / 1000, start);
        }
        midiIndex++;
      }
    }

    function tick() {
      if (paused || stopped) return;
      const elapsed = currentMs();
      if (audio && !audioStarted && elapsed >= lead) startAudio();
      if (elapsed >= session.durationMs) {
        controller.stop();
        onEnd?.();
        return;
      }
      scheduleRhythm(elapsed);
      scheduleMidi(elapsed);
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
        seekMidi(offset);
        resumeCtx();
        if (audioStarted || offset >= lead) startAudio();
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
      audio.playbackRate = rate;
      audio.loop = session.audioLoop !== false;
      audio.currentTime = Math.max(0, offset - lead) * rate / 1000;
      audio.onerror = failAudio;
      audio.onended = () => {
        if (stopAtTrackEnd) {
          controller.stop();
          onEnd?.();
        } else {
          switchToWallClock();
          trackFinished = true;
        }
      };
      activeMusic = audio;
      applyMix();
      if (offset >= lead) startAudio();
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
      const timeout = setTimeout(() => done(0), 5000);
      audio.preload = 'metadata';
      audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) && audio.duration > 0 ? Math.round(audio.duration * 1000) : 0);
      audio.onerror = () => done(0);
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

  return { play, validateFile, setVolume, getVolume: () => volume, setMix, getMix: channel => mix[channel], resumeCtx };
})();
