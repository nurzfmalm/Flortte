const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const storage = new Map();
const context = vm.createContext({
  Date,
  localStorage: {
    getItem: key => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
  },
});
const source = `${fs.readFileSync(path.join(__dirname, '..', 'js', 'game-results.js'), 'utf8')}
globalThis.GameResults = GameResults;`;
vm.runInContext(source, context);

const gestures = {
  0: { pattern: [1, 1, 0, 0, 0] },
  1: { pattern: [0, 1, 1, 1, 1] },
};
const song = {
  name: 'Test song',
  durationMs: 12000,
  notes: [
    { lane: 0, time: 1000 },
    { lane: 0, time: 2000 },
    { lane: 1, time: 3000 },
    { lane: null, time: 4000 },
  ],
};
const session = context.GameResults.createSession(song, lane => gestures[lane]);
assert.strictEqual(session.totalNotes, 3);
assert.deepStrictEqual(Array.from(session.fingerAttempts), [2, 3, 1, 1, 1]);

context.GameResults.recordHit(session, song.notes[0], lane => gestures[lane], { movementTimeMs: 1080 });
context.GameResults.recordHit(session, song.notes[0], lane => gestures[lane], { movementTimeMs: 1080 });
context.GameResults.recordHit(session, song.notes[2], lane => gestures[lane], { movementTimeMs: 3060 });
const result = context.GameResults.finalizeSession(session, { score: 740, maxCombo: 2 });

assert.strictEqual(result.hits, 2);
assert.strictEqual(result.misses, 1);
assert.strictEqual(result.successPercent, 67);
assert.strictEqual(result.fingers[0].successPercent, 50);
assert.strictEqual(result.fingers[1].successPercent, 67);
assert.strictEqual(result.fingers[4].successPercent, 100);
assert.strictEqual(result.timing.samples, 2);
assert.strictEqual(result.timing.meanErrorMs, 70);
assert.strictEqual(result.timing.variabilityMs, 10);
assert.strictEqual(result.fingers[0].timing.meanErrorMs, 80);
assert.strictEqual(result.fingers[1].timing.meanErrorMs, 70);
assert.strictEqual(result.fingers[4].timing.meanErrorMs, 60);

const example = context.GameResults.timingMetrics([80, 25, 60, 20]);
assert.strictEqual(example.samples, 4);
assert.strictEqual(example.meanErrorMs, 46.25);
assert.strictEqual(example.variabilityMs, 24.84);

const noTiming = context.GameResults.timingMetrics([]);
assert.strictEqual(noTiming.samples, 0);
assert.strictEqual(noTiming.meanErrorMs, null);
assert.strictEqual(noTiming.variabilityMs, null);
assert.strictEqual(context.GameResults.timingMetrics([null, undefined, '']).samples, 0);

context.GameResults.save(result);
assert.strictEqual(context.GameResults.latest().score, 740);
console.log('Game result metrics passed.');
