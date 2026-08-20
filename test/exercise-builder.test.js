const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const storage = new Map();
const catalogue = [
  { id: 'thumb', lane: 0, note: 60, name: 'Большой', image: 'thumb.png', pattern: [1, 0, 0, 0, 0] },
  { id: 'pair', lane: 1, note: 62, name: 'Пара', image: 'pair.png', pattern: [0, 1, 1, 0, 0] },
  { id: 'fist', lane: 2, note: 64, name: 'Кулак', image: 'fist.png', pattern: [0, 0, 0, 0, 0] },
];
const context = vm.createContext({
  localStorage: {
    getItem: key => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, String(value)),
  },
  Gestures: { playableGestures: () => catalogue },
});
const source = `${fs.readFileSync(path.join(__dirname, '..', 'js', 'exercise-builder.js'), 'utf8')}
globalThis.ExerciseBuilder = ExerciseBuilder;`;
vm.runInContext(source, context);

const normalized = context.ExerciseBuilder.normalizePlan({
  name: '  Индивидуальная  ',
  gestureIds: ['pair', 'missing', 'thumb', 'pair'],
  bpm: 500,
  fallDurationMs: 200,
  hitWindowMs: 900,
  actionCount: 2,
  generationMode: 'missing',
  seed: 0,
}, catalogue);
assert.strictEqual(normalized.name, 'Индивидуальная');
assert.deepStrictEqual(Array.from(normalized.gestureIds), ['pair', 'thumb']);
assert.strictEqual(normalized.bpm, 180);
assert.strictEqual(normalized.fallDurationMs, 1000);
assert.strictEqual(normalized.hitWindowMs, 500);
assert.strictEqual(normalized.actionCount, 5);
assert.strictEqual(normalized.generationMode, 'balanced');
assert.strictEqual(normalized.seed, 1);

const basePlan = {
  name: 'Пальцы 1–3',
  gestureIds: ['pair', 'thumb'],
  bpm: 60,
  fallDurationMs: 3000,
  hitWindowMs: 220,
  actionCount: 8,
  generationMode: 'balanced',
  audioId: 'potter',
  seed: 12345,
};
const firstSequence = context.ExerciseBuilder.generateGestureIds(basePlan, catalogue);
const secondSequence = context.ExerciseBuilder.generateGestureIds(basePlan, catalogue);
assert.deepStrictEqual(Array.from(firstSequence), Array.from(secondSequence));
assert.strictEqual(firstSequence.length, 8);
assert.strictEqual(firstSequence.filter(id => id === 'pair').length, 4);
assert.strictEqual(firstSequence.filter(id => id === 'thumb').length, 4);

const noRepeat = context.ExerciseBuilder.generateGestureIds({
  ...basePlan,
  actionCount: 40,
  generationMode: 'no-repeat',
}, catalogue);
noRepeat.forEach((id, index) => {
  if (index) assert.notStrictEqual(id, noRepeat[index - 1]);
});

const session = context.ExerciseBuilder.createSession(basePlan, catalogue);
assert.strictEqual(session.preserveLanes, true);
assert.deepStrictEqual(Array.from(session.gestureIds), ['thumb', 'pair']);
assert.strictEqual(session.notes.length, 8);
assert.strictEqual(session.notes[0].time, 3500);
assert.strictEqual(session.notes[1].time - session.notes[0].time, 1000);
assert.strictEqual(session.approachTimeMs, 3000);
assert.strictEqual(session.hitWindowMs, 220);
assert.strictEqual(session.audioUrl, 'assets/audio/potter.mp3');
assert.strictEqual(session.exercise.bpm, 60);
assert.strictEqual(session.exercise.seed, 12345);

const fistTargets = context.ExerciseBuilder.targetFingerIndexes({ gestureIds: ['fist'] }, catalogue);
assert.deepStrictEqual(Array.from(fistTargets), [0, 1, 2, 3, 4]);

context.ExerciseBuilder.savePlan(basePlan);
assert.strictEqual(context.ExerciseBuilder.loadPlan().name, 'Пальцы 1–3');
assert.throws(() => context.ExerciseBuilder.createSession({ gestureIds: [] }, catalogue));
console.log('Exercise builder passed.');
