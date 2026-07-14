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

const source = `${fs.readFileSync(path.join(__dirname, '..', 'js', 'gestures.js'), 'utf8')}
globalThis.Gestures = Gestures;`;
const context = vm.createContext({ localStorage });
vm.runInContext(source, context);

const open = 3600;
const bent = 50;
const sensors = (bits) => ({
  keyPinch: bits[0] ? bent : open,
  indexThumb: bits[1] ? bent : open,
  middleThumb: bits[2] ? bent : open,
  ring: bits[3] ? bent : open,
  little: bits[4] ? bent : open,
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
  assert.strictEqual(context.Gestures.classify(sensors(bits)).gesture.id, id);
});

assert.strictEqual(context.Gestures.classify(sensors([0, 0, 0, 1, 0])).gesture.id, 'unsupported');
assert.strictEqual(context.Gestures.classify(sensors([0, 0, 0, 0, 1])).gesture.id, 'unsupported');
assert.strictEqual(context.Gestures.laneCount(), 9);
assert.ok(context.Gestures.playableGestures().every(gesture => gesture.image));

context.Gestures.playableGestures().forEach((gesture) => {
  assert.ok(fs.existsSync(path.join(__dirname, '..', gesture.image)), `Missing image for ${gesture.id}`);
});

console.log('Nine image-backed gesture mappings passed.');
