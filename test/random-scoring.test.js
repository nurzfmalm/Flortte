const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

let sensor, frame, end, snapshot, result;
let rolls = 0;
const randomValues = [];
const stored = new Map();
const localStorage = {
  getItem: key => stored.get(key) ?? null,
  setItem: (key, value) => stored.set(key, String(value)),
};
const clock = { currentMs: 1000, stop() {}, pause() {}, resume() {} };
const context = vm.createContext({
  Math: Object.assign(Object.create(Math), { random() { rolls++; return randomValues.shift() ?? 0; } }),
  localStorage,
  devicePixelRatio: 1, performance: { now: () => 0 }, setTimeout() {},
  requestAnimationFrame(fn) { frame = fn; return 1; }, cancelAnimationFrame() {},
  window: { addEventListener() {} },
  document: {
    getElementById: () => null, querySelectorAll: () => [],
  },
  ESP32: { onData(fn) { sensor = fn; } },
  Gestures: {
    laneCount: () => 1, playableGestures: () => [], setActiveGestureIds() {},
    gestureForLane: () => ({ pattern: [1, 0, 0, 0, 0] }),
    classify: value => ({ lane: value ? 0 : null, gesture: { id: value ? 'hit' : 'open' } }),
  },
  AudioPlayer: { play(song, options) { end = options.onEnd; return clock; } },
});
const gradient = { addColorStop() {} };
const drawnLabels = [];
const ctx = new Proxy({
  createLinearGradient: () => gradient,
  fillText: label => drawnLabels.push(label),
}, { get: (target, key) => target[key] ?? (() => {}) });
context.document.getElementById = id => id === 'game-canvas' ? {
  getContext: () => ctx, getBoundingClientRect: () => ({ width: 100, height: 100 }),
} : null;
for (const file of ['game-results.js', 'game.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8'), context);
}
const game = vm.runInContext('Game', context);
assert.equal(game.getAutoHitPercent(), 50, 'Existing installs default to 50%');
game.init();
game.onScoreChange(value => { snapshot = value; });
game.onEnd(value => { result = value; });
function tick(time) {
  clock.currentMs = time;
  frame(0);
}

for (const [percent, expectedHits] of [[0, 0], [50, 5], [70, 7], [100, 10]]) {
  const notes = Array.from({ length: 10 }, (_, index) => ({ lane: 0, time: (index + 1) * 1000 }));
  notes.splice(1, 0, { lane: null, time: 1500 });
  game.setAutoHitPercent(percent);
  game.start({ notes, durationMs: 11000 });
  tick(999);
  assert.equal(snapshot.score, 0, 'Tiles score only after reaching the hit line');
  notes.forEach(note => tick(note.time));
  tick(11000);
  end();
  assert.equal(result.totalNotes, 10, 'Backing notes do not count toward the quota');
  assert.equal(result.hits, expectedHits);
  assert.equal(result.misses, 10 - expectedHits);
  assert.equal(result.successPercent, expectedHits * 10);
  assert.equal(result.timing.samples, 0, 'Automatic hits do not measure movement timing');
  assert.equal(result.score, 100 * expectedHits * (expectedHits + 1) / 2);
}

game.setAutoHitPercent(50);
randomValues.push(0.99);
game.start({ notes: [1000, 2000].map(time => ({ lane: 0, time })), durationMs: 2500 });
const selectionRolls = rolls;
tick(950);
sensor(true);
sensor(true);
assert.equal(snapshot.score, 100, 'Manual hits award points immediately');
sensor(false);
tick(1000);
assert.equal(snapshot.score, 100, 'The first note was not selected for automatic scoring');
tick(2000);
tick(2001);
assert.equal(snapshot.score, 300, 'A selected note counts once and adds to the combo');
assert.equal(rolls, selectionRolls, 'The selection never rerolls during play');
end();
assert.equal(result.hits, 2);
assert.equal(result.timing.samples, 1);
assert.ok(drawnLabels.includes('+200'), 'Points appear on the canvas');

game.setAutoHitPercent(100);
game.start({ notes: [{ lane: 0, time: 1000 }], durationMs: 1500 });
tick(950);
sensor(true);
tick(1000);
end();
assert.equal(result.hits, 1);
assert.equal(result.score, 100, 'A selected note hit manually does not score again');

game.setAutoHitPercent(70);
game.start({ notes: [{ lane: 0, time: 1000 }], durationMs: 1500 });
tick(750);
clock.currentMs = 1500;
end();
assert.equal(result.hits, 1, 'Rounds to the nearest note and processes it on the final tick');

const gameSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'game.js'), 'utf8');
for (const percent of [0, 37, 100]) {
  game.setAutoHitPercent(percent);
  const restored = vm.runInNewContext(gameSource + '\nGame;', { localStorage });
  assert.equal(restored.getAutoHitPercent(), percent, 'Percentage survives restarting the app');
}
console.log('Automatic note selection and manual scoring passed.');
