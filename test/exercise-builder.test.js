const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const storage = new Map();
const catalogue = [
  { id: 'thumb', lane: 0, note: 60, image: 'thumb.png', pattern: [1, 0, 0, 0, 0] },
  { id: 'pair', lane: 1, note: 62, image: 'pair.png', pattern: [0, 1, 1, 0, 0] },
  { id: 'fist', lane: 2, note: 64, image: 'fist.png', pattern: [0, 0, 0, 0, 0] },
];
const context = vm.createContext({
  localStorage: {
    getItem: key => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, String(value)),
  },
  Gestures: {
    allGestures: () => catalogue,
    midiToName: note => `N${note}`,
  },
});
const source = `${fs.readFileSync(path.join(__dirname, '..', 'js', 'exercise-builder.js'), 'utf8')}
globalThis.ExerciseBuilder = ExerciseBuilder;`;
vm.runInContext(source, context);

const normalized = context.ExerciseBuilder.normalizePlan({
  name: '  Индивидуальная  ',
  gestureIds: ['pair', 'missing', 'thumb', 'pair'],
  repetitions: 99,
  intervalMs: 200,
}, catalogue);
assert.strictEqual(normalized.name, 'Индивидуальная');
assert.deepStrictEqual(Array.from(normalized.gestureIds), ['pair', 'thumb']);
assert.strictEqual(normalized.repetitions, 10);
assert.strictEqual(normalized.intervalMs, 1200);

const plan = {
  name: 'Пальцы 1–3',
  gestureIds: ['pair', 'thumb'],
  repetitions: 2,
  intervalMs: 2200,
};
const song = context.ExerciseBuilder.createSong(plan, catalogue);
assert.strictEqual(song.preserveLanes, true);
assert.deepStrictEqual(Array.from(song.gestureIds), ['thumb', 'pair']);
assert.strictEqual(song.notes.length, 4);
assert.deepStrictEqual(Array.from(song.notes.map(note => note.gestureId)), ['pair', 'thumb', 'pair', 'thumb']);
assert.deepStrictEqual(Array.from(song.notes.map(note => note.lane)), [1, 0, 1, 0]);
assert.deepStrictEqual(Array.from(song.exercise.targetFingers), [0, 1, 2]);

const fistTargets = context.ExerciseBuilder.targetFingerIndexes({ gestureIds: ['fist'] }, catalogue);
assert.deepStrictEqual(Array.from(fistTargets), [0, 1, 2, 3, 4]);

const midiExercise = context.ExerciseBuilder.createSongFromMidi(plan, {
  name: 'Test song',
  durationMs: 8000,
  audioUrl: 'test.mp3',
  audioName: 'test.mp3',
  notes: [
    { time: 1000, duration: 200, note: 60, velocity: 70 },
    { time: 1000, duration: 500, note: 67, velocity: 90 },
    { time: 2400, duration: 300, note: 64, velocity: 80 },
    { time: 4000, duration: 300, note: 65, velocity: 80 },
  ],
}, catalogue);
assert.strictEqual(midiExercise.notes.length, 3);
assert.deepStrictEqual(Array.from(midiExercise.notes.map(note => note.gestureId)), ['pair', 'thumb', 'pair']);
assert.deepStrictEqual(Array.from(midiExercise.notes.map(note => note.lane)), [1, 0, 1]);
assert.strictEqual(midiExercise.notes[0].note, 67);
assert.strictEqual(midiExercise.notes[0].duration, 500);
assert.strictEqual(midiExercise.audioUrl, 'test.mp3');
assert.strictEqual(midiExercise.durationMs, 8000);
assert.strictEqual(midiExercise.exercise.simultaneousNotesCombined, true);

const limitedExercise = context.ExerciseBuilder.createSongFromMidi({
  ...plan,
  tempoPercent: 125,
  gestureCount: 2,
}, {
  name: 'Limited song',
  durationMs: 8000,
  notes: [
    { time: 1000, duration: 300, note: 60, velocity: 80 },
    { time: 2000, duration: 300, note: 62, velocity: 80 },
    { time: 3000, duration: 300, note: 64, velocity: 80 },
    { time: 4000, duration: 300, note: 65, velocity: 80 },
  ],
}, catalogue);
assert.strictEqual(limitedExercise.playbackRate, 1.25);
assert.strictEqual(limitedExercise.notes.filter(note => Number.isInteger(note.lane)).length, 2);
assert.strictEqual(limitedExercise.notes.length, 4);
assert.strictEqual(limitedExercise.exercise.gestureCount, 2);
assert.strictEqual(limitedExercise.exercise.totalSourceActions, 4);

const configuredSong = context.ExerciseBuilder.configureSong({
  name: 'Ready level',
  durationMs: 9000,
  notes: [
    { time: 1000, note: 60, lane: 0 },
    { time: 2000, note: 62, lane: 1 },
    { time: 3000, note: 64, lane: 2 },
    { time: 4000, note: 65, lane: 0 },
  ],
}, { tempoPercent: 35, gestureCount: 2 });
assert.strictEqual(configuredSong.playbackRate, 0.35);
assert.strictEqual(configuredSong.preserveLanes, true);
assert.strictEqual(configuredSong.notes.filter(note => Number.isInteger(note.lane)).length, 2);
assert.strictEqual(configuredSong.notes.length, 4);
assert.strictEqual(configuredSong.songSettings.totalActions, 4);

context.ExerciseBuilder.savePlan(plan);
assert.strictEqual(context.ExerciseBuilder.loadPlan().name, 'Пальцы 1–3');
assert.throws(() => context.ExerciseBuilder.createSong({ gestureIds: [] }, catalogue));
console.log('Exercise builder passed.');
