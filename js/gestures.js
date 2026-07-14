/**
 * gestures.js — Flex sensor → gesture → lane/note mapping
 *
 * A sensor is "active" when its smoothed value drops below that sensor's
 * bend threshold, and stays active until it rises back to the release threshold.
 * Pressed finger = lower ADC reading for this glove wiring.
 *
 * Gesture table (5 sensors: thumb, index, middle, ring, little):
 *
 *  Pattern  [0,1,2,3,4]   Ref          Lane   Role in a song
 *  ───────────────────────────────────────────────
 *  [1,1,0,0,0]        #1               0      lowest real pitches
 *  [1,0,0,0,0]        #2               1      low real pitches
 *  [0,1,0,0,0]        #3               2      middle real pitches
 *  [0,1,1,0,0]        #4               3      high real pitches
 *  [0,0,0,1,0]        #5               4      higher real pitches
 *  [0,0,0,0,1]        #6               5      still higher real pitches
 *  [1,1,1,0,0]        #8               6      highest real pitches
 *  [0,0,0,0,0]        Open hand        —      —
 *
 * Lane (0-6) = the game column. The actual MIDI note is kept on each song note.
 */

const Gestures = (() => {
  const SENSOR_KEYS = ['keyPinch', 'indexThumb', 'middleThumb', 'ring', 'little'];
  const MIN_THRESHOLD = 0;
  const MAX_THRESHOLD = 4095;
  const DEFAULT_BEND_THRESHOLD = 600;
  const DEFAULT_RELEASE_THRESHOLD = 900;
  const CLASSIFY_GRACE_ADC = 80;
  const GAME_MATCH_GRACE_ADC = 260;

  function _clampThreshold(value) {
    const numeric = parseInt(value, 10);
    if (!Number.isFinite(numeric)) return null;
    return Math.max(MIN_THRESHOLD, Math.min(MAX_THRESHOLD, numeric));
  }

  function _normalizePair(pair) {
    const bend = _clampThreshold(pair?.bend) ?? DEFAULT_BEND_THRESHOLD;
    const release = _clampThreshold(pair?.release) ?? Math.max(DEFAULT_RELEASE_THRESHOLD, bend);
    return {
      bend,
      release: Math.max(bend, release),
    };
  }

  function _readThresholds() {
    const legacy = _clampThreshold(localStorage.getItem('gesture_threshold')) ?? DEFAULT_BEND_THRESHOLD;
    let saved = {};

    try {
      saved = JSON.parse(localStorage.getItem('gesture_thresholds') || '{}') || {};
    } catch {
      saved = {};
    }

    return SENSOR_KEYS.reduce((thresholds, key) => {
      const raw = saved[key];
      thresholds[key] = typeof raw === 'object'
        ? _normalizePair(raw)
        : _normalizePair({ bend: raw ?? legacy, release: Math.max(legacy + 300, DEFAULT_RELEASE_THRESHOLD) });
      return thresholds;
    }, {});
  }

  let _thresholds = _readThresholds();
  let _sensorStates = SENSOR_KEYS.reduce((states, key) => {
    states[key] = false;
    return states;
  }, {});
  let _enabledFingers = SENSOR_KEYS.reduce((enabled, key) => {
    enabled[key] = true;
    return enabled;
  }, {});

  const UNSUPPORTED_GESTURE = {
    id: 'unsupported',
    pattern: null,
    name: 'Нет комбинации',
    lane: null,
    note: null,
    emoji: '—',
  };

  const GESTURE_MAP = [
    // [thumb, index, middle, ring, little]  name       lane  diagnostic note  emoji  keyboard
    { id: 'open',      pattern: [0,0,0,0,0], name: 'Открытая рука',                         lane: null, note: null, emoji: '✋', keys: '0' },
    { id: 'gesture-1', pattern: [1,1,0,0,0], name: '1. Указательный + большой',             lane: 0,    note: 60,   emoji: '1', keys: 'A+S / 1', image: 'assets/gestures/gesture-1-thumb-index.png', color: '#7c3aed', glow: '#a855f7' },
    { id: 'gesture-2', pattern: [1,0,0,0,0], name: '2. Только большой',                     lane: 1,    note: 62,   emoji: '2', keys: 'A / 2', image: 'assets/gestures/gesture-2-thumb.png', color: '#22d3a0', glow: '#34d399' },
    { id: 'gesture-3', pattern: [0,1,0,0,0], name: '3. Только указательный',                lane: 2,    note: 64,   emoji: '3', keys: 'S / 3', image: 'assets/gestures/gesture-3-index.png', color: '#f59e0b', glow: '#fbbf24' },
    { id: 'gesture-4', pattern: [0,1,1,0,0], name: '4. Указательный + средний',             lane: 3,    note: 65,   emoji: '4', keys: 'S+D / 4', image: 'assets/gestures/gesture-4-index-middle.png', color: '#38bdf8', glow: '#7dd3fc' },
    { id: 'gesture-5', pattern: [0,0,0,1,0], name: '5. Только безымянный',                  lane: 4,    note: 67,   emoji: '5', keys: 'F / 5', color: '#f472b6', glow: '#f9a8d4' },
    { id: 'gesture-6', pattern: [0,0,0,0,1], name: '6. Только мизинец',                     lane: 5,    note: 69,   emoji: '6', keys: 'G / 6', color: '#fb7185', glow: '#fda4af' },
    { id: 'gesture-8', pattern: [1,1,1,0,0], name: '8. Указательный + средний + большой',   lane: 6,    note: 72,   emoji: '8', keys: 'A+S+D / 8', image: 'assets/gestures/gesture-8-three-side.png', color: '#8b5cf6', glow: '#a78bfa' },
  ];

  const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  function midiToName(n) {
    if (n === null) return '—';
    const oct = Math.floor(n / 12) - 1;
    return NOTE_NAMES[n % 12] + oct;
  }

  /**
   * Classify current sensor readings into a gesture.
   * @param {object} sensors  readings for all five fingers
   * @returns {{ gesture, lane, note, noteName, emoji, bits }}
   */
  function _sensorActive(name, value) {
    const thresholds = getThresholdPair(name);
    const wasActive = !!_sensorStates[name];
    const bendLimit = Math.min(MAX_THRESHOLD, thresholds.bend + CLASSIFY_GRACE_ADC);
    const active = wasActive
      ? value < thresholds.release
      : value < bendLimit;
    _sensorStates[name] = active;
    return active;
  }

  function patternFit(sensors, pattern) {
    if (!Array.isArray(pattern)) return { matches: false, missing: 0, extra: 0 };

    let missing = 0;
    let extra = 0;

    pattern.forEach((bit, index) => {
      const key = SENSOR_KEYS[index];
      const value = Number(sensors?.[key]);
      const thresholds = getThresholdPair(key);
      const active = !!_sensorStates[key];
      const nearActive = Number.isFinite(value) &&
        value < Math.min(MAX_THRESHOLD, thresholds.bend + GAME_MATCH_GRACE_ADC);

      if (bit === 1 && !active && !nearActive) missing++;
      if (bit === 0 && active) extra++;
    });

    return { matches: missing === 0 && extra === 0, missing, extra };
  }

  function classify(sensors) {
    const bits = SENSOR_KEYS.map(key => _sensorActive(key, sensors[key]) ? 1 : 0);

    let match = bits.every(bit => bit === 0) ? GESTURE_MAP[0] : UNSUPPORTED_GESTURE;
    for (const g of GESTURE_MAP) {
      if (g.pattern.every((bit, index) => bit === bits[index])) {
        match = g; break;
      }
    }

    if (match.pattern && !_patternAvailable(match.pattern)) {
      match = UNSUPPORTED_GESTURE;
    }

    return {
      gesture:  match,
      lane:     _compactLaneForGesture(match),
      note:     match.note,
      noteName: midiToName(match.note),
      emoji:    match.emoji,
      bits,
    };
  }

  /**
   * Legacy fallback for fixed-note mapping. Songs use their own pitch-ranked
   * lane assignment in midi.js so real MIDI notes stay intact.
   */
  function laneForNote(note) {
    if (typeof note !== 'number' || Number.isNaN(note)) return null;
    const normalized = ((note % 12) + 12) % 12;

    let best = null;
    let bestDistance = Infinity;

    for (const gesture of playableGestures()) {
      if (gesture.note === null) continue;
      const pitchClass = gesture.note % 12;
      const distance = Math.min(
        (normalized - pitchClass + 12) % 12,
        (pitchClass - normalized + 12) % 12,
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        best = gesture;
      }
    }

    return best ? _compactLaneForGesture(best) : null;
  }

  /**
   * Given a lane index, return the gesture entry for it.
   */
  function gestureForLane(lane) {
    return playableGestures()[lane] || null;
  }

  function _patternAvailable(pattern) {
    return pattern.every((bit, index) => bit === 0 || _enabledFingers[SENSOR_KEYS[index]] !== false);
  }

  function _compactLaneForGesture(gesture) {
    if (!gesture || gesture.lane === null) return null;
    const lane = playableGestures().findIndex(g => g.id === gesture.id);
    return lane >= 0 ? lane : null;
  }

  function playableGestures() {
    return GESTURE_MAP.filter(g => g.lane !== null && _patternAvailable(g.pattern));
  }

  function laneCount() {
    return playableGestures().length;
  }

  function setEnabledFingers(enabled = {}) {
    SENSOR_KEYS.forEach((key) => {
      if (enabled[key] !== undefined) {
        _enabledFingers[key] = enabled[key] !== false;
        if (!_enabledFingers[key]) _sensorStates[key] = false;
      }
    });
    return getEnabledFingers();
  }

  function getEnabledFingers() {
    return SENSOR_KEYS.reduce((copy, key) => {
      copy[key] = _enabledFingers[key] !== false;
      return copy;
    }, {});
  }

  function _saveThresholds() {
    localStorage.setItem('gesture_thresholds', JSON.stringify(_thresholds));
    localStorage.setItem('gesture_threshold', getThreshold(null, 'bend'));
  }

  function setThreshold(name, type, value) {
    if (type === undefined && value === undefined) {
      const numeric = _clampThreshold(name);
      if (numeric === null) return null;
      _thresholds = SENSOR_KEYS.reduce((thresholds, key) => {
        thresholds[key] = _normalizePair({
          bend: numeric,
          release: Math.max(numeric + 300, DEFAULT_RELEASE_THRESHOLD),
        });
        return thresholds;
      }, {});
      _saveThresholds();
      return getThresholds();
    }

    if (value === undefined) {
      value = type;
      type = 'bend';
    }

    if (!SENSOR_KEYS.includes(name)) return;
    if (type !== 'bend' && type !== 'release') return null;
    const numeric = _clampThreshold(value);
    if (numeric === null) return null;

    _thresholds[name] = _normalizePair({
      ..._thresholds[name],
      [type]: numeric,
    });
    _saveThresholds();
    return getThresholdPair(name);
  }

  function getThreshold(name, type = 'bend') {
    if (name && _thresholds[name] !== undefined) return _thresholds[name][type];
    const sum = SENSOR_KEYS.reduce((total, key) => total + _thresholds[key][type], 0);
    return Math.round(sum / SENSOR_KEYS.length);
  }

  function getThresholdPair(name) {
    return _thresholds[name] ? { ..._thresholds[name] } : _normalizePair();
  }

  function getThresholds() {
    return SENSOR_KEYS.reduce((copy, key) => {
      copy[key] = getThresholdPair(key);
      return copy;
    }, {});
  }
  function allGestures()  { return GESTURE_MAP; }

  return { classify, patternFit, laneForNote, gestureForLane, playableGestures, laneCount, setThreshold, getThreshold, getThresholdPair, getThresholds, setEnabledFingers, getEnabledFingers, allGestures, midiToName };
})();
