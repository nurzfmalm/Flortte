const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const values = new Map();
const localStorage = {
  getItem(key) {
    return values.has(key) ? values.get(key) : null;
  },
  setItem(key, value) {
    values.set(key, String(value));
  },
};

const source = `${fs.readFileSync(path.join(__dirname, '..', 'js', 'gestures.js'), 'utf8')}\nglobalThis.Gestures = Gestures;`;
const context = vm.createContext({ localStorage });
vm.runInContext(source, context);

const open = 3600;
const bent = 50;
const sensors = (bits) => ({
  keyPinch: bits[0] ? open : bent,
  indexThumb: bits[1] ? open : bent,
  middleThumb: bits[2] ? open : bent,
  ring: bits[3] ? open : bent,
  little: bits[4] ? open : bent,
});

const expectedGestures = [
  ['gesture-1', [1, 1, 0, 0, 0]],
  ['gesture-2', [1, 0, 0, 0, 0]],
  ['gesture-3', [0, 1, 0, 0, 0]],
  ['gesture-4', [0, 1, 1, 0, 0]],
  ['three-raised', [0, 1, 1, 1, 0]],
  ['four-raised', [0, 1, 1, 1, 1]],
  ['gesture-8', [1, 1, 1, 0, 0]],
  ['fist', [0, 0, 0, 0, 0]],
  ['open-hand', [1, 1, 1, 1, 1]],
];

expectedGestures.forEach(([id, bits]) => {
  const result = context.Gestures.classify(sensors(bits));
  assert.strictEqual(result.gesture.id, id);
  assert.deepStrictEqual(Array.from(result.bits), bits);
});

assert.strictEqual(context.Gestures.classify(sensors([0, 0, 0, 1, 0])).gesture.id, 'unsupported');
assert.strictEqual(context.Gestures.classify(sensors([0, 0, 0, 0, 1])).gesture.id, 'unsupported');
assert.strictEqual(context.Gestures.classify(sensors([0, 0, 0, 0, 0])).gesture.id, 'fist');
assert.strictEqual(context.Gestures.classify(sensors([1, 1, 1, 1, 1])).gesture.id, 'open-hand');

context.Gestures.setThreshold('keyPinch', 'bend', 1000);
let pair = context.Gestures.getThresholdPair('keyPinch');
assert.strictEqual(pair.bend, 1000);
assert.strictEqual(pair.release, 1200);
context.Gestures.setThreshold('keyPinch', 'release', 900);
pair = context.Gestures.getThresholdPair('keyPinch');
assert.strictEqual(pair.bend, 1000);
assert.strictEqual(pair.release, 1200);

context.Gestures.setActiveGestureIds(['gesture-2', 'gesture-4']);
assert.deepStrictEqual(
  Array.from(context.Gestures.playableGestures(), gesture => gesture.id),
  ['gesture-2', 'gesture-4'],
);
assert.strictEqual(context.Gestures.gestureForLane(1).id, 'gesture-4');
context.Gestures.setActiveGestureIds(null);
assert.strictEqual(context.Gestures.laneCount(), 9);
assert.ok(context.Gestures.playableGestures().every(gesture => gesture.image));

context.Gestures.playableGestures().forEach((gesture) => {
  assert.ok(fs.existsSync(path.join(__dirname, '..', gesture.image)), `Missing image for ${gesture.id}`);
});

console.log('Gesture mappings and flex threshold hysteresis passed.');
