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
  let _stateWaiters = [];
  let _stateVersion = 0;
  let _hasCalibrationProtocol = false;
  let _status = 'disconnected';
  let _lastError = '';
  let _lastState = {
    raw: {},
    bendPercent: {},
    calibration: {},
    enabled: {},
    calibrating: false,
    calibrated: false,
    calibrationStage: 'idle',
    calibratedAt: 0,
  };
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

  function _fingerValues(source = {}, transform = value => value) {
    const aliases = {
      keyPinch: ['keyPinch', 'key', 'thumb'],
      indexThumb: ['indexThumb', 'index'],
      middleThumb: ['middleThumb', 'middle'],
      ring: ['ring'],
      little: ['little'],
    };
    return Object.entries(aliases).reduce((result, [target, keys]) => {
      const sourceKey = keys.find(key => Object.prototype.hasOwnProperty.call(source, key));
      if (sourceKey === undefined) return result;
      const value = transform(source[sourceKey]);
      if (value !== undefined) result[target] = value;
      return result;
    }, {});
  }

  function _adcValue(value) {
    if (value === null || value === undefined || value === '') return undefined;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0 || numeric > 4095) return undefined;
    return Math.round(numeric);
  }

  function _resolveStateWaiters() {
    const snapshot = _snapshotState();
    _stateWaiters = _stateWaiters.filter(waiter => {
      if (!waiter.predicate(snapshot, _stateVersion)) return true;
      clearTimeout(waiter.timer);
      waiter.resolve(snapshot);
      return false;
    });
  }

  function _rejectStateWaiters(error) {
    const waiters = _stateWaiters;
    _stateWaiters = [];
    waiters.forEach(waiter => {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    });
  }

  function _waitForState(predicate, timeoutMs = 3500) {
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        _stateWaiters = _stateWaiters.filter(item => item !== waiter);
        reject(new Error('Перчатка не подтвердила шаг калибровки'));
      }, timeoutMs);
      _stateWaiters.push(waiter);
      _resolveStateWaiters();
    });
  }

  function _applyState(data = {}) {
    Object.assign(sensors, _fingerValues(data.sensors || {}, _adcValue));
    const enabled = _fingerValues(data.enabled || {}, value => typeof value === 'boolean' ? value : undefined);
    const bendPercent = _fingerValues(data.bendPercent || {}, value => {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? Math.max(0, Math.min(100, Math.round(numeric))) : undefined;
    });
    if (typeof data.calibrationStage === 'string') _hasCalibrationProtocol = true;
    _lastState = {
      ..._lastState,
      raw: { ...(_lastState.raw || {}), ..._fingerValues(data.raw || {}, _adcValue) },
      bendPercent: { ...(_lastState.bendPercent || {}), ...bendPercent },
      enabled: { ...(_lastState.enabled || {}), ...enabled },
      calibrating: data.calibrating ?? _lastState.calibrating,
      calibrated: data.calibrated ?? _lastState.calibrated,
      calibrationStage: typeof data.calibrationStage === 'string'
        ? data.calibrationStage
        : _lastState.calibrationStage,
      calibratedAt: data.calibratedAt ?? _lastState.calibratedAt,
    };
    if (Object.keys(enabled).length && typeof Gestures !== 'undefined' && Gestures.setEnabledFingers) {
      Gestures.setEnabledFingers(enabled);
    }
    _lastError = '';
    if (_status !== 'connected') _status = 'connected';
    _stateVersion++;
    _resolveStateWaiters();
    _emit();
  }

  function _onValue(event) {
    try {
      const view = event.target.value;
      const text = new TextDecoder().decode(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
      _applyState(JSON.parse(text));
    } catch (err) {
      _lastError = `Некорректные BLE-данные: ${err.message}`;
      _emit();
    }
  }

  function _onDisconnected() {
    _rx = null;
    _tx = null;
    _rejectStateWaiters(new Error('Соединение с перчаткой потеряно'));
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
      if (!_device) {
        _device = await navigator.bluetooth.requestDevice({
          filters: [{ services: [SERVICE_UUID] }],
          optionalServices: [SERVICE_UUID],
        });
      }
      _device.removeEventListener('gattserverdisconnected', _onDisconnected);
      _device.addEventListener('gattserverdisconnected', _onDisconnected);
      const server = await _device.gatt.connect();
      const service = await server.getPrimaryService(SERVICE_UUID);
      _rx = await service.getCharacteristic(RX_UUID);
      _tx = await service.getCharacteristic(TX_UUID);
      _tx.removeEventListener('characteristicvaluechanged', _onValue);
      _tx.addEventListener('characteristicvaluechanged', _onValue);
      await _tx.startNotifications();
      try { _applyState(JSON.parse(new TextDecoder().decode(await _tx.readValue()))); }
      catch (_) { _setStatus('connected'); }
    } catch (err) {
      _rx = null;
      _tx = null;
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
    if (!['start', 'bent', 'open', 'cancel'].includes(action)) {
      throw new Error('Неизвестный шаг калибровки');
    }
    const versionBeforeWrite = _stateVersion;
    await _writeCommand(`calibrate:${action}`);
    let state;
    if (action === 'start') {
      state = await _waitForState((next, version) => version > versionBeforeWrite && next.calibrating);
    } else if (action === 'bent' && _hasCalibrationProtocol) {
      state = await _waitForState((next, version) => (
        version > versionBeforeWrite && next.calibrating && next.calibrationStage === 'open'
      ), 4500);
    } else if (action === 'bent') {
      await new Promise(resolve => setTimeout(resolve, 450));
      state = _snapshotState();
    } else {
      state = await _waitForState((next, version) => version > versionBeforeWrite && !next.calibrating, 4500);
    }
    if (action === 'open' && _hasCalibrationProtocol && !state.calibrated) {
      throw new Error('Калибровка не сохранена. Проверьте диапазон движения сенсоров');
    }
    return state;
  }

  function start() { _emit(); }
  function stop() {}
  function onData(fn) { if (!_listeners.includes(fn)) _listeners.push(fn); }
  function offData(fn) { _listeners = _listeners.filter(item => item !== fn); }
  function injectSensors(values = {}, state = {}) { _applyState({ ...state, sensors: values }); }

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
