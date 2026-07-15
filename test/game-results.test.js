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
  notes: [{ lane: 0 }, { lane: 0 }, { lane: 1 }, { lane: null }],
};
const session = context.GameResults.createSession(song, lane => gestures[lane]);
assert.strictEqual(session.totalNotes, 3);
assert.deepStrictEqual(Array.from(session.fingerAttempts), [2, 3, 1, 1, 1]);

context.GameResults.recordHit(session, song.notes[0], lane => gestures[lane]);
context.GameResults.recordHit(session, song.notes[0], lane => gestures[lane]);
context.GameResults.recordHit(session, song.notes[2], lane => gestures[lane]);
const result = context.GameResults.finalizeSession(session, { score: 740, maxCombo: 2 });

assert.strictEqual(result.hits, 2);
assert.strictEqual(result.misses, 1);
assert.strictEqual(result.successPercent, 67);
assert.strictEqual(result.fingers[0].successPercent, 50);
assert.strictEqual(result.fingers[1].successPercent, 67);
assert.strictEqual(result.fingers[4].successPercent, 100);

context.GameResults.save(result);
assert.strictEqual(context.GameResults.latest().score, 740);
console.log('Game result metrics passed.');
