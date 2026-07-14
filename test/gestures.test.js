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

assert.strictEqual(context.Gestures.classify(sensors([0, 0, 0, 1, 0])).gesture.id, 'gesture-5');
assert.strictEqual(context.Gestures.classify(sensors([0, 0, 0, 0, 1])).gesture.id, 'gesture-6');
assert.strictEqual(context.Gestures.classify(sensors([0, 0, 0, 0, 0])).gesture.id, 'open');
assert.strictEqual(context.Gestures.laneCount(), 7);

console.log('Five-finger gesture mapping passed.');
