const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

function storage(initial = {}, setItem = null) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, String(value)]));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) {
      if (setItem) return setItem(key, value);
      values.set(key, String(value));
    },
  };
}

function contextWith(globals = {}) {
  return vm.createContext({
    console,
    TextDecoder,
    TextEncoder,
    URL,
    setTimeout,
    clearTimeout,
    ...globals,
  });
}

function runScript(context, relativePath) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'), context, { filename: relativePath });
}

function readGlobal(context, name) {
  return vm.runInContext(name, context);
}

function fakeAudioContext() {
  return class FakeAudioContext {
    constructor() {
      this.state = 'running';
      this.currentTime = 0;
      this.destination = {};
    }
    createGain() {
      return {
        gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {},
      };
    }
    createOscillator() {
      return {
        type: '',
        frequency: { value: 0 },
        connect() {},
        start() {},
        stop() {},
      };
    }
    resume() {}
  };
}

function fakeCanvasContext() {
  const gradient = { addColorStop() {} };
  return {
    clearRect() {}, createLinearGradient() { return gradient; },
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, roundRect() {}, fill() {},
    save() {}, restore() {}, fillText() {}, fillRect() {},
    set strokeStyle(_value) {}, set lineWidth(_value) {}, set fillStyle(_value) {},
    set shadowColor(_value) {}, set shadowBlur(_value) {}, set globalAlpha(_value) {},
    set font(_value) {}, set textAlign(_value) {}, set textBaseline(_value) {},
  };
}

function bleHarness() {
  const deviceListeners = {};
  const txListeners = {};
  const device = {
    name: 'FlortteGlove',
    addEventListener(name, callback) { deviceListeners[name] = callback; },
    gatt: {
      connected: false,
      async connect() { device.gatt.connected = true; return server; },
      disconnect() {
        device.gatt.connected = false;
        deviceListeners.gattserverdisconnected?.();
      },
    },
  };
  const rx = { async writeValueWithoutResponse() {} };
  const validPacket = JSON.stringify({
    sensors: { key: 4095, index: 4095, middle: 4095, ring: 4095, little: 4095 },
    calibrating: false,
  });
  const tx = {
    addEventListener(name, callback) { txListeners[name] = callback; },
    async startNotifications() {},
    async readValue() {
      const bytes = new TextEncoder().encode(validPacket);
      return new DataView(bytes.buffer);
    },
  };
  const service = { async getCharacteristic(uuid) { return uuid.includes('0002-') ? rx : tx; } };
  const server = { async getPrimaryService() { return service; } };
  return {
    navigator: { bluetooth: { async requestDevice() { return device; } } },
    device,
    rx,
    notify(value) {
      const bytes = new TextEncoder().encode(value);
      txListeners.characteristicvaluechanged({ target: { value: new DataView(bytes.buffer) } });
    },
  };
}

async function run() {
  {
    const context = contextWith({
      localStorage: storage({ game_approach_time: 'not-a-number', game_window: '-999' }),
    });
    runScript(context, 'js/game.js');
    const Game = readGlobal(context, 'Game');
    assert.equal(Game.getApproachTime(), 2800, 'A1 uses the safe approach-time default');
    assert.equal(Game.getWindow(), 100, 'A1 clamps the hit window');
  }

  {
    class StrictAudio {
      constructor() { this.currentTime = 0; this.loop = false; this._volume = 1; }
      set volume(value) {
        if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError('invalid volume');
        this._volume = value;
      }
      get volume() { return this._volume; }
      play() { return Promise.resolve(); }
      pause() {}
    }
    const context = contextWith({
      localStorage: storage({ volume: '2' }),
      performance: { now: () => 0 },
      window: { AudioContext: fakeAudioContext() },
      Audio: StrictAudio,
      requestAnimationFrame() { return 1; },
      cancelAnimationFrame() {},
    });
    runScript(context, 'js/audio.js');
    const AudioPlayer = readGlobal(context, 'AudioPlayer');
    assert.equal(AudioPlayer.getVolume(), 1, 'A2 clamps persisted volume');
    assert.doesNotThrow(() => AudioPlayer.play({ audioUrl: 'song.mp3', durationMs: 1000, notes: [] }));
  }

  {
    let nextFrameId = 0;
    const frames = new Map();
    const canvas = {
      width: 100, height: 100,
      getContext: () => fakeCanvasContext(),
      getBoundingClientRect: () => ({ width: 100, height: 100 }),
    };
    const context = contextWith({
      localStorage: storage(), devicePixelRatio: 1, performance: { now: () => 0 },
      requestAnimationFrame(callback) { const id = ++nextFrameId; frames.set(id, callback); return id; },
      cancelAnimationFrame(id) { frames.delete(id); },
      window: { addEventListener() {} },
      document: {
        getElementById(id) { return id === 'game-canvas' ? canvas : null; },
        querySelectorAll() { return []; },
      },
      ESP32: { onData() {} },
      Gestures: {
        laneCount: () => 1, playableGestures: () => [], setActiveGestureIds() {},
        gestureForLane: () => ({ id: 'fist', name: 'Кулак', pattern: [0, 0, 0, 0, 0], color: '#000', glow: '#000' }),
      },
      GameResults: { createSession: () => ({}), finalizeSession: () => ({}), save() {}, recordHit() {} },
      AudioPlayer: { play: () => ({ currentMs: 0, pause() {}, resume() {}, stop() {} }) },
    });
    runScript(context, 'js/game.js');
    const Game = readGlobal(context, 'Game');
    Game.init();
    Game.start({ notes: [], durationMs: 10000, gestureIds: [] });
    assert.equal(frames.size, 1, 'A3 starts one render loop');
    for (let index = 0; index < 5; index++) {
      Game.pause();
      assert.equal(frames.size, 0, 'A3 cancels drawing while paused');
      Game.resume();
      assert.equal(frames.size, 1, 'A3 resumes one render loop');
    }
  }

  {
    const harness = bleHarness();
    const context = contextWith({ localStorage: storage(), navigator: harness.navigator });
    runScript(context, 'js/gestures.js');
    runScript(context, 'js/esp32.js');
    const Gestures = readGlobal(context, 'Gestures');
    const ESP32 = readGlobal(context, 'ESP32');
    let notifications = 0;
    ESP32.onData(() => { notifications++; });
    await ESP32.connect();
    const beforeError = notifications;

    harness.notify('{broken-json');
    assert.equal(ESP32.status, 'error', 'A4 exposes invalid BLE JSON');
    assert.ok(notifications > beforeError, 'A4 notifies the UI about the error');
    assert.equal(Gestures.classify(ESP32.sensors).gesture.id, 'unsupported', 'A5 invalidates stale sensor data');

    harness.notify(JSON.stringify({
      sensors: { key: 100, index: 200, middle: 300, ring: 400, little: 500 },
      calibration: { key: { bent: 100, straight: 3000 } },
      enabled: { key: false, index: true },
      calibrating: false,
    }));
    assert.equal(ESP32.status, 'connected', 'valid BLE data recovers the connection');
    assert.equal(ESP32.lastState.calibration.keyPinch.bent, 100, 'A6 retains calibration metadata');
    assert.equal(ESP32.lastState.enabled.keyPinch, false, 'A6 retains enabled metadata');

    harness.rx.writeValueWithoutResponse = async () => harness.device.gatt.disconnect();
    await assert.rejects(() => ESP32.calibrate('open'), /потеряно/, 'A7 rejects calibration after disconnect');
  }

  {
    const documentListeners = {};
    const elements = new Map();
    const classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
    function element(id) {
      if (!elements.has(id)) {
        elements.set(id, {
          id, className: '', classList, style: { width: '' }, textContent: '', title: '', disabled: false,
          addEventListener() {},
        });
      }
      return elements.get(id);
    }
    const context = contextWith({
      localStorage: storage(), navigator: {}, window: { addEventListener() {} },
      document: {
        getElementById(id) { return ['song-list', 'settings-save'].includes(id) ? null : element(id); },
        querySelectorAll() { return []; },
        addEventListener(name, callback) { documentListeners[name] = callback; },
      },
      Diagnostics: { init() {}, leave() {}, enter() {} },
      GloveSettings: { init() {} },
      Game: {
        init() {}, pause() {}, start() {}, stop() {}, resume() {}, onScoreChange() {}, onEnd() {},
        isActive: () => false, getApproachTime: () => 2800, getWindow: () => 250,
      },
      ExerciseBuilder: { init() {}, enter() {}, audioPresets: () => [] },
      AudioPlayer: { resumeCtx() {}, getVolume: () => 0.8 },
    });
    runScript(context, 'js/gestures.js');
    runScript(context, 'js/esp32.js');
    runScript(context, 'js/app.js');
    documentListeners.DOMContentLoaded();
    const ESP32 = readGlobal(context, 'ESP32');
    const Gestures = readGlobal(context, 'Gestures');
    documentListeners.keydown({
      code: 'Digit9', repeat: false,
      target: { tagName: 'BODY', isContentEditable: false }, preventDefault() {},
    });
    assert.equal(Gestures.classify(ESP32.sensors).gesture.id, 'open-hand', 'A8 maps Digit9 correctly');
    assert.equal(ESP32.status, 'disconnected', 'A8 debug input does not fake a BLE connection');
  }

  {
    const quotaError = new Error('QuotaExceededError');
    const context = contextWith({ localStorage: storage({}, () => { throw quotaError; }) });
    runScript(context, 'js/gestures.js');
    const Gestures = readGlobal(context, 'Gestures');
    assert.doesNotThrow(() => Gestures.setThreshold('keyPinch', 'bend', 700));
    assert.match(Gestures.lastStorageError, /QuotaExceededError/, 'A9 reports the persistence failure');
  }

  {
    const badHistory = JSON.stringify([{
      songName: 'corrupt', timing: null, fingers: 'invalid', completedAt: new Date(0).toISOString(),
    }]);
    const context = contextWith({ localStorage: storage({ flortte_game_results_v1: badHistory }) });
    runScript(context, 'js/game-results.js');
    const history = readGlobal(context, 'GameResults').loadHistory();
    assert.equal(Array.isArray(history[0].fingers), true, 'A10 sanitizes malformed fingers');
    assert.equal(history[0].fingers.length, 0);
    assert.deepEqual(Object.keys(history[0].timing), []);
  }

  {
    const captured = { webContentsEvents: {} };
    const webContents = {
      on(name, callback) { captured.webContentsEvents[name] = callback; },
      setWindowOpenHandler(callback) { captured.windowOpen = callback; },
      getURL() { return 'flortte://app/index.html'; },
    };
    class FakeBrowserWindow {
      constructor() {
        this.webContents = webContents;
        this.once = () => {}; this.on = () => {}; this.show = () => {};
        this.loadURL = value => { captured.loadedUrl = value; };
      }
      static getAllWindows() { return [1]; }
    }
    const defaultSession = {
      setPermissionCheckHandler(fn) { captured.check = fn; },
      setPermissionRequestHandler(fn) { captured.request = fn; },
      setDevicePermissionHandler(fn) { captured.device = fn; },
    };
    const electron = {
      app: { whenReady: () => Promise.resolve(), setAppUserModelId() {}, on() {}, quit() {} },
      BrowserWindow: FakeBrowserWindow,
      net: { fetch: async () => new Response('ok') },
      protocol: { registerSchemesAsPrivileged() {}, handle(_scheme, handler) { captured.protocolHandler = handler; } },
      session: { defaultSession },
    };
    const context = vm.createContext({
      console, URL, Response, process: { platform: 'linux' }, __dirname: path.join(ROOT, 'electron'),
      require(id) {
        if (id === 'electron') return electron;
        if (id === 'path') return path;
        if (id === 'url') return require('url');
        throw new Error(`unexpected module: ${id}`);
      },
    });
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'electron/main.js'), 'utf8'), context);
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(captured.check(webContents, 'bluetooth', 'flortte://app', {}), true);
    assert.equal(captured.check(webContents, 'bluetooth', 'https://attacker.invalid', {}), false, 'A11 rejects another origin');
    let allowed = null;
    captured.request(webContents, 'bluetooth', value => { allowed = value; }, { requestingUrl: 'https://attacker.invalid' });
    assert.equal(allowed, false, 'A11 rejects a remote permission request');
    assert.equal(captured.device({
      deviceType: 'bluetooth', origin: 'flortte://app', device: { deviceName: 'OtherDevice' },
    }), false, 'A11 rejects an unrelated named device');
    const event = { prevented: false, preventDefault() { this.prevented = true; } };
    captured.webContentsEvents['will-navigate'](event, 'https://attacker.invalid');
    assert.equal(event.prevented, true, 'A11 blocks remote navigation');
    assert.equal(captured.windowOpen().action, 'deny', 'A11 blocks new windows');
  }

  console.log('Adversarial regressions passed.');
}

run().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
