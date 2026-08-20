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
  let _stateVersion = 0;
  let _lastState = { raw: {}, bendPercent: {}, calibration: {}, enabled: {}, calibrating: false, calibratedAt: 0, valid: false };
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

  function _object(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function _fingerMetadata(value) {
    const source = _object(value);
    return {
      ...source,
      ...(source.keyPinch === undefined && source.key !== undefined ? { keyPinch: source.key } : {}),
      ...(source.indexThumb === undefined && source.index !== undefined ? { indexThumb: source.index } : {}),
      ...(source.middleThumb === undefined && source.middle !== undefined ? { middleThumb: source.middle } : {}),
    };
  }

  function _normalizeSensors(values) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      throw new TypeError('Поле sensors отсутствует');
    }
    const candidates = {
      keyPinch: values.key ?? values.keyPinch ?? values.thumb,
      indexThumb: values.index ?? values.indexThumb,
      middleThumb: values.middle ?? values.middleThumb,
      ring: values.ring,
      little: values.little,
    };
    return Object.fromEntries(Object.entries(candidates).map(([key, value]) => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric < 0 || numeric > 4095) {
        throw new TypeError(`Некорректное значение сенсора ${key}`);
      }
      return [key, numeric];
    }));
  }

  function _markDataError(error) {
    _lastError = `Некорректные BLE-данные: ${error.message || String(error)}`;
    Object.keys(sensors).forEach(key => { sensors[key] = NaN; });
    _lastState = { ..._lastState, valid: false };
    _setStatus('error');
  }

  function _applyState(data = {}, { markConnected = true } = {}) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new TypeError('BLE-состояние должно быть объектом');
    }
    const values = _normalizeSensors(data.sensors);
    Object.assign(sensors, values);
    _lastState = {
      ..._lastState,
      raw: { ...(_lastState.raw || {}), ..._object(data.raw) },
      bendPercent: { ...(_lastState.bendPercent || {}), ..._object(data.bendPercent) },
      calibration: { ...(_lastState.calibration || {}), ..._fingerMetadata(data.calibration) },
      enabled: { ...(_lastState.enabled || {}), ..._fingerMetadata(data.enabled) },
      calibrating: data.calibrating ?? _lastState.calibrating,
      calibratedAt: data.calibratedAt ?? _lastState.calibratedAt,
      valid: true,
    };
    if (markConnected) {
      _stateVersion++;
      _lastError = '';
      if (_status !== 'connected') _status = 'connected';
    }
    _emit();
  }

  function _onValue(event) {
    try {
      const view = event.target.value;
      const text = new TextDecoder().decode(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
      _applyState(JSON.parse(text));
    } catch (err) {
      _markDataError(err);
    }
  }

  function _onDisconnected() {
    _rx = null;
    _tx = null;
    Object.keys(sensors).forEach(key => { sensors[key] = NaN; });
    _lastState = { ..._lastState, valid: false };
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
        filters: [{ services: [SERVICE_UUID] }],
        optionalServices: [SERVICE_UUID],
      });
      _device.addEventListener('gattserverdisconnected', _onDisconnected);
      const server = await _device.gatt.connect();
      const service = await server.getPrimaryService(SERVICE_UUID);
      _rx = await service.getCharacteristic(RX_UUID);
      _tx = await service.getCharacteristic(TX_UUID);
      _tx.addEventListener('characteristicvaluechanged', _onValue);
      await _tx.startNotifications();
      try {
        _applyState(JSON.parse(new TextDecoder().decode(await _tx.readValue())));
      } catch (error) {
        _markDataError(error);
        throw error;
      }
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

  function _waitForFreshState(version, predicate, timeoutMs = 4000) {
    if (_status === 'disconnected') return Promise.reject(new Error('Соединение с перчаткой потеряно'));
    if (_stateVersion > version && predicate(_lastState)) return Promise.resolve(_snapshotState());

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, state) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        offData(onState);
        if (error) reject(error);
        else resolve(state);
      };
      const onState = (_values, status, state) => {
        if (status === 'disconnected' || status === 'error') {
          finish(new Error(_lastError || 'Соединение с перчаткой потеряно'));
        } else if (_stateVersion > version && predicate(state)) {
          finish(null, state);
        }
      };
      const timer = setTimeout(() => finish(new Error('Перчатка не подтвердила команду калибровки')), timeoutMs);
      onData(onState);
    });
  }

  async function calibrate(action = 'start') {
    if (!['start', 'bent', 'open', 'cancel'].includes(action)) {
      throw new Error('Неизвестная команда калибровки');
    }
    const version = _stateVersion;
    await _writeCommand(`calibrate:${action}`);
    if (_status !== 'connected') throw new Error('Соединение с перчаткой потеряно');
    const expectedCalibrating = !['open', 'cancel'].includes(action);
    return _waitForFreshState(version, state => state.calibrating === expectedCalibrating);
  }

  function start() { _emit(); }
  function stop() {}
  function onData(fn) { if (!_listeners.includes(fn)) _listeners.push(fn); }
  function offData(fn) { _listeners = _listeners.filter(item => item !== fn); }
  function injectSensors(values = {}) { _applyState({ sensors: values }, { markConnected: false }); }

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
