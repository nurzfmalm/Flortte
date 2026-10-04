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
  let _notificationFrame = null;
  let _calibrationPending = false;
  const _emptyState = () => ({ raw: {}, bendPercent: {}, calibration: {}, enabled: {}, calibrating: false, calibratedAt: 0, calibrationSeq: null, calibrationStep: 'idle', calibrationSaved: null, valid: false });
  let _lastState = _emptyState();
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
      calibrationSeq: Number.isInteger(data.calibrationSeq) ? data.calibrationSeq : _lastState.calibrationSeq,
      calibrationStep: data.calibrationStep ?? _lastState.calibrationStep,
      calibrationSaved: data.calibrationSaved ?? _lastState.calibrationSaved,
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
      // New firmware frames JSON with '~' and a newline, in MTU-safe chunks.
      // Unframed, complete JSON from earlier firmware is still readable.
      if (text.startsWith('~')) _notificationFrame = text.slice(1);
      else if (_notificationFrame !== null) _notificationFrame += text;
      else {
        _applyState(JSON.parse(text));
        return;
      }
      if (_notificationFrame.length > 4096) throw new Error('BLE-пакет слишком длинный');
      if (_notificationFrame.endsWith('\n')) {
        const frame = _notificationFrame;
        _notificationFrame = null;
        _applyState(JSON.parse(frame));
      }
    } catch (err) {
      _notificationFrame = null;
      _markDataError(err);
    }
  }

  function _onDisconnected() {
    _rx = null;
    _tx = null;
    Object.keys(sensors).forEach(key => { sensors[key] = NaN; });
    _notificationFrame = null;
    _lastState = _emptyState();
    _setStatus('disconnected');
  }

  async function connect() {
    if (!navigator.bluetooth) {
      _lastError = 'Web Bluetooth не поддерживается этим браузером';
      _setStatus('error');
      throw new Error(_lastError);
    }
    if (_device?.gatt?.connected && _rx && _tx && _status === 'connected') return;
    if (_device?.gatt?.connected) _device.gatt.disconnect();

    _lastError = '';
    _notificationFrame = null;
    _lastState = _emptyState();
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
      const version = _stateVersion;
      await _tx.startNotifications();
      try {
        _applyState(JSON.parse(new TextDecoder().decode(await _tx.readValue())));
      } catch (_) {
        // A read can overlap a framed notification. Wait for a complete packet.
        await _waitForFreshState(version, state => state.valid);
      }
    } catch (err) {
      if (_device?.gatt?.connected) _device.gatt.disconnect();
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
    if (_rx.writeValueWithResponse) await _rx.writeValueWithResponse(bytes);
    else if (_rx.writeValueWithoutResponse) await _rx.writeValueWithoutResponse(bytes);
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
    if (_calibrationPending) throw new Error('Дождитесь завершения текущего шага калибровки');
    if (!_rx || !_device?.gatt?.connected) throw new Error('Сначала подключите перчатку по Bluetooth');
    if (!_lastState.valid || !Number.isInteger(_lastState.calibrationSeq)) {
      throw new Error('Обновите прошивку FlortteGlove: она должна подтверждать шаги калибровки');
    }
    const version = _stateVersion;
    const sequence = _lastState.calibrationSeq;
    const expectedStep = { start: 'prepare', bent: 'bent', open: 'done', cancel: 'idle' }[action];
    _calibrationPending = true;
    try {
      await _writeCommand(`calibrate:${action}`);
      if (_status !== 'connected') throw new Error('Соединение с перчаткой потеряно');
      const state = await _waitForFreshState(version, state =>
        state.calibrationSeq !== sequence && (state.calibrationStep === expectedStep || state.calibrationStep === 'error'));
      if (state.calibrationStep === 'error') {
        throw new Error('Поза не сохранена. Сначала сохраните сгиб, затем полностью выпрямите пальцы; проверьте датчики');
      }
      return state;
    } finally {
      _calibrationPending = false;
    }
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
