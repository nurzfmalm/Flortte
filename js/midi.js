/**
 * midi.js — MIDI file parsing + Web Audio API playback
 *
 * Public API:
 *   MidiPlayer.loadFile(file)    → Promise<Song>
 *   MidiPlayer.loadUrl(url)      → Promise<Song>
 *   MidiPlayer.play(song, opts)  → controller { pause, resume, stop, seek }
 *   MidiPlayer.noteOn(note, vel) → trigger note sound immediately
 *   MidiPlayer.setVolume(0-1)
 *
 * Song shape:
 *   { name, durationMs, notes: [{ time, duration, note, noteName, velocity, lane }] }
 *
 * The "note" field stays the real MIDI pitch from the song. The "lane" field
 * groups that song's real pitches from low to high across the available gestures.
 */

const MidiPlayer = (() => {
  // ── Audio context ──────────────────────────────────────────
  let _ctx = null;
  let _masterGain = null;
  let _volume = parseFloat(localStorage.getItem('volume') || '0.8');
  let _tempo = parseFloat(localStorage.getItem('tempo') || '0.7');
  let _activeAudio = null;

  function _ensureCtx() {
    if (_ctx) return;
    _ctx = new (window.AudioContext || window.webkitAudioContext)();
    _masterGain = _ctx.createGain();
    _masterGain.gain.value = _volume;
    _masterGain.connect(_ctx.destination);
  }

  // ── Simple FM synth for piano-ish sound ───────────────────
  function _playNote(midiNote, velocity = 80, durationMs = 400) {
    _ensureCtx();
    const freq = 440 * Math.pow(2, (midiNote - 69) / 12);
    const gain = _ctx.createGain();
    gain.connect(_masterGain);

    // Carrier
    const osc = _ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    osc.connect(gain);

    // Quick attack, decay
    const now = _ctx.currentTime;
    const vel = (velocity / 127) * 0.6;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(vel, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(vel * 0.3, now + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);

    osc.start(now);
    osc.stop(now + durationMs / 1000 + 0.05);
  }

  function _assignSongPitchLanes(notes) {
    const laneCount = Gestures.laneCount ? Gestures.laneCount() : 5;
    if (!notes.length) return;
    if (!laneCount) {
      notes.forEach(note => {
        note.lane = null;
        note.noteName = Gestures.midiToName(note.note);
      });
      return;
    }

    const uniquePitches = [...new Set(notes.map(n => n.note))]
      .filter(note => typeof note === 'number' && !Number.isNaN(note))
      .sort((a, b) => a - b);

    if (!uniquePitches.length) return;

    const pitchToLane = new Map();
    if (uniquePitches.length === 1) {
      pitchToLane.set(uniquePitches[0], Math.floor(laneCount / 2));
    } else {
      uniquePitches.forEach((note, index) => {
        const lane = Math.round(index * (laneCount - 1) / (uniquePitches.length - 1));
        pitchToLane.set(note, lane);
      });
    }

    notes.forEach(note => {
      note.lane = pitchToLane.get(note.note) ?? null;
      note.noteName = Gestures.midiToName(note.note);
    });
  }

  // ── MIDI parser (type 0 and type 1, minimal) ──────────────
  function _parseMidi(buffer) {
    const data = new DataView(buffer);
    let pos = 0;

    function readUint32() { const v = data.getUint32(pos); pos += 4; return v; }
    function readUint16() { const v = data.getUint16(pos); pos += 2; return v; }
    function readUint8()  { return data.getUint8(pos++); }

    function readVarLen() {
      let value = 0;
      let b;
      do { b = readUint8(); value = (value << 7) | (b & 0x7F); } while (b & 0x80);
      return value;
    }

    // Header
    if (readUint32() !== 0x4D546864) throw new Error('Not a MIDI file');
    readUint32(); // chunk size
    const format   = readUint16();
    const numTracks = readUint16();
    const division = readUint16(); // ticks per quarter note (assume not SMPTE)

    const tracks = [];

    for (let t = 0; t < numTracks; t++) {
      if (readUint32() !== 0x4D54726B) throw new Error('Expected track chunk');
      const chunkLen = readUint32();
      const chunkEnd = pos + chunkLen;

      const events = [];
      let tick = 0;
      let lastStatus = 0;

      while (pos < chunkEnd) {
        const delta = readVarLen();
        tick += delta;

        let statusByte = data.getUint8(pos);
        if (statusByte & 0x80) { lastStatus = statusByte; pos++; }
        else                    { statusByte = lastStatus; }

        if (statusByte === 0xFF) {
          const metaType = readUint8();
          const metaLen  = readVarLen();
          if (metaType === 0x51 && metaLen === 3) {
            const tempo = (readUint8() << 16) | (readUint8() << 8) | readUint8();
            events.push({ tick, type: 'tempo', tempo });
          } else {
            pos += metaLen;
          }
        } else if (statusByte === 0xF0 || statusByte === 0xF7) {
          const len = readVarLen();
          pos += len;
        } else {
          const type    = (statusByte & 0xF0) >> 4;
          const channel = statusByte & 0x0F;

          if (type === 0x9) {
            const note = readUint8();
            const vel  = readUint8();
            events.push({ tick, type: vel > 0 ? 'noteOn' : 'noteOff', note, velocity: vel, channel });
          } else if (type === 0x8) {
            const note = readUint8();
            readUint8(); // velocity
            events.push({ tick, type: 'noteOff', note, channel });
          } else if (type === 0xA || type === 0xB || type === 0xE) {
            readUint8(); readUint8();
          } else if (type === 0xC || type === 0xD) {
            readUint8();
          }
        }
      }
      pos = chunkEnd;
      tracks.push(events);
    }

    const eventOrder = { tempo: 0, noteOff: 1, noteOn: 2 };
    const mergedEvents = tracks.flatMap((events, trackIndex) =>
      events.map(event => ({ ...event, trackIndex }))
    ).sort((a, b) =>
      a.tick - b.tick ||
      eventOrder[a.type] - eventOrder[b.type] ||
      a.trackIndex - b.trackIndex
    );

    let currentTempo = 500000;
    let lastTick = 0;
    let currentTime = 0;
    const noteStacks = {};
    const notes = [];

    function advanceTo(tick) {
      if (tick === lastTick) return;
      currentTime += ((tick - lastTick) / division) * (currentTempo / 1000);
      lastTick = tick;
    }

    for (const ev of mergedEvents) {
      advanceTo(ev.tick);

      if (ev.type === 'tempo') {
        currentTempo = ev.tempo;
        continue;
      }

      const key = `${ev.note}-${ev.channel}`;
      if (ev.type === 'noteOn') {
        noteStacks[key] = noteStacks[key] || [];
        noteStacks[key].push({ time: currentTime, note: ev.note, velocity: ev.velocity });
      } else if (ev.type === 'noteOff') {
        const stack = noteStacks[key];
        if (stack && stack.length) {
          const on = stack.shift();
          const duration = Math.max(currentTime - on.time, 50);
          notes.push({ time: on.time, duration, note: on.note, velocity: on.velocity });
        }
      }
    }

    notes.sort((a, b) => a.time - b.time);
    _assignSongPitchLanes(notes);

    const durationMs = notes.reduce((m, n) => Math.max(m, n.time + n.duration), 0) + 1000;

    return { notes, durationMs, division, format };
  }

  // ── Public loader ──────────────────────────────────────────
  async function loadFile(file) {
    const buffer = await file.arrayBuffer();
    const parsed = _parseMidi(buffer);
    return { name: file.name.replace(/\.midi?$/i, ''), ...parsed };
  }

  async function loadUrl(url) {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to load MIDI (${res.status})`);
    }
    const buffer = await res.arrayBuffer();
    const parsed = _parseMidi(buffer);
    const name = url.split('/').pop().replace(/\.midi?$/i, '');
    return { name, ...parsed };
  }

  // ── Playback scheduler ─────────────────────────────────────
  function play(song, { onNote, onEnd, startAt = 0 } = {}) {
    _ensureCtx();
    if (_ctx.state === 'suspended') _ctx.resume();

    let _paused = false;
    let _stopped = false;
    let _startWallTime = performance.now();
    let _offsetMs = startAt;
    let _raf = null;
    let _noteIndex = song.notes.findIndex(n => n.time >= startAt);
    const audio = song.audioUrl ? new Audio(song.audioUrl) : null;
    if (audio) {
      audio.preload = 'auto';
      audio.volume = _volume;
      audio.playbackRate = _tempo;
      audio.currentTime = startAt / 1000;
      audio.play().catch(() => {});
      _activeAudio = audio;
    }
    if (_noteIndex < 0) _noteIndex = song.notes.length;

    function tick() {
      if (_paused || _stopped) return;
      const elapsed = audio
        ? audio.currentTime * 1000
        : (performance.now() - _startWallTime) * _tempo + _offsetMs;

      while (_noteIndex < song.notes.length && song.notes[_noteIndex].time <= elapsed) {
        const n = song.notes[_noteIndex];
        if (!audio) _playNote(n.note, n.velocity, n.duration / _tempo);
        if (onNote) onNote(n, elapsed);
        _noteIndex++;
      }

      if (elapsed >= song.durationMs) {
        _stopped = true;
        if (audio) audio.pause();
        if (_activeAudio === audio) _activeAudio = null;
        if (onEnd) onEnd();
        return;
      }

      _raf = requestAnimationFrame(tick);
    }

    _raf = requestAnimationFrame(tick);

    return {
      pause() {
        if (_paused || _stopped) return;
        _paused = true;
        _offsetMs += (performance.now() - _startWallTime) * _tempo;
        if (audio) audio.pause();
        cancelAnimationFrame(_raf);
      },
      resume() {
        if (!_paused || _stopped) return;
        _paused = false;
        _startWallTime = performance.now();
        if (audio) audio.play().catch(() => {});
        _raf = requestAnimationFrame(tick);
      },
      stop() {
        _stopped = true;
        if (audio) { audio.pause(); audio.currentTime = 0; }
        if (_activeAudio === audio) _activeAudio = null;
        cancelAnimationFrame(_raf);
      },
      get currentMs() {
        if (audio) return audio.currentTime * 1000;
        return _paused ? _offsetMs : (performance.now() - _startWallTime) * _tempo + _offsetMs;
      },
    };
  }

  function noteOn(note, velocity = 100)  { _ensureCtx(); _playNote(note, velocity, 300); }
  function setVolume(v) {
    _volume = v;
    localStorage.setItem('volume', v);
    if (_masterGain) _masterGain.gain.value = v;
    if (_activeAudio) _activeAudio.volume = v;
  }
  function getVolume() { return _volume; }
  function setTempo(v) { _tempo = Math.max(0.5, Math.min(1, Number(v) || 0.7)); localStorage.setItem('tempo', _tempo); if (_activeAudio) _activeAudio.playbackRate = _tempo; }
  function getTempo() { return _tempo; }
  function resumeCtx() { _ensureCtx(); if (_ctx.state === 'suspended') _ctx.resume(); }

  return { loadFile, loadUrl, play, noteOn, setVolume, getVolume, setTempo, getTempo, resumeCtx, assignSongPitchLanes: _assignSongPitchLanes };
})();
