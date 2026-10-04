const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function harness({ legacy = false, partialRead = false } = {}) {
  const timers = new Map();
  const deviceEvents = {};
  const txEvents = {};
  const commands = [];
  const elements = new Map();
  const steps = ['prepare', 'move', 'tune'].map(step => element(step, { step }));
  let sequence = 0;
  const sensors = { key: 4095, index: 4095, middle: 4095, ring: 4095, little: 4095 };
  const packet = (step = 'idle', extra = {}) => ({
    sensors, calibrating: ['prepare', 'bent', 'error'].includes(step),
    ...(legacy ? {} : { calibrationSeq: sequence, calibrationStep: step }),
    ...extra,
  });
  function element(id, dataset = {}) {
    const classes = new Set();
    const listeners = {};
    return {
      id, dataset, hidden: false, disabled: false, value: '', textContent: '', className: '',
      classList: {
        add(name) { classes.add(name); }, remove(name) { classes.delete(name); },
        toggle(name, active) { if (active) classes.add(name); else classes.delete(name); },
        contains(name) { return classes.has(name); },
      },
      addEventListener(name, callback) { listeners[name] = callback; },
      click() { return listeners.click?.(); },
    };
  }
  const device = {
    name: 'FlortteGlove', addEventListener(name, callback) { deviceEvents[name] = callback; },
    gatt: {
      connected: false,
      async connect() { this.connected = true; return server; },
      disconnect() { this.connected = false; deviceEvents.gattserverdisconnected(); },
    },
  };
  const rx = { async writeValueWithResponse(bytes) { commands.push(new TextDecoder().decode(bytes)); } };
  const tx = {
    addEventListener(name, callback) { txEvents[name] = callback; },
    async startNotifications() {},
    async readValue() { return view(partialRead ? '"little":4095}' : JSON.stringify(packet())); },
  };
  const service = { async getCharacteristic(uuid) { return uuid.includes('0002-') ? rx : tx; } };
  const server = { async getPrimaryService() { return service; } };
  function view(text) {
    const bytes = new TextEncoder().encode(text);
    // Exercise DataView offsets as well as MTU fragmentation.
    const padded = new Uint8Array(bytes.length + 4);
    padded.set(bytes, 2);
    return new DataView(padded.buffer, 2, bytes.length);
  }
  function notify(text) { txEvents.characteristicvaluechanged({ target: { value: view(text) } }); }
  function send(data, framed = true) {
    const text = JSON.stringify(data);
    if (!framed) { notify(text); return; }
    const frame = `~${text}\n`;
    for (let i = 0; i < frame.length; i += 20) notify(frame.slice(i, i + 20));
  }
  const context = vm.createContext({
    console, TextEncoder, TextDecoder,
    setTimeout(fn) { const timer = {}; timers.set(timer, fn); return timer; },
    clearTimeout(timer) { timers.delete(timer); },
    navigator: { bluetooth: { async requestDevice() { return device; } } },
    localStorage: { getItem() { return null; }, setItem() {} },
    document: {
      getElementById(id) { if (!elements.has(id)) elements.set(id, element(id)); return elements.get(id); },
      querySelectorAll() { return steps; },
    },
  });
  ['gestures', 'esp32', 'glove-settings'].forEach(name => {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', `${name}.js`), 'utf8'), context);
  });
  const ESP32 = vm.runInContext('ESP32', context);
  const GloveSettings = vm.runInContext('GloveSettings', context);
  return {
    ESP32, GloveSettings, commands, timers, elements, steps, device, notify, send, packet,
    ack(step, extra = {}) { sequence++; send(packet(step, extra)); },
  };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

async function run() {
  {
    const h = harness();
    await h.ESP32.connect();
    let settled = false;
    const start = h.ESP32.calibrate('start').then(() => { settled = true; });
    await flush();
    h.send(h.packet('prepare')); // Fresh telemetry, but command has not been processed.
    await flush();
    assert.equal(settled, false, 'start requires an incremented acknowledgement');
    h.ack('prepare');
    await start;
    assert.equal(h.timers.size, 0);

    settled = false;
    const bent = h.ESP32.calibrate('bent').then(() => { settled = true; });
    await flush();
    await assert.rejects(h.ESP32.calibrate('open'), /текущего шага/);
    h.send(h.packet('prepare'));
    await flush();
    assert.equal(settled, false, 'calibrating=true does not acknowledge the bent capture');
    h.ack('bent');
    await bent;
    const open = h.ESP32.calibrate('open');
    await flush();
    h.ack('done', { enabled: { key: true, index: false, middle: true, ring: true, little: true }, calibratedAt: 123 });
    const completed = await open;
    assert.equal(completed.enabled.indexThumb, false);
    assert.equal(completed.calibratedAt, 123);
    assert.deepEqual(h.commands, ['calibrate:start', 'calibrate:bent', 'calibrate:open']);
  }
  {
    const h = harness();
    await h.ESP32.connect();
    const failed = h.ESP32.calibrate('open');
    await flush();
    h.ack('error');
    await assert.rejects(failed, /Поза не сохранена/);
    const retry = h.ESP32.calibrate('cancel');
    await flush();
    h.ack('idle');
    await retry;
    assert.equal(h.timers.size, 0);
    const timedOut = h.ESP32.calibrate('start');
    await flush();
    for (const fn of [...h.timers.values()]) fn();
    await assert.rejects(timedOut, /не подтвердила/);
    assert.equal(h.timers.size, 0);
    const disconnected = h.ESP32.calibrate('start');
    await flush();
    h.device.gatt.disconnect();
    await assert.rejects(disconnected, /потеряно/);
    assert.equal(h.ESP32.lastState.calibrationSeq, null);
    assert.equal(h.timers.size, 0);
  }
  {
    const h = harness({ legacy: true });
    await h.ESP32.connect();
    await assert.rejects(h.ESP32.calibrate('start'), /Обновите прошивку/);
    assert.equal(h.commands.length, 0, 'unsupported firmware receives no calibration commands');
  }
  {
    const h = harness({ partialRead: true });
    const connecting = h.ESP32.connect();
    await flush();
    h.send(h.packet());
    await connecting;
    assert.equal(h.ESP32.status, 'connected', 'complete telemetry recovers an overlapping GATT read');
    h.notify('~{"sensors":');
    h.send(h.packet('idle', { sensors: { key: 11, index: 22, middle: 33, ring: 44, little: 55 } }));
    assert.equal(h.ESP32.sensors.keyPinch, 11, 'new frame resynchronizes after a dropped chunk');
    h.notify('~{broken}\n');
    assert.equal(h.ESP32.status, 'error');
    h.send(h.packet(), false);
    assert.equal(h.ESP32.status, 'connected', 'legacy complete JSON still works');
  }
  {
    const h = harness();
    h.GloveSettings.init();
    const button = id => h.elements.get(id);
    const status = button('calibration-status');
    assert.equal(button('btn-calibrate').disabled, true);
    await h.ESP32.connect();
    assert.equal(button('btn-calibrate').disabled, false);
    const start = button('btn-calibrate').click();
    await flush();
    await button('btn-calibrate').click();
    assert.equal(h.commands.length, 1, 'double clicks do not enqueue another command');
    assert.equal(button('btn-cancel-calibration').disabled, true);
    h.ack('prepare');
    await start;
    assert.equal(button('btn-capture-bent').hidden, false);
    const bent = button('btn-capture-bent').click();
    await flush();
    h.ack('bent');
    await bent;
    assert.equal(button('btn-capture-open').hidden, false);
    const failed = button('btn-capture-open').click();
    await flush();
    h.ack('error');
    await failed;
    assert.equal(button('btn-capture-open').hidden, false, 'failed pose can be retried');
    const open = button('btn-capture-open').click();
    await flush();
    h.ack('done', { calibrationSaved: true });
    await open;
    h.send(h.packet('done'));
    assert.equal(status.textContent, 'Калибровка завершена.', 'telemetry preserves the completion message');
    assert.ok(h.steps.every(step => step.classList.contains('done')));
    const restart = button('btn-calibrate').click();
    await flush();
    h.ack('prepare');
    await restart;
    const recapture = button('btn-capture-bent').click();
    await flush();
    h.ack('bent');
    await recapture;
    const partialSuccess = button('btn-capture-open').click();
    await flush();
    h.ack('done', { calibrationSaved: false, enabled: { key: false, index: true, middle: true, ring: true, little: true } });
    await partialSuccess;
    h.send(h.packet('done'));
    assert.match(status.textContent, /большой/);
    assert.match(status.textContent, /После выключения/);
    const cancelStart = button('btn-calibrate').click();
    await flush();
    h.ack('prepare');
    await cancelStart;
    const cancel = button('btn-cancel-calibration').click();
    await flush();
    h.ack('idle');
    await cancel;
    assert.equal(button('btn-calibrate').hidden, false);
    assert.equal(status.textContent, 'Калибровка отменена.');
    const disconnectStart = button('btn-calibrate').click();
    await flush();
    h.ack('prepare');
    await disconnectStart;
    h.device.gatt.disconnect();
    assert.equal(button('btn-calibrate').hidden, false, 'idle disconnect resets the wizard');
    assert.equal(button('btn-calibrate').disabled, true);
    assert.match(status.textContent, /потеряна/);
  }
  console.log('Calibration acknowledgements, BLE framing, retry, timeout and UI regressions passed.');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
