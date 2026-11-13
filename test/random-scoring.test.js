const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

let sensor, frame, end, snapshot, result;
let rolls = 0;
const randomValues = [0.499, 0.5, 0];
const clock = { currentMs: 1000, stop() {}, pause() {}, resume() {} };
const context = vm.createContext({
  Math: Object.assign(Object.create(Math), { random() { rolls++; return randomValues.shift(); } }),
  localStorage: { getItem: () => null, setItem() {} },
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
const ctx = new Proxy({}, { get: (_, key) => key === 'createLinearGradient' ? () => gradient : () => {} });
context.document.getElementById = id => id === 'game-canvas' ? {
  getContext: () => ctx, getBoundingClientRect: () => ({ width: 100, height: 100 }),
} : null;
for (const file of ['game-results.js', 'game.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8'), context);
}
const game = vm.runInContext('Game', context);
game.init();
game.onScoreChange(value => { snapshot = value; });
game.onEnd(value => { result = value; });
game.start({ notes: [1000, 2000, 3000].map(time => ({ lane: 0, time })), durationMs: 4000 });
frame(0);
sensor(true);
assert.equal(snapshot.score, 100);
sensor(true);
assert.equal(rolls, 1, 'Repeated sensor packets cannot reroll a tile');
sensor(false);
clock.currentMs = 2000;
sensor(true);
assert.equal(snapshot.score, 100, 'A roll at the 50% boundary awards no points');
assert.equal(snapshot.combo, 2);
sensor(false);
clock.currentMs = 3000;
sensor(true);
assert.equal(snapshot.score, 400, 'Awarded points retain the combo multiplier');
assert.equal(rolls, 3);
end();
assert.equal(result.hits, 3);
assert.equal(result.successPercent, 100);
assert.equal(result.score, 400);
assert.equal(result.maxCombo, 3);
console.log('Random scoring passed.');
