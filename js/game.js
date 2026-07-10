/**
 * game.js — Synthesia/Midiano-style falling note game engine
 *
 * 5 lanes matching the 5 one-hand gesture combinations.
 * Notes scroll downward; player performs gesture when note hits the hit zone.
 * Notes with lane=null are played automatically (background harmony).
 *
 * Public API (called by app.js):
 *   Game.init()
 *   Game.start(song)
 *   Game.stop()
 *   Game.pause() / Game.resume()
 *   Game.onScoreChange(fn)
 *   Game.onEnd(fn)
 */

const Game = (() => {
  const FALLBACK_COLORS = ['#7c3aed', '#22d3a0', '#f59e0b', '#38bdf8', '#f472b6'];
  const FALLBACK_GLOWS  = ['#a855f7', '#34d399', '#fbbf24', '#7dd3fc', '#f9a8d4'];
  const HIT_ZONE_Y   = 0.82;   // fraction from top
  const NOTE_W_FRAC  = 0.78;   // note width as fraction of lane width
  const NOTE_H       = 28;     // px (logical)
  const LOOKAHEAD_MS = 3000;   // how far ahead we render notes
  const SENSOR_KEYS  = ['keyPinch', 'indexThumb', 'middleThumb'];
  const SENSOR_MAX   = 4095;

  let _canvas, _ctx;
  let _song    = null;
  let _playCtl = null;
  let _active  = false;
  let _paused  = false;

  let _speed   = parseInt(localStorage.getItem('game_speed')  || '300', 10); // px/s
  let _window  = parseInt(localStorage.getItem('game_window') || '240', 10); // hit window ms
  let _noteIndex = 0;

  // Active note tiles on screen: { note, lane, time, duration, hit, miss, opacity }
  let _tiles  = [];
  // Score state
  let _score  = 0;
  let _combo  = 0;
  let _scoreListeners = [];
  let _endListeners   = [];

  // Gesture state
  let _lastGestureId = 'open';
  let _forgivingArmed = true;

  // Hit feedback flashes: { lane, t, label }
  let _flashes = [];

  // Lane key DOM elements for visual feedback
  let _laneKeys = [];
  let _assist = null;
  let _lastNextSignature = '';
  let _lastSensorSignature = '';
  let _lastLaneSignature = '';

  // ── DOM / Canvas ──────────────────────────────────────────
  function init() {
    _canvas   = document.getElementById('game-canvas');
    _ctx      = _canvas.getContext('2d');
    _laneKeys = Array.from(document.querySelectorAll('.lane-key'));
    _assist = {
      root: document.getElementById('game-assist'),
      next: document.getElementById('game-next'),
      nextEmoji: document.getElementById('game-next-emoji'),
      nextName: document.getElementById('game-next-name'),
      nextMeta: document.getElementById('game-next-meta'),
      recipeChips: Array.from(document.querySelectorAll('#game-finger-recipe .game-finger-chip')),
      currentGesture: document.getElementById('game-current-gesture'),
      fingerMeters: Array.from(document.querySelectorAll('.game-finger-meter')),
      fingerValues: [
        document.getElementById('game-finger-value-0'),
        document.getElementById('game-finger-value-1'),
        document.getElementById('game-finger-value-2'),
      ],
      fingerFills: [
        document.getElementById('game-finger-fill-0'),
        document.getElementById('game-finger-fill-1'),
        document.getElementById('game-finger-fill-2'),
      ],
    };
    _resize();
    _updateNextGesture(null, 0);
    window.addEventListener('resize', _resize);
    ESP32.onData(_onSensor);
  }

  function _resize() {
    if (!_canvas) return;
    const rect = _canvas.getBoundingClientRect();
    _canvas.width  = rect.width  * devicePixelRatio;
    _canvas.height = rect.height * devicePixelRatio;
  }

  function _laneCount() {
    const count = Gestures.laneCount ? Gestures.laneCount() : 5;
    return Math.max(1, count);
  }

  function _gestureForLane(lane) {
    return Gestures.gestureForLane(lane) || {};
  }

  function _laneColor(lane) {
    return _gestureForLane(lane).color || FALLBACK_COLORS[lane % FALLBACK_COLORS.length];
  }

  function _laneGlow(lane) {
    return _gestureForLane(lane).glow || FALLBACK_GLOWS[lane % FALLBACK_GLOWS.length];
  }

  function _setGestureVisual(el, gesture) {
    if (!el) return;
    const image = gesture?.image;

    if (!image) {
      el.textContent = gesture?.emoji || '—';
      return;
    }

    const current = el.querySelector('img');
    if (current?.getAttribute('src') === image) return;

    el.textContent = '';
    const img = document.createElement('img');
    img.src = image;
    img.alt = gesture.name || 'Жест';
    img.loading = 'lazy';
    el.appendChild(img);
  }

  function _forgivingHitWindow() {
    return Math.min(420, _window + 90);
  }

  function _gameScreenVisible() {
    return document.getElementById('screen-game')?.classList.contains('active');
  }

  function _syncLaneKeys() {
    const gestures = Gestures.playableGestures ? Gestures.playableGestures() : [];
    const signature = gestures.map(g => g.id).join('|');
    if (signature === _lastLaneSignature) return;
    _lastLaneSignature = signature;

    _laneKeys.forEach((el, i) => {
      const gesture = gestures[i];
      el.hidden = !gesture;
      el.classList.remove('active', 'hit');
      if (!gesture) return;
      const icon = el.querySelector('.lane-gesture-icon');
      const label = el.querySelector('.lane-label');
      if (icon) _setGestureVisual(icon, gesture);
      if (label) label.textContent = gesture.name || 'Жест';
    });
  }

  function _formatTimeUntil(ms) {
    if (!Number.isFinite(ms)) return '—';
    if (ms <= 120) return 'сейчас';
    if (ms < 1000) return `${Math.round(ms)} мс`;
    return `${(ms / 1000).toFixed(1)} с`;
  }

  function _findNextTile(currentMs) {
    let next = null;
    for (const tile of _tiles) {
      if (tile.hit || tile.miss) continue;
      if (tile.time < currentMs - _window) continue;
      if (!next || tile.time < next.time) next = tile;
    }
    return next;
  }

  function _updateNextGesture(tile, currentMs) {
    if (!_assist) return;

    const countdownBucket = tile ? Math.max(0, Math.floor((tile.time - currentMs) / 100)) : 0;
    const signature = tile ? `${tile.time}:${tile.lane}:${tile.note}:${countdownBucket}` : 'empty';
    if (signature === _lastNextSignature) return;
    _lastNextSignature = signature;

    if (!tile) {
      _assist.next?.style.setProperty('--next-color', 'var(--violet)');
      if (_assist.nextEmoji) _setGestureVisual(_assist.nextEmoji, null);
      if (_assist.nextName) _assist.nextName.textContent = 'Ждите ноту';
      if (_assist.nextMeta) _assist.nextMeta.textContent = '—';
      _assist.recipeChips.forEach(chip => chip.classList.remove('needed'));
      return;
    }

    const gesture = _gestureForLane(tile.lane);
    const color = gesture.color || _laneColor(tile.lane);
    const noteName = Gestures.midiToName ? Gestures.midiToName(tile.note) : `MIDI ${tile.note}`;
    const timeText = _formatTimeUntil(tile.time - currentMs);
    const meta = [noteName, gesture.keys, timeText].filter(Boolean).join(' · ');

    _assist.next?.style.setProperty('--next-color', color);
    if (_assist.nextEmoji) _setGestureVisual(_assist.nextEmoji, gesture);
    if (_assist.nextName) _assist.nextName.textContent = gesture.name || 'Жест';
    if (_assist.nextMeta) _assist.nextMeta.textContent = meta;

    const pattern = gesture.pattern || [0, 0, 0];
    _assist.recipeChips.forEach((chip, i) => {
      chip.classList.toggle('needed', pattern[i] === 1);
    });
  }

  function _updateFingerReadout(sensors, result) {
    if (!_assist) return;
    const values = SENSOR_KEYS.map(key => Number(sensors[key]));
    const bits = result.bits || [0, 0, 0];
    const gesture = result.gesture || {};
    const signature = `${values.join('|')}:${bits.join('')}:${gesture.id || ''}`;

    if (signature === _lastSensorSignature) return;
    _lastSensorSignature = signature;

    if (_assist.currentGesture) {
      _assist.currentGesture.textContent = `${gesture.emoji || '—'} ${gesture.name || 'Нет жеста'}`;
    }

    values.forEach((value, i) => {
      const safeValue = Number.isFinite(value) ? value : 0;
      const width = Math.max(0, Math.min(100, (safeValue / SENSOR_MAX) * 100));

      if (_assist.fingerValues[i]) {
        _assist.fingerValues[i].textContent = Number.isFinite(value) ? String(Math.round(value)) : '—';
      }
      if (_assist.fingerFills[i]) {
        _assist.fingerFills[i].style.width = `${width.toFixed(1)}%`;
      }
      _assist.fingerMeters[i]?.classList.toggle('active', bits[i] === 1);
    });
  }

  function _gestureMatchesSensors(sensors, gesture) {
    if (!gesture?.pattern || !Gestures.patternFit) return false;
    return Gestures.patternFit(sensors, gesture.pattern).matches;
  }

  function _anyPlayableGestureMatches(sensors) {
    const gestures = Gestures.playableGestures ? Gestures.playableGestures() : [];
    return gestures.some(gesture => _gestureMatchesSensors(sensors, gesture));
  }

  function _findForgivingTile(sensors, currentMs) {
    const windowMs = _forgivingHitWindow();
    let best = null;
    let bestDist = Infinity;

    for (const tile of _tiles) {
      if (tile.hit || tile.miss) continue;
      const dist = Math.abs(tile.time - currentMs);
      if (dist > windowMs || dist >= bestDist) continue;

      const gesture = _gestureForLane(tile.lane);
      if (!_gestureMatchesSensors(sensors, gesture)) continue;

      best = tile;
      bestDist = dist;
    }

    return best;
  }

  // ── Sensor input ──────────────────────────────────────────
  function _onSensor(sensors) {
    if (!_active && !_gameScreenVisible()) return;
    _syncLaneKeys();
    const result = Gestures.classify(sensors);
    const lane = result.lane;
    const gestureId = result.gesture.id;
    const nowMs = _playCtl ? _playCtl.currentMs : 0;
    const forgivingTile = (_active && !_paused) ? _findForgivingTile(sensors, nowMs) : null;
    const anyForgivingMatch = (_active && !_paused) ? _anyPlayableGestureMatches(sensors) : false;

    _updateFingerReadout(sensors, result);

    // Visual lane highlight
    _laneKeys.forEach((el, i) => {
      el.classList.toggle('active', lane === i);
    });

    if (!_active || _paused) {
      _lastGestureId = gestureId;
      if (!anyForgivingMatch) _forgivingArmed = true;
      return;
    }

    if (forgivingTile && forgivingTile.lane !== lane && _forgivingArmed) {
      _onLaneActivated(forgivingTile.lane, { tile: forgivingTile, windowMs: _forgivingHitWindow() });
      _forgivingArmed = false;
    } else if (lane !== null && gestureId !== _lastGestureId) {
      _onLaneActivated(lane);
    }

    if (!anyForgivingMatch) _forgivingArmed = true;
    _lastGestureId = gestureId;
  }

  // ── Hit detection ─────────────────────────────────────────
  function _onLaneActivated(lane, options = {}) {
    if (!_song) return;
    const nowMs = _playCtl ? _playCtl.currentMs : 0;
    const hitWindow = options.windowMs || _window;

    // Find the closest un-hit tile in this lane within the hit window
    let best = options.tile || null;
    let bestDist = best ? Math.abs(best.time - nowMs) : Infinity;

    if (best && (best.lane !== lane || best.hit || best.miss || bestDist > hitWindow)) {
      best = null;
      bestDist = Infinity;
    }

    if (!best) {
      for (const tile of _tiles) {
        if (tile.lane !== lane || tile.hit || tile.miss) continue;
        const dist = Math.abs(tile.time - nowMs);
        if (dist <= hitWindow && dist < bestDist) { best = tile; bestDist = dist; }
      }
    }

    if (best) {
      best.hit = true;
      const accuracy = bestDist < 60  ? 'PERFECT'
                     : bestDist < 120 ? 'GOOD'
                     :                  'OK';
      _combo++;
      const points = accuracy === 'PERFECT' ? 100 * Math.min(_combo, 10)
                   : accuracy === 'GOOD'    ?  70 * Math.min(_combo, 10)
                   :                           40;
      _score += points;
      _flashes.push({ lane, t: performance.now(), label: accuracy, points });
      _emitScore();

      // Trigger MIDI note sound for visual-only notes (already played by scheduler, but re-trigger for responsiveness)
      MidiPlayer.noteOn(best.note, 100);

      // Lane DOM flash
      _laneKeys[lane]?.classList.add('hit');
      setTimeout(() => _laneKeys[lane]?.classList.remove('hit'), 180);
    } else {
      // Wrong lane or miss
      _combo = 0;
      _emitScore();
    }
  }

  // ── Tile management ───────────────────────────────────────
  function _spawnTiles(currentMs) {
    const horizon = currentMs + LOOKAHEAD_MS;
    while (_noteIndex < _song.notes.length && _song.notes[_noteIndex].time <= horizon) {
      const n = _song.notes[_noteIndex++];
      if (n.lane === null || n.lane === undefined) continue; // auto-play only, no tile
      _tiles.push({ ...n, hit: false, miss: false, opacity: 1 });
    }
  }

  function _cleanTiles(currentMs) {
    for (const tile of _tiles) {
      if (!tile.hit && !tile.miss && tile.time < currentMs - _window) {
        tile.miss = true;
        _combo = 0;
        _emitScore();
      }
    }
    // Remove faded-out tiles
    _tiles = _tiles.filter(t => !(t.hit || t.miss) || t.opacity > 0.01);
    // Fade hits/misses
    for (const t of _tiles) {
      if (t.hit || t.miss) t.opacity -= 0.08;
    }
  }

  // ── Score emit ────────────────────────────────────────────
  function _emitScore() {
    const snap = { score: _score, combo: _combo };
    _scoreListeners.forEach(fn => fn(snap));
  }

  // ── Draw ──────────────────────────────────────────────────
  let _lastRaf = 0;
  function _draw(ts) {
    if (!_active) return;
    requestAnimationFrame(_draw);
    if (!_playCtl) return;

    const W = _canvas.width;
    const H = _canvas.height;
    const dpr = devicePixelRatio;
    const currentMs = _playCtl.currentMs;

    _spawnTiles(currentMs);
    _cleanTiles(currentMs);
    _updateNextGesture(_findNextTile(currentMs), currentMs);

    _ctx.clearRect(0, 0, W, H);

    const laneCount = _laneCount();
    const laneW = W / laneCount;
    const hitY  = H * HIT_ZONE_Y;

    // Lane separators
    _ctx.strokeStyle = '#252b3d';
    _ctx.lineWidth = 1;
    for (let l = 1; l < laneCount; l++) {
      _ctx.beginPath();
      _ctx.moveTo(laneW * l, 0);
      _ctx.lineTo(laneW * l, H);
      _ctx.stroke();
    }

    // Hit zone line
    for (let l = 0; l < laneCount; l++) {
      const lx = laneW * l;
      const grad = _ctx.createLinearGradient(lx, hitY, lx + laneW, hitY);
      const color = _laneColor(l);
      grad.addColorStop(0,   color + '00');
      grad.addColorStop(0.5, color + 'cc');
      grad.addColorStop(1,   color + '00');
      _ctx.strokeStyle = grad;
      _ctx.lineWidth = 2 * dpr;
      _ctx.beginPath();
      _ctx.moveTo(lx, hitY);
      _ctx.lineTo(lx + laneW, hitY);
      _ctx.stroke();
    }

    // Draw tiles
    const noteW = laneW * NOTE_W_FRAC;
    const noteH = NOTE_H * dpr;

    for (const tile of _tiles) {
      const lane = tile.lane;
      const lx   = lane * laneW + (laneW - noteW) / 2;

      // Y position: how far above hitY does this note appear
      const msAhead = tile.time - currentMs;
      const pxPerMs = (_speed * dpr) / 1000;
      const y = hitY - msAhead * pxPerMs;

      if (y < -noteH * 2 || y > H + noteH) continue;

      const alpha = tile.hit || tile.miss ? Math.max(0, tile.opacity) : 1;
      const color  = tile.hit  ? '#ffffff'
                   : tile.miss ? '#ef4444'
                   : _laneColor(lane);
      const glow   = tile.hit  ? '#ffffff'
                   : tile.miss ? '#ef4444'
                   : _laneGlow(lane);

      _ctx.save();
      _ctx.globalAlpha = alpha;

      // Glow
      _ctx.shadowColor = glow;
      _ctx.shadowBlur  = 14 * dpr;

      // Pill shape
      const r = noteH / 2;
      _ctx.beginPath();
      _ctx.roundRect(lx, y - noteH / 2, noteW, noteH, [r]);
      _ctx.fillStyle = color + (tile.hit ? 'ff' : tile.miss ? '88' : 'dd');
      _ctx.fill();

      // Inner highlight stripe
      if (!tile.miss) {
        _ctx.shadowBlur = 0;
        const inner = _ctx.createLinearGradient(lx, y - noteH / 2, lx, y + noteH / 2);
        inner.addColorStop(0, '#ffffff44');
        inner.addColorStop(1, '#ffffff00');
        _ctx.beginPath();
        _ctx.roundRect(lx + 2, y - noteH / 2 + 2, noteW - 4, noteH / 2, [r - 2, r - 2, 0, 0]);
        _ctx.fillStyle = inner;
        _ctx.fill();
      }

      const noteLabel = tile.noteName || (Gestures.midiToName ? Gestures.midiToName(tile.note) : String(tile.note));
      if (noteW > 42 * dpr) {
        _ctx.shadowBlur = 0;
        _ctx.font = `bold ${11 * dpr}px Consolas, "Courier New", monospace`;
        _ctx.textAlign = 'center';
        _ctx.textBaseline = 'middle';
        _ctx.fillStyle = tile.hit ? '#08090d' : '#ffffff';
        _ctx.fillText(noteLabel, lx + noteW / 2, y + 0.5 * dpr);
      }

      _ctx.restore();
    }

    // Hit flash labels
    const now = performance.now();
    _flashes = _flashes.filter(f => now - f.t < 600);
    _ctx.font = `bold ${13 * dpr}px "Segoe UI", system-ui, sans-serif`;
    for (const f of _flashes) {
      const progress = (now - f.t) / 600;
      const alpha = 1 - progress;
      const lx    = f.lane * laneW + laneW / 2;
      const ly    = hitY - (30 + progress * 60) * dpr;
      _ctx.save();
      _ctx.globalAlpha = alpha;
      _ctx.fillStyle = f.label === 'PERFECT' ? _laneGlow(f.lane) : f.label === 'GOOD' ? '#22d3a0' : '#f59e0b';
      _ctx.textAlign = 'center';
      _ctx.shadowColor = _ctx.fillStyle;
      _ctx.shadowBlur  = 8 * dpr;
      _ctx.fillText(f.label, lx, ly);
      _ctx.font = `${10 * dpr}px Consolas, "Courier New", monospace`;
      _ctx.fillText(`+${f.points}`, lx, ly + 15 * dpr);
      _ctx.restore();
    }
  }

  // ── Public ────────────────────────────────────────────────
  function start(song) {
    stop();
    if (MidiPlayer.assignSongPitchLanes) MidiPlayer.assignSongPitchLanes(song.notes);
    _song      = song;
    _noteIndex = 0;
    _tiles     = [];
    _score     = 0;
    _combo     = 0;
    _lastGestureId = 'open';
    _forgivingArmed = true;
    _flashes   = [];
    _active    = true;
    _paused    = false;
    _lastNextSignature = '';
    _updateNextGesture(null, 0);
    _syncLaneKeys();
    _resize();

    _playCtl = MidiPlayer.play(song, {
      onNote: () => {}, // audio handled by MidiPlayer, visuals by our loop
      onEnd:  () => { _active = false; _endListeners.forEach(fn => fn({ score: _score })); },
    });

    requestAnimationFrame(_draw);
    _emitScore();
  }

  function stop() {
    _active = false;
    if (_playCtl) { _playCtl.stop(); _playCtl = null; }
    _song  = null;
    _tiles = [];
    _lastGestureId = 'open';
    _forgivingArmed = true;
    _lastNextSignature = '';
    _updateNextGesture(null, 0);
    if (_ctx && _canvas) _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
    _laneKeys.forEach(el => el.classList.remove('active', 'hit'));
    _syncLaneKeys();
  }

  function pause() {
    if (!_active || _paused) return;
    _paused = true;
    _playCtl?.pause();
  }

  function resume() {
    if (!_active || !_paused) return;
    _paused = false;
    _playCtl?.resume();
    requestAnimationFrame(_draw);
  }

  function setSpeed(v)  { _speed = v;  localStorage.setItem('game_speed', v); }
  function setWindow(v) { _window = v; localStorage.setItem('game_window', v); }
  function getSpeed()   { return _speed; }
  function getWindow()  { return _window; }

  function onScoreChange(fn) { _scoreListeners.push(fn); }
  function onEnd(fn)         { _endListeners.push(fn); }

  return { init, start, stop, pause, resume, setSpeed, setWindow, getSpeed, getWindow, onScoreChange, onEnd };
})();
