/** Web Bluetooth bridge for the Flortte ESP32 glove. */
const ESP32 = (() => {
  const DEVICE_NAME = 'FlortteGlove';
  const SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
  const RX_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
  const TX_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

  let _device = null;
  let _rx = null;
  let _tx = null;
  let _listeners = [];
  let _status = 'disconnected';
  let _lastError = '';
  let _lastState = { raw: {}, bendPercent: {}, calibration: {}, enabled: {}, calibrating: false, calibratedAt: 0 };
  const sensors = {
    keyPinch: 4095,
    indexThumb: 4095,
    middleThumb: 4095,
    ring: 4095,
    little: 4095,
  };

  function _snapshotState() {
    return {
      ..._lastState,
      raw: { ..._lastState.raw },
      bendPercent: { ..._lastState.bendPercent },
      calibration: { ..._lastState.calibration },
      enabled: { ..._lastState.enabled },
    };
  }

  function _emit() {
    const values = { ...sensors };
    const state = _snapshotState();
    _listeners.forEach(fn => { try { fn(values, _status, state); } catch (_) {} });
  }

  function _setStatus(status) {
    _status = status;
    _emit();
  }

  function _applyState(data = {}) {
    const values = data.sensors || {};
    sensors.keyPinch = values.key ?? values.keyPinch ?? values.thumb ?? sensors.keyPinch;
    sensors.indexThumb = values.index ?? values.indexThumb ?? sensors.indexThumb;
    sensors.middleThumb = values.middle ?? values.middleThumb ?? sensors.middleThumb;
    sensors.ring = values.ring ?? sensors.ring;
    sensors.little = values.little ?? sensors.little;
    _lastState = {
      ..._lastState,
      raw: { ...(_lastState.raw || {}), ...(data.raw || {}) },
      bendPercent: { ...(_lastState.bendPercent || {}), ...(data.bendPercent || {}) },
      calibrating: data.calibrating ?? _lastState.calibrating,
      calibratedAt: data.calibratedAt ?? _lastState.calibratedAt,
    };
    _lastError = '';
    if (_status !== 'connected') _status = 'connected';
    _emit();
  }

  function _onValue(event) {
    try {
      const view = event.target.value;
      const text = new TextDecoder().decode(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
      _applyState(JSON.parse(text));
    } catch (err) {
      _lastError = `Некорректные BLE-данные: ${err.message}`;
    }
  }

  function _onDisconnected() {
    _rx = null;
    _tx = null;
    _setStatus('disconnected');
  }

  async function connect() {
    if (!navigator.bluetooth) {
      _lastError = 'Web Bluetooth не поддерживается этим браузером';
      _setStatus('error');
      throw new Error(_lastError);
    }
    if (_device?.gatt?.connected && _rx && _tx) return;

    _lastError = '';
    _setStatus('connecting');
    try {
      _device = await navigator.bluetooth.requestDevice({
        filters: [{ name: DEVICE_NAME }],
        optionalServices: [SERVICE_UUID],
      });
      _device.addEventListener('gattserverdisconnected', _onDisconnected);
      const server = await _device.gatt.connect();
      const service = await server.getPrimaryService(SERVICE_UUID);
      _rx = await service.getCharacteristic(RX_UUID);
      _tx = await service.getCharacteristic(TX_UUID);
      _tx.addEventListener('characteristicvaluechanged', _onValue);
      await _tx.startNotifications();
      try { _applyState(JSON.parse(new TextDecoder().decode(await _tx.readValue()))); }
      catch (_) { _setStatus('connected'); }
    } catch (err) {
      _lastError = err?.name === 'NotFoundError' ? 'Выбор Bluetooth-устройства отменён' : (err.message || String(err));
      _setStatus('error');
      throw err;
    }
  }

  function disconnect() {
    if (_device?.gatt?.connected) _device.gatt.disconnect();
    else _onDisconnected();
  }

  async function _writeCommand(command) {
    if (!_rx || !_device?.gatt?.connected) throw new Error('Сначала подключите перчатку по Bluetooth');
    const bytes = new TextEncoder().encode(command);
    if (_rx.writeValueWithoutResponse) await _rx.writeValueWithoutResponse(bytes);
    else await _rx.writeValue(bytes);
  }

  async function calibrate(action = 'start') {
    await _writeCommand(`calibrate:${action}`);
    _lastState = { ..._lastState, calibrating: !['open', 'cancel'].includes(action) };
    _emit();
    await new Promise(resolve => setTimeout(resolve, action === 'open' ? 700 : 250));
    return _snapshotState();
  }

  function start() { _emit(); }
  function stop() {}
  function onData(fn) { if (!_listeners.includes(fn)) _listeners.push(fn); }
  function offData(fn) { _listeners = _listeners.filter(item => item !== fn); }
  function injectSensors(values = {}) { _applyState({ sensors: values }); }

  return {
    get sensors() { return sensors; },
    get status() { return _status; },
    get deviceName() { return _device?.name || DEVICE_NAME; },
    get lastState() { return _snapshotState(); },
    get lastError() { return _lastError; },
    get lastUrl() { return `bluetooth://${DEVICE_NAME}`; },
    get isSupported() { return !!navigator.bluetooth; },
    start, stop, connect, disconnect, calibrate, onData, offData, injectSensors,
  };
})();
