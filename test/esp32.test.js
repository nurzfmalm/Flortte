const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let enabledFingers = null;
const context = vm.createContext({
  clearTimeout,
  setTimeout,
  TextDecoder,
  TextEncoder,
  navigator: {},
  Gestures: {
    setEnabledFingers(value) { enabledFingers = value; },
  },
});
const source = `${fs.readFileSync(path.join(__dirname, '..', 'js', 'esp32.js'), 'utf8')}
globalThis.ESP32 = ESP32;`;
vm.runInContext(source, context);

let latest = null;
context.ESP32.onData((sensors, status, state) => { latest = { sensors, status, state }; });
context.ESP32.injectSensors(
  { key: -1, index: '123.4', middle: 5000, ring: null, little: 700 },
  {
    calibrated: true,
    calibrationStage: 'idle',
    enabled: { key: true, index: true, middle: false, ring: true, little: true },
  }
);

assert.strictEqual(latest.status, 'connected');
assert.strictEqual(latest.sensors.keyPinch, 4095);
assert.strictEqual(latest.sensors.indexThumb, 123);
assert.strictEqual(latest.sensors.middleThumb, 4095);
assert.strictEqual(latest.sensors.ring, 4095);
assert.strictEqual(latest.sensors.little, 700);
assert.strictEqual(latest.state.calibrated, true);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(enabledFingers)),
  { keyPinch: true, indexThumb: true, middleThumb: false, ring: true, little: true }
);

latest.sensors.little = 0;
assert.strictEqual(context.ESP32.sensors.little, 700);

class FakeEventTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  removeEventListener(name, listener) {
    if (this.listeners.get(name) === listener) this.listeners.delete(name);
  }
  emit(name, event = {}) { this.listeners.get(name)?.(event); }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const tx = new FakeEventTarget();
let gloveState = {
  sensors: { key: 4095, index: 4095, middle: 4095, ring: 4095, little: 4095 },
  enabled: { key: true, index: true, middle: true, ring: true, little: true },
  calibrating: false,
  calibrated: false,
  calibrationStage: 'idle',
};
function dataView(value) {
  const bytes = encoder.encode(JSON.stringify(value));
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
function notify() {
  tx.emit('characteristicvaluechanged', { target: { value: dataView(gloveState) } });
}
tx.startNotifications = async () => {};
tx.readValue = async () => dataView(gloveState);

const rx = {
  async writeValueWithoutResponse(bytes) {
    const action = decoder.decode(bytes).split(':')[1];
    if (action === 'start') gloveState = { ...gloveState, calibrating: true, calibrationStage: 'bent' };
    if (action === 'bent') gloveState = { ...gloveState, calibrating: true, calibrationStage: 'open' };
    if (action === 'open') gloveState = {
      ...gloveState,
      calibrating: false,
      calibrated: true,
      calibrationStage: 'idle',
      enabled: { ...gloveState.enabled, middle: false },
    };
    if (action === 'cancel') gloveState = { ...gloveState, calibrating: false, calibrationStage: 'idle' };
    Promise.resolve().then(notify);
  },
};

const device = new FakeEventTarget();
device.name = 'FlortteGlove';
device.gatt = {
  connected: false,
  async connect() {
    this.connected = true;
    return {
      async getPrimaryService() {
        return {
          async getCharacteristic(uuid) { return uuid.includes('0002-') ? rx : tx; },
        };
      },
    };
  },
  disconnect() {
    this.connected = false;
    device.emit('gattserverdisconnected');
  },
};
let chooserCount = 0;
context.navigator.bluetooth = {
  async requestDevice() {
    chooserCount++;
    return device;
  },
};

(async () => {
  await context.ESP32.connect();
  assert.strictEqual(chooserCount, 1);
  assert.strictEqual((await context.ESP32.calibrate('start')).calibrationStage, 'bent');
  assert.strictEqual((await context.ESP32.calibrate('bent')).calibrationStage, 'open');
  const calibrated = await context.ESP32.calibrate('open');
  assert.strictEqual(calibrated.calibrated, true);
  assert.strictEqual(calibrated.enabled.middleThumb, false);

  context.ESP32.disconnect();
  await context.ESP32.connect();
  assert.strictEqual(chooserCount, 1);
  console.log('BLE sensor state and calibration protocol passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
