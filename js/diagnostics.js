/**
 * diagnostics.js — Real-time sensor graph + status display
 *
 * Called by app.js:
 *   Diagnostics.init()    — one-time setup
 *   Diagnostics.enter()   — screen became active
 *   Diagnostics.leave()   — screen hidden
 */

const Diagnostics = (() => {
  const HISTORY_LEN = 200;   // samples kept in ring buffer
  const COLORS = ['#7c3aed', '#22d3a0', '#f59e0b'];
  const SENSOR_KEYS = ['keyPinch', 'indexThumb', 'middleThumb'];
  const SENSOR_LABELS = ['БОЛЬШОЙ', 'УКАЗАТЕЛЬНЫЙ', 'СРЕДНИЙ'];
  const MAX_ADC = 4095;

  let _canvas, _ctx2d;
  let _active = false;
  let _raf    = null;

  // Ring buffers
  const _history = [
    new Float32Array(HISTORY_LEN),
    new Float32Array(HISTORY_LEN),
    new Float32Array(HISTORY_LEN),
  ];
  let _histIdx = 0;

  // DOM refs (lazily grabbed)
  let _dcv   = [];   // .dc-value spans
  let _dcf   = [];   // .dc-fill divs
  let _dcg   = [];   // .dc-gesture spans
  let _thresholdInputs = [1000, 1000, 1000];
  let _ddGesture, _ddNote, _statusDot;
  let _calibrationStatus, _calibrateButton, _applyCalibrationButton;
  let _captureBentButton, _captureOpenButton, _cancelCalibrationButton;
  let _calibrationSteps = [];
  let _calibrationInputs = [];
  let _isCalibrating = false;
  let _calibrationDirty = false;

  function _grabDom() {
    _dcv  = [document.getElementById('dcv-0'), document.getElementById('dcv-1'), document.getElementById('dcv-2')];
    _dcf  = [document.getElementById('dcf-0'), document.getElementById('dcf-1'), document.getElementById('dcf-2')];
    _dcg  = [document.getElementById('dcg-0'), document.getElementById('dcg-1'), document.getElementById('dcg-2')];
    _thresholdInputs = [
      { bend: document.getElementById('threshold-bend-0'), release: document.getElementById('threshold-release-0') },
      { bend: document.getElementById('threshold-bend-1'), release: document.getElementById('threshold-release-1') },
      { bend: document.getElementById('threshold-bend-2'), release: document.getElementById('threshold-release-2') },
    ];
    _calibrationInputs = [
      { open: document.getElementById('cal-open-0'), bent: document.getElementById('cal-bent-0') },
      { open: document.getElementById('cal-open-1'), bent: document.getElementById('cal-bent-1') },
      { open: document.getElementById('cal-open-2'), bent: document.getElementById('cal-bent-2') },
    ];
    _calibrationStatus = document.getElementById('calibration-status');
    _calibrateButton = document.getElementById('btn-calibrate');
    _applyCalibrationButton = document.getElementById('btn-apply-calibration');
    _captureBentButton = document.getElementById('btn-capture-bent');
    _captureOpenButton = document.getElementById('btn-capture-open');
    _cancelCalibrationButton = document.getElementById('btn-cancel-calibration');
    _calibrationSteps = Array.from(document.querySelectorAll('#calibration-steps li'));
    _ddGesture  = document.getElementById('dd-gesture');
    _ddNote     = document.getElementById('dd-note');
    _statusDot  = document.getElementById('diag-status-dot');
    _canvas     = document.getElementById('diag-canvas');
    _ctx2d      = _canvas.getContext('2d');
  }

  function _resize() {
    if (!_canvas) return;
    const rect = _canvas.getBoundingClientRect();
    _canvas.width  = rect.width  * devicePixelRatio;
    _canvas.height = Math.round(180 * devicePixelRatio);
    _canvas.style.height = '180px';
  }

  function _parseAdcValue(value) {
    const text = String(value ?? '').trim();
    if (!/^\d+$/.test(text)) return null;
    const numeric = Number(text);
    if (!Number.isInteger(numeric) || numeric < 0 || numeric > MAX_ADC) return null;
    return numeric;
  }

  function _markInput(input, valid) {
    if (input) input.classList.toggle('input-error', !valid);
  }

  function _isCalibrationDisabled(values) {
    return values?.enabled === false;
  }

  function _setCalibrationStatus(text, mode = '') {
    if (!_calibrationStatus) return;
    _calibrationStatus.textContent = text;
    _calibrationStatus.className = `calibration-status ${mode}`.trim();
  }

  function _setCalibrationSteps(mode) {
    const state = {
      idle: { done: [], active: ['prepare'] },
      running: { done: ['prepare'], active: ['move'] },
      done: { done: ['prepare', 'move'], active: ['tune'] },
      error: { done: [], active: ['prepare'] },
    }[mode] || { done: [], active: [] };

    _calibrationSteps.forEach((step) => {
      const key = step.dataset.step;
      step.classList.toggle('done', state.done.includes(key));
      step.classList.toggle('active', state.active.includes(key));
    });
  }

  function _syncCalibrationInputs(state = ESP32.lastState, options = {}) {
    const calibration = state?.calibration || {};
    if (_calibrationDirty && !options.force) return;

    SENSOR_KEYS.forEach((key, index) => {
      const values = calibration[key];
      const inputs = _calibrationInputs[index];
      if (!values || !inputs) return;
      const disabled = _isCalibrationDisabled(values);

      if (inputs.open && (options.force || document.activeElement !== inputs.open)) {
        inputs.open.value = !disabled && Number.isFinite(Number(values.open)) ? values.open : '—';
        _markInput(inputs.open, true);
      }
      if (inputs.bent && (options.force || document.activeElement !== inputs.bent)) {
        inputs.bent.value = !disabled && Number.isFinite(Number(values.bent)) ? values.bent : '—';
        _markInput(inputs.bent, true);
      }
    });
  }

  // ── Sensor update ─────────────────────────────────────────
  function _onSensorData(sensors, status, state) {
    if (!_active) return;

    // Update history ring
    _history[0][_histIdx] = sensors.keyPinch;
    _history[1][_histIdx] = sensors.indexThumb;
    _history[2][_histIdx] = sensors.middleThumb;
    _histIdx = (_histIdx + 1) % HISTORY_LEN;

    // Update cards
    SENSOR_KEYS.forEach((key, i) => {
      const val = sensors[key];
      const pct = (val / MAX_ADC * 100).toFixed(1);
      _dcv[i].textContent = Math.round(val);
      _dcf[i].style.width = pct + '%';
    });

    // Gesture detection
    const result = Gestures.classify(sensors);
    _ddGesture.textContent = `${result.gesture.emoji}  ${result.gesture.name}`;
    _ddNote.textContent    = result.note !== null ? `♩ ${result.noteName} (${result.note})` : '';

    // Per-sensor "active" labels
    SENSOR_KEYS.forEach((key, i) => {
      const active = !!result.bits[i];
      const disabled = _isCalibrationDisabled(state?.calibration?.[key]);
      _dcg[i].textContent = disabled ? 'не подключен' : active ? '● АКТИВЕН' : '';
      _dcg[i].style.color = disabled ? '#6b7280' : active ? COLORS[i] : '';
    });

    // Connection dot
    if (_statusDot) {
      _statusDot.classList.toggle('on', status === 'connected');
    }

    if (state?.calibration) {
      _syncCalibrationInputs(state);
    }
    if (!_isCalibrating && !_calibrationDirty) {
      if (status === 'connected' && state?.calibration) {
        _setCalibrationStatus('Калибровка получена от ESP32', 'done');
      } else if (status === 'error') {
        _setCalibrationStatus('ESP32 недоступна. Проверьте IP/Wi-Fi.', 'error');
      }
    }
  }

  // ── Canvas draw ───────────────────────────────────────────
  function _drawGraph() {
    if (!_ctx2d || !_active) return;

    const W = _canvas.width;
    const H = _canvas.height;
    const dpr = devicePixelRatio;

    _ctx2d.clearRect(0, 0, W, H);

    // Background grid
    _ctx2d.strokeStyle = '#252b3d';
    _ctx2d.lineWidth   = 1;
    for (let g = 0; g <= 4; g++) {
      const y = H * (1 - g / 4);
      _ctx2d.beginPath();
      _ctx2d.moveTo(0, y); _ctx2d.lineTo(W, y);
      _ctx2d.stroke();
      // Label
      _ctx2d.fillStyle = '#4a5068';
      _ctx2d.font = `${10 * dpr}px Consolas, "Courier New", monospace`;
      _ctx2d.fillText(Math.round((g / 4) * MAX_ADC), 4 * dpr, y - 3 * dpr);
    }

    // Per-sensor threshold lines
    SENSOR_KEYS.forEach((key, i) => {
      const thresholds = Gestures.getThresholdPair(key);
      const bendY = H * (1 - thresholds.bend / MAX_ADC);
      const releaseY = H * (1 - thresholds.release / MAX_ADC);

      _ctx2d.strokeStyle = COLORS[i] + '88';
      _ctx2d.setLineDash([]);
      _ctx2d.lineWidth = 1.5;
      _ctx2d.beginPath();
      _ctx2d.moveTo(0, bendY);
      _ctx2d.lineTo(W, bendY);
      _ctx2d.stroke();
      _ctx2d.fillStyle = COLORS[i];
      _ctx2d.font = `${9 * dpr}px Consolas, "Courier New", monospace`;
      _ctx2d.fillText(`сг ${thresholds.bend}`, W - 56 * dpr, bendY - 3 * dpr);

      _ctx2d.strokeStyle = COLORS[i] + '55';
      _ctx2d.setLineDash([6 * dpr, 4 * dpr]);
      _ctx2d.beginPath();
      _ctx2d.moveTo(0, releaseY);
      _ctx2d.lineTo(W, releaseY);
      _ctx2d.stroke();
      _ctx2d.setLineDash([]);
      _ctx2d.fillText(`раз ${thresholds.release}`, W - 64 * dpr, releaseY - 3 * dpr);
    });

    // Draw sensor lines
    for (let s = 0; s < 3; s++) {
      _ctx2d.strokeStyle = COLORS[s];
      _ctx2d.lineWidth   = 2 * dpr;
      _ctx2d.shadowColor = COLORS[s];
      _ctx2d.shadowBlur  = 4 * dpr;
      _ctx2d.beginPath();

      for (let i = 0; i < HISTORY_LEN; i++) {
        const idx = (_histIdx + i) % HISTORY_LEN;
        const x = (i / (HISTORY_LEN - 1)) * W;
        const y = H * (1 - _history[s][idx] / MAX_ADC);
        if (i === 0) _ctx2d.moveTo(x, y);
        else         _ctx2d.lineTo(x, y);
      }
      _ctx2d.stroke();
      _ctx2d.shadowBlur = 0;
    }

    // Legend
    let lx = 8 * dpr;
    _ctx2d.font = `${9 * dpr}px Consolas, "Courier New", monospace`;
    for (let s = 0; s < 3; s++) {
      _ctx2d.fillStyle = COLORS[s];
      _ctx2d.fillRect(lx, 6 * dpr, 16 * dpr, 2 * dpr);
      _ctx2d.fillText(SENSOR_LABELS[s], lx + 22 * dpr, 12 * dpr);
      lx += (SENSOR_LABELS[s].length * 6 + 34) * dpr;
    }
  }

  function _rafLoop() {
    _drawGraph();
    if (_active) _raf = requestAnimationFrame(_rafLoop);
  }

  function _showCalibrationAction(step) {
    if (_captureBentButton) _captureBentButton.hidden = step !== 'bent';
    if (_captureOpenButton) _captureOpenButton.hidden = step !== 'open';
    if (_cancelCalibrationButton) _cancelCalibrationButton.hidden = step === 'idle';
    if (_calibrateButton) _calibrateButton.hidden = step !== 'idle';
  }

  async function _sendCalibrationStep(action) {
    if (_isCalibrating && action === 'start') return;
    _isCalibrating = true;
    _calibrationDirty = false;

    const copy = {
      start: 'Согните все подключенные пальцы до максимума.',
      bent: 'Сгиб сохранён. Теперь полностью выпрямите пальцы.',
      open: 'Калибровка завершена.',
      cancel: 'Калибровка отменена.',
    };

    try {
      const state = await ESP32.calibrate(action);
      _syncCalibrationInputs(state, { force: true });

      if (action === 'start') {
        _setCalibrationSteps('running');
        _showCalibrationAction('bent');
      } else if (action === 'bent') {
        _setCalibrationSteps('running');
        _showCalibrationAction('open');
      } else {
        _setCalibrationSteps(action === 'open' ? 'done' : 'idle');
        _showCalibrationAction('idle');
        _isCalibrating = false;
      }

      _setCalibrationStatus(copy[action], action === 'open' ? 'done' : 'running');
    } catch (err) {
      _isCalibrating = false;
      _showCalibrationAction('idle');
      _setCalibrationSteps('error');
      _setCalibrationStatus(`Шаг не выполнен: ${err.message}`, 'error');
    }
  }

  async function _runCalibration() {
    await _sendCalibrationStep('start');
  }

  async function _applyCalibrationInputs() {
    const calibration = {};
    let valid = true;

    SENSOR_KEYS.forEach((key, index) => {
      const inputs = _calibrationInputs[index];
      if (!inputs) return;

      const open = _parseAdcValue(inputs.open?.value);
      const bent = _parseAdcValue(inputs.bent?.value);
      const pairSkipped = open === null && bent === null;
      const pairValid = pairSkipped || (open !== null && bent !== null && Math.abs(open - bent) >= 20);

      _markInput(inputs.open, pairValid);
      _markInput(inputs.bent, pairValid);
      if (!pairValid) valid = false;
      if (pairSkipped) return;
      calibration[key] = { open, bent };
    });

    if (!valid) {
      _setCalibrationStatus('Проверьте значения: заполните обе ячейки пальца или оставьте обе пустыми; заполненная пара должна отличаться минимум на 20.', 'error');
      return;
    }

    if (_applyCalibrationButton) _applyCalibrationButton.disabled = true;
    _setCalibrationStatus('Отправляю значения на ESP32…', 'running');

    try {
      const state = await ESP32.setCalibration(calibration);
      _calibrationDirty = false;
      _syncCalibrationInputs(state, { force: true });
      _setCalibrationSteps('done');
      _setCalibrationStatus('Значения применены. Пороги ниже можно менять отдельно.', 'done');
    } catch (err) {
      _setCalibrationStatus(`Не удалось применить значения: ${err.message}`, 'error');
    } finally {
      if (_applyCalibrationButton) _applyCalibrationButton.disabled = false;
    }
  }

  // ── Threshold text inputs ──────────────────────────────────
  function _bindControls() {
    const syncThresholdControls = (index) => {
      const key = SENSOR_KEYS[index];
      const thresholds = Gestures.getThresholdPair(key);
      const inputs = _thresholdInputs[index];
      if (!inputs) return;

      if (inputs.bend) inputs.bend.value = thresholds.bend;
      if (inputs.release) inputs.release.value = thresholds.release;
      _markInput(inputs.bend, true);
      _markInput(inputs.release, true);
    };

    const applyThresholdInput = (index, type, syncAfter = false) => {
      const key = SENSOR_KEYS[index];
      const input = _thresholdInputs[index]?.[type];
      if (!input) return;

      const numeric = _parseAdcValue(input.value);
      if (numeric === null) {
        _markInput(input, false);
        return;
      }

      Gestures.setThreshold(key, type, numeric);
      _markInput(input, true);
      if (syncAfter) syncThresholdControls(index);
    };

    SENSOR_KEYS.forEach((key, i) => {
      syncThresholdControls(i);

      ['bend', 'release'].forEach((type) => {
        const input = _thresholdInputs[i]?.[type];
        if (!input) return;
        input.addEventListener('input', () => applyThresholdInput(i, type, false));
        input.addEventListener('change', () => applyThresholdInput(i, type, true));
        input.addEventListener('blur', () => {
          if (_parseAdcValue(input.value) === null) {
            syncThresholdControls(i);
            return;
          }
          applyThresholdInput(i, type, true);
        });
      });
    });

    _calibrationInputs.forEach((pair) => {
      ['open', 'bent'].forEach((type) => {
        const input = pair?.[type];
        if (!input) return;
        input.addEventListener('input', () => {
          _calibrationDirty = true;
          _markInput(input, _parseAdcValue(input.value) !== null);
          _setCalibrationStatus('Есть несохраненные изменения калибровки', 'running');
        });
      });
    });

    _calibrateButton?.addEventListener('click', _runCalibration);
    _captureBentButton?.addEventListener('click', () => _sendCalibrationStep('bent'));
    _captureOpenButton?.addEventListener('click', () => _sendCalibrationStep('open'));
    _cancelCalibrationButton?.addEventListener('click', () => _sendCalibrationStep('cancel'));
    _applyCalibrationButton?.addEventListener('click', _applyCalibrationInputs);

    const ipInput  = document.getElementById('esp-ip-input');
    const btnRecon = document.getElementById('btn-reconnect');
    if (ipInput) {
      ipInput.value = ESP32.ip;
      if (btnRecon) {
        btnRecon.addEventListener('click', () => ESP32.setIP(ipInput.value.trim()));
      }
    }

    _showCalibrationAction('idle');
    _setCalibrationSteps('idle');
    _syncCalibrationInputs(ESP32.lastState, { force: true });
  }

  // ── Public ────────────────────────────────────────────────
  function init() {
    _grabDom();
    _resize();
    window.addEventListener('resize', _resize);
    ESP32.onData(_onSensorData);
    _bindControls();
  }

  function enter() {
    _active = true;
    _resize();
    _rafLoop();
  }

  function leave() {
    _active = false;
    cancelAnimationFrame(_raf);
    _raf = null;
  }

  return { init, enter, leave };
})();
