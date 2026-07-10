const dom = {
  screens: [...document.querySelectorAll(".screen")],
  bestScore: [
    document.getElementById("bestScore"),
    document.getElementById("bestScoreSongs"),
  ],
  songList: document.getElementById("songList"),
  gripOptions: document.getElementById("gripOptions"),
  difficultyOptions: document.getElementById("difficultyOptions"),
  adaptiveOptions: document.getElementById("adaptiveOptions"),
  lanes: document.getElementById("lanes"),
  gestureBar: document.getElementById("gestureBar"),
  keyGrid: document.getElementById("keyGrid"),
  currentGesture: document.getElementById("currentGesture"),
  currentGestureImage: document.getElementById("currentGestureImage"),
  score: document.getElementById("score"),
  combo: document.getElementById("combo"),
  accuracy: document.getElementById("accuracy"),
  judgement: document.getElementById("judgementText"),
  songProgress: document.getElementById("songProgress"),
  trackTitle: document.getElementById("trackTitle"),
  statusDot: document.getElementById("statusDot"),
  statusText: document.getElementById("statusText"),
  diagAccuracy: document.getElementById("diagAccuracy"),
  diagHits: document.getElementById("diagHits"),
  diagMisses: document.getElementById("diagMisses"),
  diagStreak: document.getElementById("diagStreak"),
  diagAttempts: document.getElementById("diagAttempts"),
  successChart: document.getElementById("successChart"),
  calibrationStatus: document.getElementById("calibrationStatus"),
  calibrationGrid: document.getElementById("calibrationGrid"),
};

const STORAGE = {
  bestScore: "flortte.bestScore.v3",
  songRecords: "flortte.songRecords.v3",
  diagnostics: "flortte.diagnostics.v3",
  therapySettings: "flortte.therapySettings.v1",
  calibration: "flortte.calibration.v1",
  esp32Url: "flortte.esp32Url.v1",
};

const CONFIG = {
  leadMs: 1650,
  preRollMs: 1650,
  hitLineBottom: 0.12,
  spawnTopOffset: 118,
  chartGroupMs: 82,
  minGlobalGapMs: 250,
  minLaneGapMs: 330,
  fastRunGapMs: 285,
  scheduleAheadMs: 2200,
  scheduleTickMs: 120,
  progressSaveGapMs: 900,
  inputCooldownMs: 72,
  missGraceMs: 105,
  endPaddingMs: 1300,
  synthGain: 0.18,
  holdNoteMinMs: 420,
  holdReleaseGraceMs: 240,
  adaptiveMinAttempts: 6,
  adaptiveTargetAccuracy: 78,
  adaptiveStrongAccuracy: 88,
  calibrationDefaultMin: 0,
  calibrationDefaultMax: 4095,
  esp32DefaultUrl: "http://192.168.4.1",
  esp32PollMs: 70,
  esp32RetryMs: 1200,
};

const JUDGEMENTS = [
  { id: "perfect", label: "PERFECT", window: 90, score: 150, weight: 1 },
  { id: "great", label: "GREAT", window: 180, score: 115, weight: 0.82 },
  { id: "good", label: "GOOD", window: 300, score: 80, weight: 0.58 },
  { id: "bad", label: "LATE", window: 400, score: 25, weight: 0.22 },
];

const GESTURES = [
  {
    key: "a",
    image: "assets/gestures/gesture-ok.png",
    id: "keyPinch",
    name: "Key pinch",
    description: "большой палец к боковой стороне указательного",
    color: "#66e3a3",
  },
  {
    key: "s",
    image: "assets/gestures/gesture-fist-v.png",
    id: "indexThumb",
    name: "Index-thumb",
    description: "большой палец к указательному",
    color: "#ffe066",
  },
  {
    key: "d",
    image: "assets/gestures/gesture-point-v.png",
    id: "middleThumb",
    name: "Middle-thumb",
    description: "большой палец к среднему",
    color: "#69b7ff",
  },
  {
    key: "j",
    image: "assets/gestures/gesture-thumb.png",
    id: "ringThumb",
    name: "Ring-thumb",
    description: "большой палец к безымянному",
    color: "#ff9d55",
  },
  {
    key: "k",
    image: "assets/gestures/gesture-v-point.png",
    id: "littleThumb",
    name: "Little-thumb",
    description: "большой палец к мизинцу",
    color: "#ff6fb1",
  },
];

const GRIP_KEY_ALIASES = {
  keypinch: "a",
  key_pinch: "a",
  sideindex: "a",
  side_index: "a",
  indexside: "a",
  index_side: "a",
  index: "s",
  indexthumb: "s",
  index_thumb: "s",
  thumbindex: "s",
  thumb_index: "s",
  middle: "d",
  middlethumb: "d",
  middle_thumb: "d",
  thumbmiddle: "d",
  thumb_middle: "d",
  ring: "j",
  ringthumb: "j",
  ring_thumb: "j",
  thumbring: "j",
  thumb_ring: "j",
  little: "k",
  pinky: "k",
  littlethumb: "k",
  little_thumb: "k",
  pinkythumb: "k",
  pinky_thumb: "k",
  thumblittle: "k",
  thumb_little: "k",
  thumbpinky: "k",
  thumb_pinky: "k",
  l: "k",
};

const DIFFICULTIES = {
  easy: {
    label: "Easy",
    minGlobalGapMs: 520,
    minLaneGapMs: 720,
    maxEventsPerMinute: 95,
  },
  medium: {
    label: "Medium",
    minGlobalGapMs: 360,
    minLaneGapMs: 520,
    maxEventsPerMinute: 130,
  },
  hard: {
    label: "Difficult",
    minGlobalGapMs: 250,
    minLaneGapMs: 330,
    maxEventsPerMinute: 180,
  },
};

const SONGS = [
  {
    id: "potter",
    title: "Harry Potter Main Theme",
    artist: "MIDI synth",
    midi: "assets/midi/potter.mid",
    estimatedDuration: 34000,
    bpm: 90,
  },
];

const state = {
  screen: "menu",
  activeSong: SONGS[0],
  chart: null,
  running: false,
  paused: false,
  rafId: 0,
  songStartAt: 0,
  pausedAt: 0,
  nextEventIndex: 0,
  activeTiles: [],
  score: 0,
  combo: 0,
  maxCombo: 0,
  hits: 0,
  misses: 0,
  attempts: 0,
  accuracyWeight: 0,
  health: 100,
  lastProgressSaveAt: 0,
  mode: "song",
  sessionMinutes: 15,
  clockSource: "performance",
  pausedPlaybackMs: 0,
};

const calibrationState = {
  collecting: false,
  startedAt: 0,
};

const esp32Connection = {
  url: localStorage.getItem(STORAGE.esp32Url) || CONFIG.esp32DefaultUrl,
  timerId: 0,
  intervalMs: 0,
  connected: false,
  failures: 0,
  lastSeenAt: 0,
};

const inputState = {
  heldKeys: new Set(),
  gestureStates: new Set(),
  lastGestureAt: new Map(),
};

const synth = {
  context: null,
  master: null,
  timerId: 0,
  nextIndex: 0,
  startAt: 0,
  token: 0,
  nodes: new Set(),
};

let bestScore = readNumber(STORAGE.bestScore, 0);
let songRecords = readObject(STORAGE.songRecords, {});
let diagnostics = readDiagnostics();
let therapySettings = readTherapySettings();
let calibrationProfile = readCalibrationProfile();
let songRenderToken = 0;

function readNumber(key, fallback) {
  const value = Number(localStorage.getItem(key));
  return Number.isFinite(value) ? value : fallback;
}

function readObject(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "");
    return value && typeof value === "object" ? value : fallback;
  } catch {
    return fallback;
  }
}

function readDiagnostics() {
  const saved = readObject(STORAGE.diagnostics, null);
  if (saved) {
    return {
      attempts: Number(saved.attempts || 0),
      hits: Number(saved.hits || 0),
      misses: Number(saved.misses || 0),
      streak: Number(saved.streak || 0),
      history: Array.isArray(saved.history) ? saved.history.slice(-32) : [],
      byKey: saved.byKey && typeof saved.byKey === "object" ? saved.byKey : {},
    };
  }

  return {
    attempts: 0,
    hits: 0,
    misses: 0,
    streak: 0,
    history: [],
    byKey: {},
  };
}

function readTherapySettings() {
  const saved = readObject(STORAGE.therapySettings, {});
  const gripCount = clamp(Number(saved.gripCount || 3), 3, GESTURES.length);
  const difficulty = DIFFICULTIES[saved.difficulty] ? saved.difficulty : "easy";
  const sessionMinutes = clamp(Number(saved.sessionMinutes || 15), 5, 60);
  const adaptive = saved.adaptive !== false;

  return {
    gripCount,
    difficulty,
    sessionMinutes,
    adaptive,
  };
}

function saveTherapySettings() {
  localStorage.setItem(STORAGE.therapySettings, JSON.stringify(therapySettings));
}

function createCalibrationEntry(gesture, saved = {}) {
  const min = Number.isFinite(Number(saved.min)) ? Number(saved.min) : CONFIG.calibrationDefaultMin;
  const max = Number.isFinite(Number(saved.max)) ? Number(saved.max) : CONFIG.calibrationDefaultMax;
  const threshold = Number.isFinite(Number(saved.threshold))
    ? Number(saved.threshold)
    : Math.round((min + max) / 2);

  return {
    key: gesture.key,
    id: gesture.id,
    min,
    max,
    threshold,
    value: Number.isFinite(Number(saved.value)) ? Number(saved.value) : 0,
    active: Boolean(saved.active),
  };
}

function readCalibrationProfile() {
  const saved = readObject(STORAGE.calibration, {});
  return GESTURES.reduce((profile, gesture) => {
    profile[gesture.key] = createCalibrationEntry(gesture, saved[gesture.key]);
    return profile;
  }, {});
}

function saveCalibrationProfile() {
  localStorage.setItem(STORAGE.calibration, JSON.stringify(calibrationProfile));
}

function saveDiagnostics() {
  localStorage.setItem(STORAGE.diagnostics, JSON.stringify(diagnostics));
}

function saveSongRecords() {
  localStorage.setItem(STORAGE.songRecords, JSON.stringify(songRecords));
}

function saveBestScore() {
  localStorage.setItem(STORAGE.bestScore, String(bestScore));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatPercent(value) {
  return `${Math.round(clamp(value, 0, 100))}%`;
}

function formatTime(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function normalizeKey(key) {
  const raw = String(key || "").trim().toLowerCase();
  const compact = raw.replace(/[\s-]/g, "_");
  return GRIP_KEY_ALIASES[compact] || GRIP_KEY_ALIASES[raw] || raw;
}

function getGestureByKey(key) {
  return GESTURES.find((gesture) => gesture.key === normalizeKey(key));
}

function getLaneIndexByKey(key) {
  return GESTURES.findIndex((gesture) => gesture.key === normalizeKey(key));
}

function getActiveGestures(settings = therapySettings) {
  return GESTURES.slice(0, settings.gripCount);
}

function getDifficulty(settings = therapySettings) {
  return DIFFICULTIES[settings.difficulty] || DIFFICULTIES.easy;
}

function createGestureStats(seed = {}) {
  return {
    attempts: Number(seed.attempts || 0),
    hits: Number(seed.hits || 0),
    misses: Number(seed.misses || 0),
    accuracyTotal: Number(seed.accuracyTotal || 0),
    timingTotal: Number(seed.timingTotal || 0),
    timingCount: Number(seed.timingCount || 0),
    holdAttempts: Number(seed.holdAttempts || 0),
    holdSuccess: Number(seed.holdSuccess || 0),
    earlyReleases: Number(seed.earlyReleases || 0),
  };
}

function getGestureStats(key) {
  const normalized = normalizeKey(key);
  diagnostics.byKey[normalized] = createGestureStats(diagnostics.byKey[normalized]);
  return diagnostics.byKey[normalized];
}

function getGesturePerformance(key) {
  const stats = createGestureStats(diagnostics.byKey[normalizeKey(key)]);
  const accuracy = stats.attempts ? stats.hits / stats.attempts * 100 : 100;
  const weightedAccuracy = stats.attempts ? stats.accuracyTotal / stats.attempts : accuracy;
  const averageTiming = stats.timingCount ? stats.timingTotal / stats.timingCount : 0;
  const holdAccuracy = stats.holdAttempts ? stats.holdSuccess / stats.holdAttempts * 100 : 100;
  const confidence = clamp(stats.attempts / CONFIG.adaptiveMinAttempts, 0, 1);
  const weakness = confidence * clamp((CONFIG.adaptiveTargetAccuracy - weightedAccuracy) / CONFIG.adaptiveTargetAccuracy, 0, 1);

  return {
    ...stats,
    accuracy,
    weightedAccuracy,
    averageTiming,
    holdAccuracy,
    confidence,
    weakness,
  };
}

function getAdaptiveSettings(settings = therapySettings) {
  if (!settings.adaptive) return { ...settings, adaptive: false };

  const activeGestures = getActiveGestures(settings);
  const performances = activeGestures.map((gesture) => getGesturePerformance(gesture.key));
  const mature = performances.filter((item) => item.attempts >= CONFIG.adaptiveMinAttempts);
  const averageAccuracy = mature.length
    ? mature.reduce((sum, item) => sum + item.weightedAccuracy, 0) / mature.length
    : 100;
  const worstAccuracy = mature.length
    ? Math.min(...mature.map((item) => item.weightedAccuracy))
    : 100;

  let difficulty = settings.difficulty;
  if (mature.length >= activeGestures.length) {
    if (worstAccuracy < 58 || averageAccuracy < 68) {
      difficulty = "easy";
    } else if (averageAccuracy >= CONFIG.adaptiveStrongAccuracy && worstAccuracy >= 72) {
      difficulty = settings.gripCount >= 5 ? "hard" : "medium";
    } else if (averageAccuracy >= CONFIG.adaptiveTargetAccuracy) {
      difficulty = "medium";
    }
  }

  let gripCount = settings.gripCount;
  if (mature.length >= gripCount && averageAccuracy >= CONFIG.adaptiveStrongAccuracy && worstAccuracy >= 76) {
    gripCount = Math.min(GESTURES.length, gripCount + 1);
  } else if (mature.length >= gripCount && worstAccuracy < 50) {
    gripCount = Math.max(3, gripCount - 1);
  }

  return {
    ...settings,
    adaptive: true,
    difficulty,
    gripCount,
    adaptiveSummary: {
      averageAccuracy,
      worstAccuracy,
      matureCount: mature.length,
    },
  };
}

function midiFrequency(note) {
  return 440 * 2 ** ((note - 69) / 12);
}

function noteLabel(note) {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return `${names[note % 12]}${Math.floor(note / 12) - 1}`;
}

function readMidiVar(bytes, cursor) {
  let value = 0;
  let offset = cursor;

  while (offset < bytes.length) {
    const byte = bytes[offset];
    offset += 1;
    value = (value << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) break;
  }

  return { value, offset };
}

function readAscii(bytes, offset, length) {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function readUint16(bytes, offset) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint32(bytes, offset) {
  return (
    (bytes[offset] << 24) |
    (bytes[offset + 1] << 16) |
    (bytes[offset + 2] << 8) |
    bytes[offset + 3]
  ) >>> 0;
}

function parseMidiFile(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let offset = 0;

  function readChunkHeader() {
    const id = readAscii(bytes, offset, 4);
    const length = readUint32(bytes, offset + 4);
    offset += 8;
    return { id, length };
  }

  const header = readChunkHeader();
  if (header.id !== "MThd") {
    throw new Error("Файл не похож на MIDI");
  }

  const format = readUint16(bytes, offset);
  const trackCount = readUint16(bytes, offset + 2);
  const division = readUint16(bytes, offset + 4);
  offset += header.length;

  if (division & 0x8000) {
    throw new Error("SMPTE MIDI time division пока не поддерживается");
  }

  const ticksPerQuarter = division;
  const midiEvents = [];
  const tempoEvents = [{ tick: 0, tempo: 500000 }];

  for (let trackIndex = 0; trackIndex < trackCount && offset < bytes.length; trackIndex += 1) {
    const chunk = readChunkHeader();
    const trackEnd = offset + chunk.length;
    if (chunk.id !== "MTrk") {
      offset = trackEnd;
      continue;
    }

    let tick = 0;
    let runningStatus = null;

    while (offset < trackEnd) {
      const delta = readMidiVar(bytes, offset);
      tick += delta.value;
      offset = delta.offset;

      let status = bytes[offset];
      if (status & 0x80) {
        offset += 1;
        runningStatus = status;
      } else if (runningStatus !== null) {
        status = runningStatus;
      } else {
        throw new Error("MIDI running status потерян");
      }

      if (status === 0xff) {
        const metaType = bytes[offset];
        offset += 1;
        const size = readMidiVar(bytes, offset);
        offset = size.offset;
        if (metaType === 0x51 && size.value === 3) {
          tempoEvents.push({
            tick,
            tempo: (bytes[offset] << 16) | (bytes[offset + 1] << 8) | bytes[offset + 2],
          });
        }
        offset += size.value;
        runningStatus = null;
        if (metaType === 0x2f) break;
        continue;
      }

      if (status === 0xf0 || status === 0xf7) {
        const size = readMidiVar(bytes, offset);
        offset = size.offset + size.value;
        runningStatus = null;
        continue;
      }

      const type = status & 0xf0;
      const channel = status & 0x0f;
      const dataLength = type === 0xc0 || type === 0xd0 ? 1 : 2;
      const first = bytes[offset];
      const second = dataLength > 1 ? bytes[offset + 1] : 0;
      offset += dataLength;

      if (type === 0x90 && second > 0) {
        midiEvents.push({
          track: trackIndex,
          tick,
          type: "on",
          channel,
          note: first,
          velocity: second,
        });
      } else if (type === 0x80 || (type === 0x90 && second === 0)) {
        midiEvents.push({
          track: trackIndex,
          tick,
          type: "off",
          channel,
          note: first,
        });
      }
    }

    offset = trackEnd;
  }

  tempoEvents.sort((a, b) => a.tick - b.tick);
  const tempoSegments = [];
  let segmentTick = 0;
  let segmentMs = 0;
  let segmentTempo = 500000;

  tempoSegments.push({ tick: segmentTick, ms: segmentMs, tempo: segmentTempo });
  tempoEvents.slice(1).forEach((event) => {
    segmentMs += (event.tick - segmentTick) * segmentTempo / ticksPerQuarter / 1000;
    segmentTick = event.tick;
    segmentTempo = event.tempo;
    tempoSegments.push({ tick: segmentTick, ms: segmentMs, tempo: segmentTempo });
  });

  function tickToMs(tick) {
    let segment = tempoSegments[0];
    for (let index = 1; index < tempoSegments.length; index += 1) {
      if (tempoSegments[index].tick > tick) break;
      segment = tempoSegments[index];
    }
    return segment.ms + (tick - segment.tick) * segment.tempo / ticksPerQuarter / 1000;
  }

  const activeNotes = new Map();
  const notes = [];

  midiEvents
    .sort((a, b) => a.tick - b.tick || (a.type === "off" ? -1 : 1))
    .forEach((event) => {
      const key = `${event.track}:${event.channel}:${event.note}`;
      if (event.type === "on") {
        const queue = activeNotes.get(key) || [];
        queue.push(event);
        activeNotes.set(key, queue);
        return;
      }

      const queue = activeNotes.get(key);
      if (!queue || !queue.length) return;
      const start = queue.shift();
      const startMs = tickToMs(start.tick);
      const endMs = tickToMs(event.tick);
      notes.push({
        time: Math.max(0, Math.round(startMs)),
        note: Math.round(start.note),
        velocity: clamp(Number(start.velocity || 72), 1, 127),
        duration: Math.max(80, Math.round(endMs - startMs)),
      });
    });

  activeNotes.forEach((queue) => {
    queue.forEach((start) => {
      notes.push({
        time: Math.max(0, Math.round(tickToMs(start.tick))),
        note: Math.round(start.note),
        velocity: clamp(Number(start.velocity || 72), 1, 127),
        duration: 180,
      });
    });
  });

  return {
    format,
    trackCount,
    ticksPerQuarter,
    notes: notes.sort((a, b) => a.time - b.time || b.note - a.note),
  };
}

async function loadSongNotes(song) {
  if (song.midiNotes) return song.midiNotes;
  if (song.midiNotesPromise) return song.midiNotesPromise;

  song.midiNotesPromise = fetch(song.midi)
    .then((response) => {
      if (!response.ok) throw new Error(`Не удалось загрузить ${song.midi}`);
      return response.arrayBuffer();
    })
    .then((buffer) => {
      const parsed = parseMidiFile(buffer);
      song.midiInfo = parsed;
      song.midiNotes = parsed.notes;
      const endMs = parsed.notes.reduce((max, note) => Math.max(max, note.time + note.duration), 0);
      song.estimatedDuration = Math.max(song.estimatedDuration || 0, endMs + CONFIG.endPaddingMs);
      return song.midiNotes;
    })
    .catch((error) => {
      console.warn(error);
      song.midiLoadError = error;
      song.midiNotes = [];
      return song.midiNotes;
    });

  return song.midiNotesPromise;
}

function buildBeatEventsFromMidiNotes(notes, activeGestures = getActiveGestures(), settings = therapySettings) {
  if (!notes.length) return [];

  const sortedNotes = notes
    .slice()
    .sort((a, b) => a.time - b.time || a.note - b.note || b.velocity - a.velocity);

  const pitches = [...new Set(sortedNotes.map((event) => event.note))].sort((a, b) => a - b);
  const activeLanes = buildAdaptiveLanePalette(activeGestures, settings);

  return sortedNotes.map((event, index) => {
    const duration = Math.max(80, Math.round(Number(event.duration || 180)));
    const isHold = duration >= Math.max(260, CONFIG.holdNoteMinMs - 220);

    return {
      id: `beat-${index}`,
      time: Math.max(0, Math.round(event.time)),
      midiNote: Number(event.note),
      noteLabel: noteLabel(Number(event.note)),
      velocity: clamp(Number(event.velocity || 72), 1, 127),
      duration,
      isHold,
      chordSize: 1,
      laneIndex: pickLaneFromPitch(Number(event.note), pitches, activeLanes),
    };
  });
}

function splitRuns(events) {
  if (!events.length) return [];

  const runs = [];
  let run = [events[0]];

  for (let index = 1; index < events.length; index += 1) {
    const previous = events[index - 1];
    const current = events[index];
    if (current.time - previous.time <= CONFIG.fastRunGapMs) {
      run.push(current);
    } else {
      runs.push(run);
      run = [current];
    }
  }

  runs.push(run);
  return runs;
}

function pickLaneFromPitch(note, pitches, lanes) {
  const pitchIndex = Math.max(0, pitches.indexOf(note));
  const ratio = pitches.length > 1 ? pitchIndex / (pitches.length - 1) : 0;
  const laneOffset = Math.round(ratio * (lanes.length - 1));
  return lanes[laneOffset] ?? lanes[0] ?? 0;
}

function buildAdaptiveLanePalette(activeGestures, settings) {
  const base = activeGestures.map((_, index) => index);
  if (!settings.adaptive) return base;

  const palette = [];
  activeGestures.forEach((gesture, index) => {
    const performance = getGesturePerformance(gesture.key);
    const repeats = 1 + Math.round(performance.weakness * 4);
    for (let repeat = 0; repeat < repeats; repeat += 1) {
      palette.push(index);
    }
  });

  return palette.length ? palette : base;
}

function assignLanes(events, activeGestures = getActiveGestures(), settings = therapySettings) {
  const pitches = [...new Set(events.map((event) => event.midiNote))].sort((a, b) => a - b);
  const activeLanes = buildAdaptiveLanePalette(activeGestures, settings);

  return events.map((event) => ({
    ...event,
    laneIndex: pickLaneFromPitch(event.midiNote, pitches, activeLanes),
  }));
}

function thinPlayableEvents(events, settings = therapySettings) {
  const difficulty = getDifficulty(settings);
  const activeGestures = getActiveGestures(settings);
  const lastLaneAt = new Array(activeGestures.length).fill(-Infinity);
  const laneBusyUntil = new Array(activeGestures.length).fill(-Infinity);
  let lastGlobalAt = -Infinity;
  let minuteStart = -Infinity;
  let eventsThisMinute = 0;

  return events
    .slice()
    .sort((a, b) => a.time - b.time || a.laneIndex - b.laneIndex)
    .filter((event) => {
      if (event.time - minuteStart >= 60000) {
        minuteStart = event.time;
        eventsThisMinute = 0;
      }

      if (event.time - lastGlobalAt < difficulty.minGlobalGapMs) return false;
      if (event.time - lastLaneAt[event.laneIndex] < difficulty.minLaneGapMs) return false;
      if (event.time < laneBusyUntil[event.laneIndex]) return false;
      if (eventsThisMinute >= difficulty.maxEventsPerMinute) return false;
      lastGlobalAt = event.time;
      lastLaneAt[event.laneIndex] = event.time;
      laneBusyUntil[event.laneIndex] = event.time + (
        isHoldNote(event)
          ? getHoldDuration(event) + CONFIG.holdReleaseGraceMs
          : difficulty.minLaneGapMs
      );
      eventsThisMinute += 1;
      return true;
    });
}

function buildFallbackChart(song, settings = therapySettings) {
  const activeGestures = getActiveGestures(settings);
  const pattern = activeGestures.map((_, index) => index);
  const beatMs = 60000 / song.bpm;
  const events = [];

  for (let time = 0; time < 42000; time += beatMs / 2) {
    const laneIndex = pattern[events.length % pattern.length];
    events.push({
      id: `${song.id}-fallback-${events.length}`,
      time: Math.round(time),
      laneIndex,
      midiNote: 60 + laneIndex,
      noteLabel: noteLabel(60 + laneIndex),
      velocity: 88,
      duration: 180,
      chordSize: 1,
    });
  }

  return events;
}

function expandSessionEvents(events, baseDuration, targetDuration) {
  if (!events.length || targetDuration <= baseDuration) return events;

  const expanded = [];
  let offset = 0;
  let loop = 0;

  while (offset < targetDuration) {
    events.forEach((event) => {
      const time = event.time + offset;
      if (time >= targetDuration) return;
      expanded.push({
        ...event,
        id: `${event.id}-loop-${loop}`,
        time,
      });
    });
    loop += 1;
    offset += baseDuration;
  }

  return expanded;
}

function buildChart(song, options = {}) {
  const settings = getAdaptiveSettings(options.settings || therapySettings);
  const activeGestures = getActiveGestures(settings);
  const rawNotes = Array.isArray(options.rawNotes) ? options.rawNotes : [];
  const sourceEvents = rawNotes.length
    ? buildBeatEventsFromMidiNotes(rawNotes, activeGestures, settings)
    : buildFallbackChart(song, settings);
  const assigned = rawNotes.length ? assignLanes(sourceEvents, activeGestures, settings) : sourceEvents;
  const basePlayable = thinPlayableEvents(assigned, settings);
  const baseLastEvent = basePlayable[basePlayable.length - 1];
  const baseDuration = Math.max(
    song.estimatedDuration || 0,
    baseLastEvent ? baseLastEvent.time + Math.max(1000, baseLastEvent.duration) + CONFIG.endPaddingMs : 45000,
  );
  const targetDuration = options.mode === "session"
    ? settings.sessionMinutes * 60 * 1000
    : baseDuration;
  const sessionEvents = expandSessionEvents(basePlayable, baseDuration, targetDuration);
  const playable = sessionEvents.map((event, index) => {
    const gesture = activeGestures[event.laneIndex];
    return {
      ...event,
      id: `${song.id}-${index}`,
      key: gesture.key,
      color: gesture.color,
    };
  });
  const lastEvent = playable[playable.length - 1];
  const duration = options.mode === "session"
    ? targetDuration
    : Math.max(
      targetDuration,
      lastEvent ? lastEvent.time + Math.max(1000, lastEvent.duration) + CONFIG.endPaddingMs : 45000,
    );

  return {
    song,
    events: playable,
    duration,
    rawCount: rawNotes.length,
    beatCount: sourceEvents.length,
    activeGripCount: activeGestures.length,
    difficulty: settings.difficulty,
    mode: options.mode || "song",
    effectiveSettings: settings,
  };
}

function ensureAudio() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;

  if (!synth.context) {
    synth.context = new AudioContextClass();
    synth.master = synth.context.createGain();
    synth.master.gain.value = CONFIG.synthGain;
    synth.master.connect(synth.context.destination);
  }

  synth.context.resume();
  return synth.context;
}

function stopSynth() {
  if (synth.timerId) {
    clearInterval(synth.timerId);
    synth.timerId = 0;
  }

  synth.token += 1;
  synth.nextIndex = 0;
  synth.nodes.forEach((nodeSet) => {
    try {
      nodeSet.oscillator.stop();
    } catch {
      // Already stopped.
    }
    try {
      nodeSet.body.stop();
    } catch {
      // Already stopped.
    }
    try {
      nodeSet.oscillator.disconnect();
      nodeSet.body.disconnect();
      nodeSet.filter.disconnect();
      nodeSet.gain.disconnect();
    } catch {
      // Best-effort cleanup.
    }
  });
  synth.nodes.clear();
}

function playSynthNote(event, startAt, token) {
  const context = synth.context;
  if (!context || token !== synth.token) return;

  const duration = clamp(event.duration / 1000, 0.08, 4.2);
  const endAt = startAt + duration;
  const velocity = clamp(event.velocity / 127, 0.18, 1);
  const oscillator = context.createOscillator();
  const body = context.createOscillator();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();

  oscillator.type = "triangle";
  oscillator.frequency.setValueAtTime(midiFrequency(event.midiNote), startAt);
  body.type = "square";
  body.frequency.setValueAtTime(midiFrequency(event.midiNote - 12), startAt);

  filter.type = "lowpass";
  filter.frequency.setValueAtTime(1800 + velocity * 2200, startAt);
  filter.frequency.linearRampToValueAtTime(900, endAt);
  filter.Q.value = 0.7;

  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.linearRampToValueAtTime(0.24 * velocity, startAt + 0.01);
  gain.gain.linearRampToValueAtTime(0.12 * velocity, startAt + 0.18);
  gain.gain.linearRampToValueAtTime(0.0001, endAt + 0.08);

  oscillator.connect(filter);
  body.connect(filter);
  filter.connect(gain);
  gain.connect(synth.master);

  const nodeSet = { oscillator, body, filter, gain };
  synth.nodes.add(nodeSet);
  oscillator.addEventListener("ended", () => {
    try {
      oscillator.disconnect();
      body.disconnect();
      filter.disconnect();
      gain.disconnect();
    } catch {
      // Already disconnected.
    }
    synth.nodes.delete(nodeSet);
  }, { once: true });

  oscillator.start(startAt);
  body.start(startAt);
  oscillator.stop(endAt + 0.1);
  body.stop(endAt + 0.08);
}

function scheduleSynth(chart, offsetMs) {
  const context = ensureAudio();
  if (!context || !chart.events.length) return false;

  stopSynth();
  synth.token += 1;
  const token = synth.token;
  synth.nextIndex = chart.events.findIndex((event) => event.time >= offsetMs - 120);
  if (synth.nextIndex < 0) synth.nextIndex = chart.events.length;
  synth.startAt = context.currentTime - offsetMs / 1000;

  function scheduleWindow() {
    const playheadMs = (context.currentTime - synth.startAt) * 1000;
    const scheduleUntil = playheadMs + CONFIG.scheduleAheadMs;

    while (synth.nextIndex < chart.events.length && chart.events[synth.nextIndex].time <= scheduleUntil) {
      const event = chart.events[synth.nextIndex];
      const startAt = synth.startAt + event.time / 1000;
      if (startAt > context.currentTime - 0.03) {
        playSynthNote(event, startAt, token);
      }
      synth.nextIndex += 1;
    }
  }

  scheduleWindow();
  synth.timerId = window.setInterval(scheduleWindow, CONFIG.scheduleTickMs);
  return true;
}

function setScreen(name) {
  state.screen = name;
  dom.screens.forEach((screen) => {
    screen.classList.toggle("active", screen.dataset.screen === name);
  });

  if (name !== "game") {
    stopGame();
  }
}

function getSongRecord(song) {
  return songRecords[song.id] || { progress: 0, best: 0, accuracy: 0, plays: 0 };
}

function setSongRecord(song, patch) {
  songRecords[song.id] = {
    ...getSongRecord(song),
    ...patch,
  };
  saveSongRecords();
}

function updateBestScoreNodes() {
  dom.bestScore.forEach((node) => {
    if (node) node.textContent = String(bestScore);
  });
}

function updateStatus(ready, label = null) {
  dom.statusDot.classList.toggle("off", !ready);
  dom.statusText.textContent = label || (ready ? "готов" : "ожидание");
}

function renderTherapyOptions() {
  dom.gripOptions?.querySelectorAll("[data-grip-count]").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.gripCount) === therapySettings.gripCount);
  });

  dom.difficultyOptions?.querySelectorAll("[data-difficulty]").forEach((button) => {
    button.classList.toggle("active", button.dataset.difficulty === therapySettings.difficulty);
  });

  dom.adaptiveOptions?.querySelectorAll("[data-adaptive]").forEach((button) => {
    const enabled = button.dataset.adaptive === "on";
    button.classList.toggle("active", enabled === therapySettings.adaptive);
  });
}

async function renderSongs() {
  const token = ++songRenderToken;
  dom.songList.innerHTML = "";

  SONGS.forEach((song) => {
    const row = document.createElement("article");
    row.className = "song-row";
    row.innerHTML = `
      <span class="song-icon">...</span>
      <span>
        <span class="song-name">${song.title}</span>
        <span class="song-meta">загрузка MIDI-файла...</span>
      </span>
      <span class="mini-progress"><span style="width:0%"></span></span>
      <button class="play-song" aria-label="Играть ${song.title}" disabled></button>
    `;
    dom.songList.appendChild(row);
  });

  const rows = [...dom.songList.querySelectorAll(".song-row")];

  await Promise.all(SONGS.map(async (song, index) => {
    const rawNotes = await loadSongNotes(song);
    if (token !== songRenderToken) return;
    const effectiveSettings = getAdaptiveSettings(therapySettings);

    const chart = buildChart(song, {
      settings: effectiveSettings,
      rawNotes,
    });
    const record = getSongRecord(song);
    const difficulty = getDifficulty(effectiveSettings);
    const row = rows[index];
    if (!row) return;
    const adaptiveLabel = effectiveSettings.adaptive
      ? `Adaptive · ${difficulty.label}`
      : difficulty.label;

    row.innerHTML = `
      <span class="song-icon">${chart.events.length}</span>
      <span>
        <span class="song-name">${song.title}</span>
        <span class="song-meta">${adaptiveLabel} · ${chart.activeGripCount} хвата · ${formatTime(chart.duration)} · ${rawNotes.length} MIDI битов → ${chart.events.length} игровых · рекорд ${record.best || 0}</span>
      </span>
      <span class="mini-progress"><span style="width:${clamp(record.progress || 0, 0, 100)}%"></span></span>
      <button class="play-song" aria-label="Играть ${song.title}"></button>
    `;
    row.querySelector("button").addEventListener("click", () => startGame(song));
  }));
}

function renderGestureSurfaces(settings = therapySettings) {
  const activeGestures = getActiveGestures(settings);
  dom.lanes.innerHTML = "";
  dom.gestureBar.innerHTML = "";
  dom.lanes.style.setProperty("--lane-count", activeGestures.length);
  dom.gestureBar.style.setProperty("--lane-count", activeGestures.length);

  activeGestures.forEach((gesture) => {
    const lane = document.createElement("div");
    lane.className = "lane";
    lane.dataset.key = gesture.key;
    lane.style.setProperty("--lane-color", gesture.color);
    lane.style.setProperty("--hit-line-bottom", `${CONFIG.hitLineBottom * 100}%`);
    dom.lanes.appendChild(lane);

    const slot = document.createElement("button");
    slot.className = "gesture-slot";
    slot.dataset.key = gesture.key;
    slot.style.setProperty("--lane-color", gesture.color);
    slot.innerHTML = `
      <img src="${gesture.image}" alt="${gesture.name}">
      <kbd>${gesture.key}</kbd>
    `;
    slot.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      setGestureState(gesture.key, true, { source: "touch", force: true });
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach((eventName) => {
      slot.addEventListener(eventName, () => {
        setGestureState(gesture.key, false, { source: "touch" });
      });
    });
    dom.gestureBar.appendChild(slot);
  });
}

function renderDiagnostics() {
  dom.keyGrid.innerHTML = "";

  GESTURES.forEach((gesture) => {
    const data = createGestureStats(diagnostics.byKey[gesture.key]);
    const performance = getGesturePerformance(gesture.key);
    const card = document.createElement("div");
    card.className = "key-card";
    card.dataset.key = gesture.key;
    card.style.setProperty("--lane-color", gesture.color);
    card.innerHTML = `
      <img src="${gesture.image}" alt="${gesture.name}">
      <span>
        <b>${gesture.key} · ${gesture.name}</b>
        <small>${gesture.description} · ${data.hits}/${data.attempts} · ${Math.round(performance.weightedAccuracy)}%</small>
      </span>
    `;
    dom.keyGrid.appendChild(card);
  });

  renderCalibrationPanel();
  updateDiagnosticsPanel();
}

function renderCalibrationPanel() {
  if (!dom.calibrationGrid) return;

  dom.calibrationStatus.textContent = calibrationState.collecting
    ? "идет сбор min/max"
    : "готова";
  dom.calibrationGrid.innerHTML = "";

  GESTURES.forEach((gesture) => {
    const entry = calibrationProfile[gesture.key] || createCalibrationEntry(gesture);
    const range = Math.max(1, entry.max - entry.min);
    const meter = clamp((entry.value - entry.min) / range * 100, 0, 100);
    const card = document.createElement("div");
    card.className = "calibration-card";
    card.classList.toggle("active", entry.active);
    card.style.setProperty("--lane-color", gesture.color);
    card.innerHTML = `
      <b>${gesture.name}</b>
      <div class="calibration-meter"><span style="--meter:${meter}%"></span></div>
      <small>live ${Math.round(entry.value)} · min ${Math.round(entry.min)} · max ${Math.round(entry.max)} · th ${Math.round(entry.threshold)}</small>
    `;
    dom.calibrationGrid.appendChild(card);
  });
}

function updateDiagnosticsPanel() {
  const accuracy = diagnostics.attempts ? diagnostics.hits / diagnostics.attempts * 100 : 0;
  dom.diagAccuracy.textContent = formatPercent(accuracy);
  dom.diagHits.textContent = String(diagnostics.hits);
  dom.diagMisses.textContent = String(diagnostics.misses);
  dom.diagStreak.textContent = String(diagnostics.streak);
  dom.diagAttempts.textContent = `${diagnostics.attempts} попыток`;

  const normalizedHistory = diagnostics.history
    .map(normalizeHistoryItem)
    .filter((item) => item !== null)
    .slice(-32);
  const padded = [
    ...Array(Math.max(0, 32 - normalizedHistory.length)).fill(null),
    ...normalizedHistory,
  ];

  dom.successChart.innerHTML = "";
  padded.forEach((item) => {
    const bar = document.createElement("span");
    bar.className = "success-bar";
    if (item === null) {
      bar.classList.add("empty");
      bar.style.height = "8%";
    } else {
      bar.classList.add(item.result);
      const height = item.result === "miss" || item.result === "bad"
        ? clamp(item.value, 14, 34)
        : clamp(item.value, 18, 100);
      bar.style.height = `${height}%`;
      bar.title = `${item.label}: ${Math.round(item.value)}%`;
      bar.setAttribute("aria-label", bar.title);
    }
    dom.successChart.appendChild(bar);
  });
}

function normalizeHistoryItem(item) {
  if (item === null || item === undefined) return null;

  if (typeof item === "boolean") {
    return item
      ? { result: "perfect", value: 100, label: "Успех" }
      : { result: "miss", value: 20, label: "Ошибка" };
  }

  if (typeof item === "number") {
    const value = clamp(item, 0, 100);
    return {
      result: value >= 85 ? "perfect" : value >= 58 ? "good" : "miss",
      value,
      label: "Попытка",
    };
  }

  if (typeof item !== "object") return null;

  const allowedResults = new Set(["perfect", "great", "good", "bad", "miss"]);
  const value = clamp(Number(item.value ?? item.accuracy ?? 0), 0, 100);
  const fallbackResult = value >= 95 ? "perfect" : value >= 75 ? "great" : value >= 45 ? "good" : "miss";
  const result = allowedResults.has(item.result) ? item.result : fallbackResult;
  const labels = {
    perfect: "Perfect",
    great: "Great",
    good: "Good",
    bad: "Late",
    miss: "Miss",
  };

  return {
    result,
    value: result === "miss" || result === "bad" ? Math.max(value, 20) : value,
    label: labels[result],
  };
}

function setCurrentGesture(gesture) {
  dom.currentGesture.textContent = `${gesture.key} · ${gesture.name}`;
  dom.currentGestureImage.src = gesture.image;
  dom.currentGestureImage.alt = gesture.name;

  document.querySelectorAll(".key-card").forEach((card) => {
    card.classList.toggle("active", card.dataset.key === gesture.key);
  });
}

function recordDiagnostic(key, result, value = 100, details = {}) {
  const gesture = getGestureByKey(key);
  if (!gesture) return;

  const success = result !== "miss" && result !== "bad";
  const byKey = getGestureStats(gesture.key);
  byKey.attempts += 1;
  if (success) byKey.hits += 1;
  if (!success) byKey.misses += 1;
  byKey.accuracyTotal += clamp(Number(value || 0), 0, 100);
  if (Number.isFinite(details.timingErrorMs)) {
    byKey.timingTotal += Math.abs(details.timingErrorMs);
    byKey.timingCount += 1;
  }
  if (details.hold) {
    byKey.holdAttempts += 1;
    if (success) byKey.holdSuccess += 1;
    if (details.earlyRelease) byKey.earlyReleases += 1;
  }
  diagnostics.byKey[gesture.key] = byKey;

  diagnostics.attempts += 1;
  if (success) {
    diagnostics.hits += 1;
    diagnostics.streak += 1;
  } else {
    diagnostics.misses += 1;
    diagnostics.streak = 0;
  }

  diagnostics.history.push({ result, value, key: gesture.key });
  diagnostics.history = diagnostics.history.slice(-32);
  saveDiagnostics();
  if (state.screen === "diagnostics") {
    renderDiagnostics();
  } else {
    updateDiagnosticsPanel();
  }
}

function resetRuntimeStats() {
  state.score = 0;
  state.combo = 0;
  state.maxCombo = 0;
  state.hits = 0;
  state.misses = 0;
  state.attempts = 0;
  state.accuracyWeight = 0;
  state.health = 100;
  state.nextEventIndex = 0;
  state.activeTiles = [];
  state.lastProgressSaveAt = 0;
}

function updateHud(label = "READY") {
  dom.score.textContent = String(state.score);
  dom.combo.textContent = String(state.combo);
  dom.accuracy.textContent = formatPercent(state.attempts ? state.accuracyWeight / state.attempts * 100 : 100);
  dom.judgement.textContent = label;
}

function getPlaybackMs() {
  if (!state.running) return 0;
  if (state.paused) return state.pausedPlaybackMs;

  if (state.clockSource === "audio" && synth.context && Number.isFinite(synth.startAt)) {
    return (synth.context.currentTime - synth.startAt) * 1000;
  }

  const now = performance.now();
  return now - state.songStartAt;
}

async function startGame(song, options = {}) {
  stopGame();
  state.activeSong = song;
  state.mode = options.mode || "song";
  state.sessionMinutes = therapySettings.sessionMinutes;
  dom.trackTitle.textContent = "Загрузка MIDI...";
  updateHud("LOADING");
  setScreen("game");

  const rawNotes = await loadSongNotes(song);
  if (state.screen !== "game") return;

  state.chart = buildChart(song, {
    mode: state.mode,
    settings: therapySettings,
    rawNotes,
  });
  resetRuntimeStats();
  renderGestureSurfaces(state.chart.effectiveSettings);
  dom.trackTitle.textContent = state.mode === "session" ? `${song.title} · Session` : song.title;
  dom.songProgress.style.width = "0%";
  updateHud("READY");

  state.running = true;
  state.paused = false;
  state.songStartAt = performance.now() + CONFIG.preRollMs;
  setSongRecord(song, { plays: (getSongRecord(song).plays || 0) + 1 });
  if (scheduleSynth(state.chart, -CONFIG.preRollMs)) {
    state.clockSource = "audio";
  } else {
    state.clockSource = "performance";
  }
  state.rafId = requestAnimationFrame(tickGame);
}

function startSession() {
  startGame(state.activeSong || SONGS[0], { mode: "session" });
}

function stopGame() {
  if (state.running && state.chart) {
    saveProgress(clamp(getPlaybackMs() / state.chart.duration * 100, 0, 100));
  }

  if (state.rafId) {
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
  }

  stopSynth();
  state.activeTiles.forEach((tile) => tile.node.remove());
  state.activeTiles = [];
  state.running = false;
  state.paused = false;
  inputState.heldKeys.clear();
  inputState.gestureStates.clear();
}

function pauseGame() {
  if (!state.running || state.paused) return;
  state.pausedPlaybackMs = getPlaybackMs();
  state.paused = true;
  state.pausedAt = performance.now();
  stopSynth();
  if (state.rafId) {
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
  }
  updateHud("PAUSE");
}

function resumeGame() {
  if (!state.running || !state.paused) return;
  state.songStartAt = performance.now() - state.pausedPlaybackMs;
  state.paused = false;
  if (scheduleSynth(state.chart, state.pausedPlaybackMs)) {
    state.clockSource = "audio";
  } else {
    state.clockSource = "performance";
  }
  state.rafId = requestAnimationFrame(tickGame);
}

function togglePause() {
  if (state.paused) {
    resumeGame();
  } else {
    pauseGame();
  }
}

function getHoldDuration(event) {
  return Math.max(0, Number(event.duration || 0));
}

function isHoldNote(event) {
  return Boolean(event.isHold) || getHoldDuration(event) >= CONFIG.holdNoteMinMs;
}

function getHoldEndTime(event) {
  return event.time + getHoldDuration(event);
}

function spawnTile(event) {
  const lane = dom.lanes.children[event.laneIndex];
  if (!lane) return;

  const tile = document.createElement("div");
  tile.className = "tile";
  const holdNote = isHoldNote(event);
  if (holdNote) {
    const laneHeight = Math.max(1, dom.lanes.clientHeight);
    const hitY = laneHeight * (1 - CONFIG.hitLineBottom);
    const pixelsPerMs = (hitY + CONFIG.spawnTopOffset) / CONFIG.leadMs;
    const holdHeight = clamp(getHoldDuration(event) * pixelsPerMs, 44, laneHeight * 0.72);
    tile.classList.add("long");
    tile.style.setProperty("--hold-height", `${holdHeight}px`);
    tile.style.setProperty("--hold-progress", "0%");
  }
  tile.dataset.key = event.key;
  tile.style.background = event.color;
  tile.innerHTML = `
    <span class="hold-fill"></span>
    <b>${event.key}</b>
    <small>${event.noteLabel}</small>
  `;
  lane.appendChild(tile);

  state.activeTiles.push({
    event,
    node: tile,
    status: "active",
    removeAt: 0,
    holdEndTime: getHoldEndTime(event),
    holdStartedAt: 0,
    startJudgement: null,
    startDeltaMs: 0,
  });
}

function updateTilePosition(tile, playheadMs) {
  const laneHeight = dom.lanes.clientHeight;
  const hitY = laneHeight * (1 - CONFIG.hitLineBottom);
  const headOffset = Math.max(18, tile.node.offsetWidth / 2);
  const progress = (playheadMs - (tile.event.time - CONFIG.leadMs)) / CONFIG.leadMs;
  const travel = hitY - headOffset + CONFIG.spawnTopOffset;
  const y = -CONFIG.spawnTopOffset + progress * travel;
  tile.node.style.transform = `translate(-50%, ${y}px)`;
  tile.node.style.setProperty("--tile-y", `${y}px`);
}

function tickGame() {
  const chart = state.chart;
  if (!state.running || state.paused || !chart) return;

  const playheadMs = getPlaybackMs();

  while (
    state.nextEventIndex < chart.events.length &&
    chart.events[state.nextEventIndex].time - CONFIG.leadMs <= playheadMs
  ) {
    spawnTile(chart.events[state.nextEventIndex]);
    state.nextEventIndex += 1;
  }

  state.activeTiles.forEach((tile) => updateTilePosition(tile, playheadMs));
  state.activeTiles = state.activeTiles.filter((tile) => {
    if (tile.status === "holding") {
      updateHoldProgress(tile, playheadMs);
      if (!inputState.gestureStates.has(tile.event.key) && playheadMs < tile.holdEndTime - CONFIG.holdReleaseGraceMs) {
        resolveHoldMiss(tile, playheadMs);
      } else if (playheadMs >= tile.holdEndTime) {
        completeHold(tile);
      }
      return true;
    }

    if (tile.status !== "active") {
      if (performance.now() < tile.removeAt) return true;
      tile.node.remove();
      return false;
    }

    if (playheadMs <= tile.event.time + JUDGEMENTS[JUDGEMENTS.length - 1].window + CONFIG.missGraceMs) {
      return true;
    }

    resolveMiss(tile);
    return true;
  });

  const progress = clamp(playheadMs / chart.duration * 100, 0, 100);
  dom.songProgress.style.width = `${progress}%`;
  saveProgress(progress);

  if (
    playheadMs >= chart.duration &&
    state.nextEventIndex >= chart.events.length &&
    !state.activeTiles.some((tile) => tile.status === "active" || tile.status === "holding")
  ) {
    finishGame();
    return;
  }

  state.rafId = requestAnimationFrame(tickGame);
}

function classifyHit(deltaMs) {
  const distance = Math.abs(deltaMs);
  return JUDGEMENTS.find((judgement) => distance <= judgement.window) || null;
}

function comboMultiplier() {
  return clamp(1 + Math.floor(state.combo / 12) * 0.18, 1, 3.2);
}

function resolveHit(tile, judgement, deltaMs) {
  if (isHoldNote(tile.event)) {
    tile.status = "holding";
    tile.holdStartedAt = getPlaybackMs();
    tile.startJudgement = judgement;
    tile.startDeltaMs = deltaMs;
    tile.node.classList.add("holding");
    flashLane(tile.event.laneIndex);
    updateHud(`HOLD ${deltaMs > 0 ? "+" : ""}${Math.round(deltaMs)}ms`);
    return;
  }

  awardHit(tile, judgement, deltaMs);
}

function awardHit(tile, judgement, deltaMs, options = {}) {
  tile.status = judgement.id;
  tile.removeAt = performance.now() + 165;
  tile.node.classList.remove("holding");
  tile.node.classList.add(options.className || judgement.id);

  state.combo += 1;
  state.maxCombo = Math.max(state.maxCombo, state.combo);
  state.hits += 1;
  state.attempts += 1;
  state.accuracyWeight += judgement.weight * (options.accuracyMultiplier || 1);
  state.health = clamp(state.health + 2, 0, 100);
  state.score += Math.round((judgement.score + (options.bonus || 0)) * comboMultiplier());

  flashLane(tile.event.laneIndex);
  updateHud(options.label || `${judgement.label} ${deltaMs > 0 ? "+" : ""}${Math.round(deltaMs)}ms`);
  recordDiagnostic(tile.event.key, judgement.id, judgement.weight * 100 * (options.accuracyMultiplier || 1), {
    timingErrorMs: deltaMs,
    hold: Boolean(options.hold),
  });
  saveScoreIfNeeded();
}

function updateHoldProgress(tile, playheadMs) {
  const duration = Math.max(1, getHoldDuration(tile.event));
  const progress = clamp((playheadMs - tile.event.time) / duration, 0, 1);
  tile.node.style.setProperty("--hold-progress", `${Math.round(progress * 100)}%`);
}

function completeHold(tile) {
  const judgement = tile.startJudgement || JUDGEMENTS[JUDGEMENTS.length - 1];
  const durationBonus = Math.round(clamp(getHoldDuration(tile.event), CONFIG.holdNoteMinMs, 2200) / 18);
  tile.node.style.setProperty("--hold-progress", "100%");
  awardHit(tile, judgement, tile.startDeltaMs || 0, {
    bonus: durationBonus,
    className: "hold-complete",
    label: `HOLD OK · +${durationBonus}`,
    hold: true,
  });
}

function resolveHoldMiss(tile, playheadMs) {
  const duration = Math.max(1, getHoldDuration(tile.event));
  const heldRatio = clamp((playheadMs - tile.event.time) / duration, 0, 1);
  tile.status = "miss";
  tile.removeAt = performance.now() + 220;
  tile.node.classList.remove("holding");
  tile.node.classList.add("miss");
  tile.node.style.setProperty("--hold-progress", `${Math.round(heldRatio * 100)}%`);

  state.combo = 0;
  state.misses += 1;
  state.attempts += 1;
  state.health = clamp(state.health - 8, 0, 100);

  updateHud(`RELEASE ${Math.round(heldRatio * 100)}%`);
  recordDiagnostic(tile.event.key, "miss", Math.max(20, heldRatio * 55), {
    hold: true,
    earlyRelease: true,
  });
}

function resolveMiss(tile) {
  tile.status = "miss";
  tile.removeAt = performance.now() + 220;
  tile.node.classList.add("miss");

  state.combo = 0;
  state.misses += 1;
  state.attempts += 1;
  state.health = clamp(state.health - 8, 0, 100);

  updateHud("MISS");
  recordDiagnostic(tile.event.key, "miss", 20);
}

function resolveBadInput(key) {
  state.combo = 0;
  state.misses += 1;
  state.attempts += 1;
  state.health = clamp(state.health - 4, 0, 100);
  state.score = Math.max(0, state.score - 20);
  updateHud("MISS");
  recordDiagnostic(key, "bad", 18);
}

function saveProgress(progress) {
  const now = performance.now();
  if (now - state.lastProgressSaveAt < CONFIG.progressSaveGapMs && progress < 100) return;

  const record = getSongRecord(state.activeSong);
  setSongRecord(state.activeSong, {
    progress: Math.max(record.progress || 0, Math.round(progress)),
  });
  state.lastProgressSaveAt = now;
}

function saveScoreIfNeeded() {
  const record = getSongRecord(state.activeSong);
  if (state.score > bestScore) {
    bestScore = state.score;
    saveBestScore();
    updateBestScoreNodes();
  }

  if (state.score > (record.best || 0)) {
    setSongRecord(state.activeSong, { best: state.score });
  }
}

function finishGame() {
  if (state.rafId) {
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
  }

  stopSynth();
  state.running = false;
  state.activeTiles.forEach((tile) => tile.node.remove());
  state.activeTiles = [];

  const accuracy = state.attempts ? state.accuracyWeight / state.attempts * 100 : 100;
  setSongRecord(state.activeSong, {
    progress: 100,
    best: Math.max(getSongRecord(state.activeSong).best || 0, state.score),
    accuracy: Math.max(getSongRecord(state.activeSong).accuracy || 0, Math.round(accuracy)),
  });
  saveScoreIfNeeded();
  dom.songProgress.style.width = "100%";
  updateHud(`FINISH · ${state.maxCombo}`);
  renderSongs();
}

function flashLane(laneIndex) {
  const lane = dom.lanes.children[laneIndex];
  const slot = dom.gestureBar.children[laneIndex];
  if (!lane || !slot) return;

  lane.classList.add("flash");
  slot.classList.add("active");
  window.setTimeout(() => {
    lane.classList.remove("flash");
    slot.classList.remove("active");
  }, 120);
}

function canTriggerKey(key, options = {}) {
  if (options.force) return true;

  const now = performance.now();
  const lastAt = inputState.lastGestureAt.get(key) || 0;
  if (now - lastAt < CONFIG.inputCooldownMs) return false;
  inputState.lastGestureAt.set(key, now);
  return true;
}

function handleGesture(key, options = {}) {
  const normalized = normalizeKey(key);
  const laneIndex = getLaneIndexByKey(normalized);
  const gesture = GESTURES[laneIndex];
  if (!gesture || !canTriggerKey(normalized, options)) return false;

  setCurrentGesture(gesture);

  if (state.screen !== "game" || !state.running || state.paused) {
    if (state.screen === "diagnostics") {
      recordDiagnostic(normalized, "perfect", 100);
    }
    return true;
  }

  const playheadMs = getPlaybackMs();
  const candidate = state.activeTiles
    .filter((tile) => tile.status === "active" && tile.event.laneIndex === laneIndex)
    .map((tile) => ({
      tile,
      delta: playheadMs - tile.event.time,
      distance: Math.abs(playheadMs - tile.event.time),
    }))
    .filter(({ delta }) => delta >= -JUDGEMENTS[JUDGEMENTS.length - 1].window && delta <= JUDGEMENTS[JUDGEMENTS.length - 1].window)
    .sort((a, b) => a.distance - b.distance)[0];

  flashLane(laneIndex);

  if (!candidate) {
    resolveBadInput(normalized);
    return true;
  }

  const judgement = classifyHit(candidate.delta);
  if (!judgement) {
    resolveBadInput(normalized);
    return true;
  }

  resolveHit(candidate.tile, judgement, candidate.delta);
  return true;
}

function setGestureState(key, isActive, options = {}) {
  const normalized = normalizeKey(key);
  if (!getGestureByKey(normalized)) return false;

  if (isActive) {
    if (inputState.gestureStates.has(normalized)) return false;
    inputState.gestureStates.add(normalized);
    return handleGesture(normalized, { ...options, stateful: true });
  }

  inputState.gestureStates.delete(normalized);
  releaseHeldGesture(normalized);
  return true;
}

function releaseHeldGesture(key) {
  if (state.screen !== "game" || !state.running || state.paused) return false;

  const laneIndex = getLaneIndexByKey(key);
  if (laneIndex === -1) return false;

  const playheadMs = getPlaybackMs();
  const tile = state.activeTiles
    .filter((candidate) => candidate.status === "holding" && candidate.event.laneIndex === laneIndex)
    .sort((a, b) => a.holdEndTime - b.holdEndTime)[0];
  if (!tile) return false;

  if (playheadMs >= tile.holdEndTime - CONFIG.holdReleaseGraceMs) {
    completeHold(tile);
  } else {
    resolveHoldMiss(tile, playheadMs);
  }

  return true;
}

function startCalibration() {
  calibrationState.collecting = true;
  calibrationState.startedAt = performance.now();
  GESTURES.forEach((gesture) => {
    const entry = calibrationProfile[gesture.key] || createCalibrationEntry(gesture);
    const value = Number(entry.value || 0);
    calibrationProfile[gesture.key] = {
      ...entry,
      min: value,
      max: value,
      threshold: value,
      active: false,
    };
  });
  saveCalibrationProfile();
  renderCalibrationPanel();
}

function finishCalibration() {
  calibrationState.collecting = false;
  GESTURES.forEach((gesture) => {
    const entry = calibrationProfile[gesture.key] || createCalibrationEntry(gesture);
    const min = Math.min(entry.min, entry.max);
    const max = Math.max(entry.min, entry.max);
    const range = max - min;
    calibrationProfile[gesture.key] = {
      ...entry,
      min,
      max,
      threshold: range >= 8
        ? Math.round(min + range * 0.58)
        : Math.round(max + 8),
    };
  });
  saveCalibrationProfile();
  renderCalibrationPanel();
}

function resetCalibration() {
  calibrationState.collecting = false;
  calibrationProfile = GESTURES.reduce((profile, gesture) => {
    profile[gesture.key] = createCalibrationEntry(gesture);
    return profile;
  }, {});
  saveCalibrationProfile();
  renderCalibrationPanel();
}

function updateCalibrationValue(key, value) {
  const normalized = normalizeKey(key);
  const gesture = getGestureByKey(normalized);
  const numericValue = Number(value);
  if (!gesture || !Number.isFinite(numericValue)) return false;

  const entry = calibrationProfile[gesture.key] || createCalibrationEntry(gesture);
  if (calibrationState.collecting) {
    entry.min = Math.min(entry.min, numericValue);
    entry.max = Math.max(entry.max, numericValue);
    entry.threshold = Math.round(entry.min + (entry.max - entry.min) * 0.58);
  }

  entry.value = numericValue;
  entry.active = numericValue >= entry.threshold;
  calibrationProfile[gesture.key] = entry;
  setGestureState(gesture.key, entry.active, { source: "glove", calibrated: true });
  saveCalibrationProfile();
  if (state.screen === "diagnostics") renderCalibrationPanel();
  return true;
}

function updateCalibrationValues(values = {}) {
  if (!values || typeof values !== "object") return false;
  Object.entries(values).forEach(([key, value]) => updateCalibrationValue(key, value));
  return true;
}

function normalizeEsp32Url(url) {
  return String(url || CONFIG.esp32DefaultUrl).trim().replace(/\/+$/, "");
}

async function pollEsp32Glove() {
  const url = normalizeEsp32Url(esp32Connection.url);

  try {
    const response = await fetch(`${url}/state`, {
      cache: "no-store",
      mode: "cors",
    });
    if (!response.ok) throw new Error(`ESP32 status ${response.status}`);

    const data = await response.json();
    const sensorValues = data.sensors || data.analog || data.values;
    if (sensorValues) {
      updateCalibrationValues(sensorValues);
    } else if (data.contacts || data.states) {
      receiveGloveFrame({ contacts: data.contacts || data.states });
    }

    esp32Connection.connected = true;
    esp32Connection.failures = 0;
    esp32Connection.lastSeenAt = performance.now();
    if (esp32Connection.intervalMs !== CONFIG.esp32PollMs) {
      if (esp32Connection.timerId) clearInterval(esp32Connection.timerId);
      esp32Connection.intervalMs = CONFIG.esp32PollMs;
      esp32Connection.timerId = window.setInterval(pollEsp32Glove, CONFIG.esp32PollMs);
    }
    updateStatus(true, "ESP32");
    return true;
  } catch {
    esp32Connection.failures += 1;
    if (esp32Connection.connected || esp32Connection.failures > 3) {
      esp32Connection.connected = false;
      if (esp32Connection.intervalMs !== CONFIG.esp32RetryMs) {
        if (esp32Connection.timerId) clearInterval(esp32Connection.timerId);
        esp32Connection.intervalMs = CONFIG.esp32RetryMs;
        esp32Connection.timerId = window.setInterval(pollEsp32Glove, CONFIG.esp32RetryMs);
      }
      updateStatus(false, "ожидание ESP32");
    }
    return false;
  }
}

function startEsp32Polling(url = esp32Connection.url) {
  esp32Connection.url = normalizeEsp32Url(url);
  localStorage.setItem(STORAGE.esp32Url, esp32Connection.url);

  if (esp32Connection.timerId) {
    clearInterval(esp32Connection.timerId);
  }

  pollEsp32Glove();
  esp32Connection.intervalMs = CONFIG.esp32RetryMs;
  esp32Connection.timerId = window.setInterval(pollEsp32Glove, CONFIG.esp32RetryMs);
  return esp32Connection.url;
}

function stopEsp32Polling() {
  if (esp32Connection.timerId) {
    clearInterval(esp32Connection.timerId);
    esp32Connection.timerId = 0;
  }
  esp32Connection.intervalMs = 0;
  esp32Connection.connected = false;
  updateStatus(true, "готов");
}

function receiveGloveFrame(frame = {}) {
  const sensorValues = frame.sensors || frame.analog || frame.values;
  if (sensorValues && typeof sensorValues === "object") {
    return updateCalibrationValues(sensorValues);
  }

  const hasStateValue = "active" in frame || "pressed" in frame || "isActive" in frame;
  const stateValue = Boolean(frame.active ?? frame.pressed ?? frame.isActive);
  const gripName = frame.grip || frame.contact || frame.movement;
  if (typeof gripName === "string" && Number.isFinite(Number(frame.value))) {
    return updateCalibrationValue(gripName, Number(frame.value));
  }

  if (typeof gripName === "string") {
    if (hasStateValue) {
      return setGestureState(gripName, stateValue, { source: "glove", force: Boolean(frame.force) });
    }
    return handleGesture(gripName, { source: "glove", force: Boolean(frame.force) });
  }

  if (typeof frame.key === "string") {
    if (hasStateValue) {
      return setGestureState(frame.key, stateValue, { source: "glove", force: Boolean(frame.force) });
    }
    return handleGesture(frame.key, { source: "glove", force: Boolean(frame.force) });
  }

  if (typeof frame.gesture === "string") {
    if (hasStateValue) {
      return setGestureState(frame.gesture, stateValue, { source: "glove", force: Boolean(frame.force) });
    }
    return handleGesture(frame.gesture, { source: "glove", force: Boolean(frame.force) });
  }

  if (frame.states && typeof frame.states === "object") {
    Object.entries(frame.states).forEach(([key, active]) => {
      setGestureState(key, Boolean(active), { source: "glove" });
    });
    return true;
  }

  if (frame.contacts && typeof frame.contacts === "object") {
    Object.entries(frame.contacts).forEach(([key, active]) => {
      setGestureState(key, Boolean(active), { source: "glove" });
    });
    return true;
  }

  return false;
}

window.FlortteInput = {
  gestures: GESTURES,
  gripMap: GESTURES.reduce((map, gesture) => {
    map[gesture.id] = gesture.key;
    return map;
  }, {}),
  triggerGestureByKey(key, options) {
    return handleGesture(key, options);
  },
  triggerGestureByIndex(index, options) {
    const gesture = GESTURES[index];
    return gesture ? handleGesture(gesture.key, options) : false;
  },
  setGestureState,
  setGestureStates(states) {
    if (!states || typeof states !== "object") return false;
    Object.entries(states).forEach(([key, active]) => setGestureState(key, Boolean(active)));
    return true;
  },
  receiveGloveFrame,
  setGripCount(count) {
    therapySettings = {
      ...therapySettings,
      gripCount: clamp(Number(count || 3), 3, GESTURES.length),
    };
    saveTherapySettings();
    renderTherapyOptions();
    renderSongs();
    renderGestureSurfaces();
  },
  setDifficulty(difficulty) {
    if (!DIFFICULTIES[difficulty]) return false;
    therapySettings = {
      ...therapySettings,
      difficulty,
    };
    saveTherapySettings();
    renderTherapyOptions();
    renderSongs();
    return true;
  },
  setAdaptive(enabled) {
    therapySettings = {
      ...therapySettings,
      adaptive: Boolean(enabled),
    };
    saveTherapySettings();
    renderTherapyOptions();
    renderSongs();
    return true;
  },
  startCalibration,
  finishCalibration,
  resetCalibration,
  updateCalibrationValue,
  updateCalibrationValues,
  connectEsp32(url = CONFIG.esp32DefaultUrl) {
    return startEsp32Polling(url);
  },
  disconnectEsp32: stopEsp32Polling,
  getEsp32Connection() {
    return {
      url: esp32Connection.url,
      connected: esp32Connection.connected,
      failures: esp32Connection.failures,
      lastSeenAt: esp32Connection.lastSeenAt,
    };
  },
  getCalibration() {
    return JSON.parse(JSON.stringify(calibrationProfile));
  },
  getAdaptiveReport() {
    return GESTURES.map((gesture) => ({
      key: gesture.key,
      id: gesture.id,
      name: gesture.name,
      ...getGesturePerformance(gesture.key),
    }));
  },
  getSettings() {
    return { ...therapySettings };
  },
  getGameState() {
    return {
      screen: state.screen,
      running: state.running,
      paused: state.paused,
      mode: state.mode,
      score: state.score,
      combo: state.combo,
      chartNotes: state.chart ? state.chart.events.length : 0,
      playbackMs: getPlaybackMs(),
    };
  },
  getChart() {
    return state.chart ? state.chart.events.map((event) => ({ ...event })) : [];
  },
};

document.addEventListener("click", (event) => {
  const gripButton = event.target.closest("[data-grip-count]");
  if (gripButton) {
    therapySettings = {
      ...therapySettings,
      gripCount: clamp(Number(gripButton.dataset.gripCount || 3), 3, GESTURES.length),
    };
    saveTherapySettings();
    renderTherapyOptions();
    renderSongs();
    renderGestureSurfaces();
    return;
  }

  const difficultyButton = event.target.closest("[data-difficulty]");
  if (difficultyButton) {
    const difficulty = difficultyButton.dataset.difficulty;
    if (DIFFICULTIES[difficulty]) {
      therapySettings = {
        ...therapySettings,
        difficulty,
      };
      saveTherapySettings();
      renderTherapyOptions();
      renderSongs();
    }
    return;
  }

  const adaptiveButton = event.target.closest("[data-adaptive]");
  if (adaptiveButton) {
    therapySettings = {
      ...therapySettings,
      adaptive: adaptiveButton.dataset.adaptive === "on",
    };
    saveTherapySettings();
    renderTherapyOptions();
    renderSongs();
    return;
  }

  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;

  if (action === "go-menu") setScreen("menu");
  if (action === "go-songs") {
    renderTherapyOptions();
    renderSongs();
    setScreen("songs");
  }
  if (action === "go-diagnostics") {
    renderDiagnostics();
    setScreen("diagnostics");
  }
  if (action === "toggle-pause") togglePause();
  if (action === "start-session") startSession();
  if (action === "start-calibration") startCalibration();
  if (action === "finish-calibration") finishCalibration();
  if (action === "reset-calibration") resetCalibration();
  if (action === "reset-diagnostics") {
    diagnostics = {
      attempts: 0,
      hits: 0,
      misses: 0,
      streak: 0,
      history: [],
      byKey: {},
    };
    saveDiagnostics();
    renderDiagnostics();
  }
});

document.addEventListener("keydown", (event) => {
  const key = normalizeKey(event.key);
  if (!getGestureByKey(key) || event.repeat || inputState.heldKeys.has(key)) return;

  inputState.heldKeys.add(key);
  setGestureState(key, true, { source: "keyboard" });
});

document.addEventListener("keyup", (event) => {
  const key = normalizeKey(event.key);
  inputState.heldKeys.delete(key);
  setGestureState(key, false, { source: "keyboard" });
});

window.addEventListener("beforeunload", () => {
  if (state.running && state.chart) {
    saveProgress(clamp(getPlaybackMs() / state.chart.duration * 100, 0, 100));
  }
});

updateStatus(true);
updateBestScoreNodes();
renderTherapyOptions();
renderSongs();
renderGestureSurfaces();
renderDiagnostics();
startEsp32Polling();
