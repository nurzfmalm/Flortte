/** Calibration and per-finger thresholds shown on the Settings screen. */
const GloveSettings = (() => {
  const SENSOR_KEYS = ['keyPinch', 'indexThumb', 'middleThumb', 'ring', 'little'];
  const FINGER_NAMES = ['большой', 'указательный', 'средний', 'безымянный', 'мизинец'];
  const MAX_ADC = 4095;
  let _thresholdInputs = [];
  let _calibrationStatus;
  let _gloveStatus;
  let _calibrateButton;
  let _captureBentButton;
  let _captureOpenButton;
  let _cancelCalibrationButton;
  let _calibrationSteps = [];
  let _isCalibrating = false;
  let _pending = false;
  let _step = 'idle';
  let _lastStatus = 'disconnected';

  function _parseAdcValue(value) {
    const text = String(value ?? '').trim();
    if (!/^\d+$/.test(text)) return null;
    const numeric = Number(text);
    return Number.isInteger(numeric) && numeric >= 0 && numeric <= MAX_ADC ? numeric : null;
  }

  function _setCalibrationStatus(text, mode = '') {
    if (!_calibrationStatus) return;
    _calibrationStatus.textContent = text;
    _calibrationStatus.className = `calibration-status ${mode}`.trim();
  }

  function _setCalibrationSteps(mode) {
    const state = {
      idle: { done: [], active: ['prepare'] },
      bent: { done: [], active: ['prepare'] },
      open: { done: ['prepare'], active: ['move', 'tune'] },
      done: { done: ['prepare', 'move', 'tune'], active: [] },
      error: { done: [], active: ['prepare'] },
    }[mode] || { done: [], active: [] };
    _calibrationSteps.forEach((step) => {
      const key = step.dataset.step;
      step.classList.toggle('done', state.done.includes(key));
      step.classList.toggle('active', state.active.includes(key));
    });
  }

  function _showCalibrationAction(step) {
    _step = step;
    if (_captureBentButton) _captureBentButton.hidden = step !== 'bent';
    if (_captureOpenButton) _captureOpenButton.hidden = step !== 'open';
    if (_cancelCalibrationButton) _cancelCalibrationButton.hidden = step === 'idle';
    if (_calibrateButton) _calibrateButton.hidden = step !== 'idle';
    [_calibrateButton, _captureBentButton, _captureOpenButton, _cancelCalibrationButton].forEach(button => {
      if (button) button.disabled = _pending || ESP32.status !== 'connected';
    });
  }

  async function _sendCalibrationStep(action) {
    if (_pending || (action === 'start' && _step !== 'idle') ||
        (action === 'bent' && _step !== 'bent') || (action === 'open' && _step !== 'open')) return;
    _pending = true;
    _isCalibrating = true;
    const previousStep = _step;
    _showCalibrationAction(_step);
    _setCalibrationStatus('Перчатка сохраняет шаг. Удерживайте положение пальцев…', 'running');
    const messages = {
      start: 'Согните все подключенные пальцы до максимума.',
      bent: 'Сгиб сохранён. Теперь полностью выпрямите пальцы.',
      open: 'Калибровка завершена.',
      cancel: 'Калибровка отменена.',
    };
    try {
      const state = await ESP32.calibrate(action);
      if (action === 'start') {
        _setCalibrationSteps('bent');
        _showCalibrationAction('bent');
      } else if (action === 'bent') {
        _setCalibrationSteps('open');
        _showCalibrationAction('open');
      } else {
        _setCalibrationSteps(action === 'open' ? 'done' : 'idle');
        _showCalibrationAction('idle');
        _isCalibrating = false;
      }
      const disabled = SENSOR_KEYS.filter(key => state.enabled?.[key] === false);
      let warning = action === 'open' && disabled.length
        ? ` Не реагируют датчики: ${disabled.map(key => FINGER_NAMES[SENSOR_KEYS.indexOf(key)]).join(', ')}. Проверьте их и повторите калибровку.`
        : '';
      if (action === 'open' && state.calibrationSaved === false) {
        warning += ' Не удалось сохранить калибровку в памяти перчатки. После выключения её нужно будет повторить.';
      }
      _setCalibrationStatus(messages[action] + warning, warning ? 'error' : action === 'open' ? 'done' : action === 'cancel' ? '' : 'running');
    } catch (error) {
      const retryStep = ESP32.status === 'connected' ? previousStep : 'idle';
      _isCalibrating = retryStep !== 'idle';
      _showCalibrationAction(retryStep);
      _setCalibrationSteps(retryStep === 'idle' ? 'error' : retryStep);
      _setCalibrationStatus(`Шаг не выполнен: ${error.message}`, 'error');
    } finally {
      _pending = false;
      _showCalibrationAction(_step);
    }
  }

  function _syncThreshold(index) {
    const thresholds = Gestures.getThresholdPair(SENSOR_KEYS[index]);
    const inputs = _thresholdInputs[index];
    if (!inputs) return;
    if (inputs.bend) inputs.bend.value = thresholds.bend;
    if (inputs.release) inputs.release.value = thresholds.release;
    inputs.bend?.classList.remove('input-error');
    inputs.release?.classList.remove('input-error');
  }

  function _applyThreshold(index, type, syncAfter = false) {
    const input = _thresholdInputs[index]?.[type];
    if (!input) return;
    const numeric = _parseAdcValue(input.value);
    if (numeric === null) {
      input.classList.add('input-error');
      return;
    }
    Gestures.setThreshold(SENSOR_KEYS[index], type, numeric);
    input.classList.remove('input-error');
    if (Gestures.lastStorageError) {
      _setCalibrationStatus('Порог применён, но не сохранён. Освободите место в хранилище приложения.', 'error');
    }
    if (syncAfter) _syncThreshold(index);
  }

  function _onSensorData(_sensors, status, state) {
    if (state?.enabled && Object.keys(state.enabled).length) {
      Gestures.setEnabledFingers(state.enabled);
    } else if (status === 'disconnected') {
      Gestures.setEnabledFingers(Object.fromEntries(SENSOR_KEYS.map(key => [key, true])));
    }
    if (_gloveStatus) {
      _gloveStatus.textContent = status === 'connected'
        ? 'FlortteGlove подключена по Bluetooth'
        : status === 'connecting'
          ? 'Подключение Bluetooth…'
          : status === 'error'
            ? `Bluetooth: ${ESP32.lastError}`
            : 'Bluetooth не подключён';
    }
    if (status !== 'connected' && _isCalibrating && !_pending) {
      _isCalibrating = false;
      _showCalibrationAction('idle');
      _setCalibrationSteps('error');
      _setCalibrationStatus('Связь с перчаткой потеряна. Подключитесь и начните калибровку заново.', 'error');
    } else if (!_isCalibrating && status === 'connected' && _lastStatus !== 'connected') {
      _setCalibrationStatus('Перчатка подключена. Можно запускать калибровку.', 'done');
    }
    _lastStatus = status;
    _showCalibrationAction(_step);
  }

  function init() {
    _thresholdInputs = SENSOR_KEYS.map((_, index) => ({
      bend: document.getElementById(`threshold-bend-${index}`),
      release: document.getElementById(`threshold-release-${index}`),
    }));
    _calibrationStatus = document.getElementById('calibration-status');
    _gloveStatus = document.getElementById('settings-glove-status');
    _calibrateButton = document.getElementById('btn-calibrate');
    _captureBentButton = document.getElementById('btn-capture-bent');
    _captureOpenButton = document.getElementById('btn-capture-open');
    _cancelCalibrationButton = document.getElementById('btn-cancel-calibration');
    _calibrationSteps = Array.from(document.querySelectorAll('#calibration-steps li'));

    SENSOR_KEYS.forEach((_, index) => {
      _syncThreshold(index);
      ['bend', 'release'].forEach((type) => {
        const input = _thresholdInputs[index][type];
        input?.addEventListener('input', () => _applyThreshold(index, type));
        input?.addEventListener('change', () => _applyThreshold(index, type, true));
        input?.addEventListener('blur', () => {
          if (_parseAdcValue(input.value) === null) _syncThreshold(index);
          else _applyThreshold(index, type, true);
        });
      });
    });

    _calibrateButton?.addEventListener('click', () => _sendCalibrationStep('start'));
    _captureBentButton?.addEventListener('click', () => _sendCalibrationStep('bent'));
    _captureOpenButton?.addEventListener('click', () => _sendCalibrationStep('open'));
    _cancelCalibrationButton?.addEventListener('click', () => _sendCalibrationStep('cancel'));
    _showCalibrationAction('idle');
    _setCalibrationSteps('idle');
    ESP32.onData(_onSensorData);
    _onSensorData(ESP32.sensors, ESP32.status, ESP32.lastState);
  }

  return { init };
})();
