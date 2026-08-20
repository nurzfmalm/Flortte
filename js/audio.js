/** Audio playback and generated note feedback for Flortte training sessions. */
const AudioPlayer = (() => {
  const DEFAULT_VOLUME = 0.8;
  let _ctx = null;
  let _masterGain = null;
  let _activeAudio = null;

  function _normalizeVolume(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : fallback;
  }

  function _readVolume() {
    try {
      const saved = localStorage.getItem('volume');
      return saved === null ? DEFAULT_VOLUME : _normalizeVolume(saved, DEFAULT_VOLUME);
    } catch (_) {
      return DEFAULT_VOLUME;
    }
  }

  let _volume = _readVolume();

  function _ensureCtx() {
    if (_ctx) return;
    _ctx = new (window.AudioContext || window.webkitAudioContext)();
    _masterGain = _ctx.createGain();
    _masterGain.gain.value = _volume;
    _masterGain.connect(_ctx.destination);
  }

  function _playNote(note, velocity = 80, durationMs = 320) {
    _ensureCtx();
    const frequency = 440 * Math.pow(2, (note - 69) / 12);
    const gain = _ctx.createGain();
    const oscillator = _ctx.createOscillator();
    const now = _ctx.currentTime;
    const peak = Math.max(0.03, Math.min(0.45, velocity / 260));

    oscillator.type = 'triangle';
    oscillator.frequency.value = frequency;
    oscillator.connect(gain);
    gain.connect(_masterGain);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
    oscillator.start(now);
    oscillator.stop(now + durationMs / 1000 + 0.03);
  }

  function play(session, { onNote, onEnd, startAt = 0 } = {}) {
    _ensureCtx();
    if (_ctx.state === 'suspended') _ctx.resume();

    let paused = false;
    let stopped = false;
    let startWallTime = performance.now();
    let offsetMs = Math.max(0, Number(startAt) || 0);
    let raf = null;
    let noteIndex = session.notes.findIndex(note => note.time >= offsetMs);
    if (noteIndex < 0) noteIndex = session.notes.length;

    const audio = session.audioUrl ? new Audio(session.audioUrl) : null;
    if (audio) {
      audio.preload = 'auto';
      audio.volume = _volume;
      audio.loop = session.audioLoop !== false;
      audio.currentTime = Math.max(0, Number(session.audioOffsetMs) || 0) / 1000;
      audio.play().catch(() => {});
      _activeAudio = audio;
    }

    function currentMs() {
      return paused
        ? offsetMs
        : (performance.now() - startWallTime) + offsetMs;
    }

    function tick() {
      if (paused || stopped) return;
      const elapsed = currentMs();

      while (noteIndex < session.notes.length && session.notes[noteIndex].time <= elapsed) {
        const note = session.notes[noteIndex];
        if (!audio) _playNote(note.note, note.velocity, note.duration);
        if (onNote) onNote(note, elapsed);
        noteIndex++;
      }

      if (elapsed >= session.durationMs) {
        stopped = true;
        if (audio) audio.pause();
        if (_activeAudio === audio) _activeAudio = null;
        if (onEnd) onEnd();
        return;
      }

      raf = requestAnimationFrame(tick);
    }

    raf = requestAnimationFrame(tick);

    return {
      pause() {
        if (paused || stopped) return;
        offsetMs = currentMs();
        paused = true;
        if (audio) audio.pause();
        cancelAnimationFrame(raf);
      },
      resume() {
        if (!paused || stopped) return;
        paused = false;
        startWallTime = performance.now();
        if (audio) audio.play().catch(() => {});
        raf = requestAnimationFrame(tick);
      },
      stop() {
        stopped = true;
        if (audio) {
          audio.pause();
          audio.currentTime = 0;
        }
        if (_activeAudio === audio) _activeAudio = null;
        cancelAnimationFrame(raf);
      },
      get currentMs() {
        return currentMs();
      },
    };
  }

  function noteOn(note, velocity = 100) {
    _playNote(note, velocity, 300);
  }

  function setVolume(value) {
    _volume = _normalizeVolume(value, 0);
    try { localStorage.setItem('volume', _volume); } catch (_) {}
    if (_masterGain) _masterGain.gain.value = _volume;
    if (_activeAudio) _activeAudio.volume = _volume;
  }

  function getVolume() {
    return _volume;
  }

  function resumeCtx() {
    _ensureCtx();
    if (_ctx.state === 'suspended') _ctx.resume();
  }

  return { play, noteOn, setVolume, getVolume, resumeCtx };
})();
