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

context.ExerciseBuilder.savePlan(plan);
assert.strictEqual(context.ExerciseBuilder.loadPlan().name, 'Пальцы 1–3');
assert.throws(() => context.ExerciseBuilder.createSong({ gestureIds: [] }, catalogue));
console.log('Exercise builder passed.');
