/**
 * gestures.js — Flex sensor to gesture and training lane mapping
 *
 * After calibration the ESP32 normalizes every finger to the same direction:
 * 0 = fully bent, 4095 = fully straight. A finger becomes bent at the bend
 * threshold and remains bent until it reaches the higher release threshold.
 *
 * Gesture patterns use 1 for a straight/raised finger and 0 for a bent finger.
 * Pattern order: [thumb, index, middle, ring, little].
 *
 * Only image-backed gestures are playable.
 *
 *  Pattern  [0,1,2,3,4]   Ref          Lane
 *  ───────────────────────────────────────────────
 *  [1,1,0,0,0]        #1               0
 *  [1,0,0,0,0]        #2               1
 *  [0,1,0,0,0]        #3               2
 *  [0,1,1,0,0]        #4               3
 *  [0,1,1,1,0]        Three raised      4
 *  [0,1,1,1,1]        Four raised       5
 *  [1,1,1,0,0]        #8               6
 *  [0,0,0,0,0]        Fist             7
 *  [1,1,1,1,1]        Open hand        8
 *
 * Lane (0-8) is the game column. Note values select generated feedback tones.
 */

const Gestures = (() => {
  const SENSOR_KEYS = ['keyPinch', 'indexThumb', 'middleThumb', 'ring', 'little'];
  const MIN_THRESHOLD = 0;
  const MAX_THRESHOLD = 4095;
  const DEFAULT_BEND_THRESHOLD = 600;
  const DEFAULT_RELEASE_THRESHOLD = 900;
  const MIN_HYSTERESIS_ADC = 200;
  const GAME_MATCH_GRACE_ADC = 260;

  function _clampThreshold(value) {
    const numeric = parseInt(value, 10);
    if (!Number.isFinite(numeric)) return null;
    return Math.max(MIN_THRESHOLD, Math.min(MAX_THRESHOLD, numeric));
  }

  function _normalizePair(pair) {
    let bend = _clampThreshold(pair?.bend) ?? DEFAULT_BEND_THRESHOLD;
    let release = _clampThreshold(pair?.release) ?? DEFAULT_RELEASE_THRESHOLD;

    if (release - bend < MIN_HYSTERESIS_ADC) {
      if (bend + MIN_HYSTERESIS_ADC <= MAX_THRESHOLD) {
        release = bend + MIN_HYSTERESIS_ADC;
      } else {
        release = MAX_THRESHOLD;
        bend = MAX_THRESHOLD - MIN_HYSTERESIS_ADC;
      }
    }

    return { bend, release };
  }

  function _readThresholds() {
    let legacy = DEFAULT_BEND_THRESHOLD;
    let saved = {};

    try {
      legacy = _clampThreshold(localStorage.getItem('gesture_threshold')) ?? DEFAULT_BEND_THRESHOLD;
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
  let _activeGestureIds = null;
  let _lastStorageError = '';

  const UNSUPPORTED_GESTURE = {
    id: 'unsupported',
    pattern: null,
    name: 'Нет комбинации',
    lane: null,
    note: null,
    emoji: '—',
  };

  const GESTURE_MAP = [
    // 1 = straight/raised, 0 = bent
    // [thumb, index, middle, ring, little]  name       lane  diagnostic note  keyboard
    { id: 'gesture-1', pattern: [1,1,0,0,0], name: '1. Указательный + большой',             lane: 0,    note: 60,   emoji: '1', keys: 'A+S / 1', image: 'assets/gestures/gesture-1-thumb-index.png', color: '#7c3aed', glow: '#a855f7' },
    { id: 'gesture-2', pattern: [1,0,0,0,0], name: '2. Только большой',                     lane: 1,    note: 62,   emoji: '2', keys: 'A / 2', image: 'assets/gestures/gesture-2-thumb.png', color: '#22d3a0', glow: '#34d399' },
    { id: 'gesture-3', pattern: [0,1,0,0,0], name: '3. Только указательный',                lane: 2,    note: 64,   emoji: '3', keys: 'S / 3', image: 'assets/gestures/gesture-3-index.png', color: '#f59e0b', glow: '#fbbf24' },
    { id: 'gesture-4', pattern: [0,1,1,0,0], name: '4. Указательный + средний',             lane: 3,    note: 65,   emoji: '4', keys: 'S+D / 4', image: 'assets/gestures/gesture-4-index-middle.png', color: '#38bdf8', glow: '#7dd3fc' },
    { id: 'three-raised', pattern: [0,1,1,1,0], name: 'Три пальца без большого и мизинца', lane: 4,    note: 67,   emoji: '5', keys: 'S+D+F / 5', image: 'assets/gestures/gesture-three-raised.jpeg', color: '#f472b6', glow: '#f9a8d4' },
    { id: 'four-raised',  pattern: [0,1,1,1,1], name: 'Четыре пальца без большого',         lane: 5,    note: 69,   emoji: '6', keys: 'S+D+F+G / 6', image: 'assets/gestures/gesture-four-raised.jpeg', color: '#fb7185', glow: '#fda4af' },
    { id: 'gesture-8', pattern: [1,1,1,0,0], name: '8. Указательный + средний + большой',   lane: 6,    note: 71,   emoji: '8', keys: 'A+S+D / 8', image: 'assets/gestures/gesture-8-three-side.png', color: '#8b5cf6', glow: '#a78bfa' },
    { id: 'fist',      pattern: [0,0,0,0,0], name: 'Кулак',                                lane: 7,    note: 72,   emoji: '0', keys: '0', image: 'assets/gestures/gesture-fist.jpeg', color: '#14b8a6', glow: '#5eead4' },
    { id: 'open-hand', pattern: [1,1,1,1,1], name: 'Открытая ладонь',                       lane: 8,    note: 74,   emoji: '9', keys: 'A+S+D+F+G / 9', image: 'assets/gestures/gesture-open-hand.jpeg', color: '#ec4899', glow: '#f9a8d4' },
  ];

  const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  function pitchToName(n) {
    if (n === null) return '—';
    const oct = Math.floor(n / 12) - 1;
    return NOTE_NAMES[n % 12] + oct;
  }

  function _sensorBent(name, value) {
    const thresholds = getThresholdPair(name);
    const wasBent = !!_sensorStates[name];
    const numeric = Number(value);

    if (!Number.isFinite(numeric)) return wasBent;

    const bent = wasBent
      ? numeric < thresholds.release
      : numeric <= thresholds.bend;
    _sensorStates[name] = bent;
    return bent;
  }

  function patternFit(sensors, pattern) {
    if (!Array.isArray(pattern)) return { matches: false, missing: 0, extra: 0 };

    const invalidInput = SENSOR_KEYS.some(key => (
      _enabledFingers[key] !== false && !Number.isFinite(Number(sensors?.[key]))
    ));
    if (invalidInput) return { matches: false, missing: 1, extra: 0 };

    let missing = 0;
    let extra = 0;

    pattern.forEach((bit, index) => {
      const key = SENSOR_KEYS[index];
      if (_enabledFingers[key] === false) {
        if (bit === 1) missing++;
        return;
      }

      const value = Number(sensors?.[key]);
      const thresholds = getThresholdPair(key);
      const bent = !!_sensorStates[key];
      const nearStraight = Number.isFinite(value) &&
        value >= Math.max(MIN_THRESHOLD, thresholds.release - GAME_MATCH_GRACE_ADC);

      if (bit === 1 && bent && !nearStraight) missing++;
      if (bit === 0 && !bent) extra++;
    });

    return { matches: missing === 0 && extra === 0, missing, extra };
  }

  function classify(sensors) {
    const invalidInput = SENSOR_KEYS.some(key => (
      _enabledFingers[key] !== false && !Number.isFinite(Number(sensors?.[key]))
    ));
    if (invalidInput) {
      return {
        gesture: UNSUPPORTED_GESTURE,
        lane: null,
        note: null,
        noteName: pitchToName(null),
        emoji: UNSUPPORTED_GESTURE.emoji,
        bits: SENSOR_KEYS.map(() => 0),
      };
    }

    const bits = SENSOR_KEYS.map((key) => {
      if (_enabledFingers[key] === false) return 0;
      return _sensorBent(key, sensors?.[key]) ? 0 : 1;
    });

    let match = UNSUPPORTED_GESTURE;
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
      noteName: pitchToName(match.note),
      emoji:    match.emoji,
      bits,
    };
  }

  function laneForPitch(note) {
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
    return GESTURE_MAP.filter(g =>
      g.lane !== null &&
      g.image &&
      _patternAvailable(g.pattern) &&
      (!_activeGestureIds || _activeGestureIds.has(g.id))
    );
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

  function setActiveGestureIds(ids) {
    if (!Array.isArray(ids) || !ids.length) {
      _activeGestureIds = null;
      return null;
    }

    const validIds = new Set(GESTURE_MAP.map(gesture => gesture.id));
    const selected = ids.filter(id => validIds.has(id));
    _activeGestureIds = selected.length ? new Set(selected) : null;
    return getActiveGestureIds();
  }

  function getActiveGestureIds() {
    return _activeGestureIds ? Array.from(_activeGestureIds) : null;
  }

  function _saveThresholds() {
    try {
      localStorage.setItem('gesture_thresholds', JSON.stringify(_thresholds));
      localStorage.setItem('gesture_threshold', getThreshold(null, 'bend'));
      _lastStorageError = '';
      return true;
    } catch (error) {
      _lastStorageError = error?.message || String(error);
      return false;
    }
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

  function allGestures() { return GESTURE_MAP; }

  return {
    classify, patternFit, laneForPitch, gestureForLane, playableGestures, laneCount,
    setThreshold, getThreshold, getThresholdPair, getThresholds,
    setEnabledFingers, getEnabledFingers, setActiveGestureIds, getActiveGestureIds,
    allGestures, pitchToName,
    get lastStorageError() { return _lastStorageError; },
  };
})();
