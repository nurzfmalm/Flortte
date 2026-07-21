/** Live graph and guided five-finger hardware diagnostic. */
const Diagnostics = (() => {
  const HISTORY_LEN = 200;
  const OPEN_CAPTURE_MS = 2500;
  const PREPARE_MS = 2000;
  const FINGER_CAPTURE_MS = 5000;
  const COLORS = ['#7c3aed', '#22d3a0', '#f59e0b', '#38bdf8', '#f472b6'];
  const SENSOR_KEYS = ['keyPinch', 'indexThumb', 'middleThumb', 'ring', 'little'];
  const SENSOR_LABELS = ['Большой', 'Указательный', 'Средний', 'Безымянный', 'Мизинец'];
  const MAX_ADC = 4095;

  const _history = SENSOR_KEYS.map(() => new Float32Array(HISTORY_LEN));
  let _histIdx = 0;
  let _canvas;
  let _ctx2d;
  let _active = false;
  let _raf = null;
  let _runId = 0;
  let _phase = { kind: 'idle', fingerIndex: -1 };
  let _openSamples = SENSOR_KEYS.map(() => []);
  let _captureSamples = SENSOR_KEYS.map(() => []);
  let _results = Array(SENSOR_KEYS.length).fill(null);
  let _dcv = [];
  let _dcf = [];
  let _dcg = [];
  let _ddGesture;
  let _ddNote;
  let _statusDot;
  let _instruction;
  let _overall;
  let _progress;
  let _resultsContainer;
  let _startButton;
  let _cancelButton;
  let _reconnectButton;
  let _playerResultOverall;
  let _playerResultEmpty;
  let _playerResultContent;
  let _playerResultSummary;
  let _playerFingerResults;

  function _grabDom() {
    _dcv = SENSOR_KEYS.map((_, index) => document.getElementById(`dcv-${index}`));
    _dcf = SENSOR_KEYS.map((_, index) => document.getElementById(`dcf-${index}`));
    _dcg = SENSOR_KEYS.map((_, index) => document.getElementById(`dcg-${index}`));
    _ddGesture = document.getElementById('dd-gesture');
    _ddNote = document.getElementById('dd-note');
    _statusDot = document.getElementById('diag-status-dot');
    _instruction = document.getElementById('diag-instruction');
    _overall = document.getElementById('diag-overall');
    _progress = document.getElementById('diag-progress');
    _resultsContainer = document.getElementById('diag-results');
    _startButton = document.getElementById('btn-diag-start');
    _cancelButton = document.getElementById('btn-diag-cancel');
    _reconnectButton = document.getElementById('btn-reconnect');
    _playerResultOverall = document.getElementById('player-result-overall');
    _playerResultEmpty = document.getElementById('player-result-empty');
    _playerResultContent = document.getElementById('player-result-content');
    _playerResultSummary = document.getElementById('player-result-summary');
    _playerFingerResults = document.getElementById('player-finger-results');
    _canvas = document.getElementById('diag-canvas');
    _ctx2d = _canvas?.getContext('2d');
  }

  function _resize() {
    if (!_canvas) return;
    const rect = _canvas.getBoundingClientRect();
    _canvas.width = rect.width * devicePixelRatio;
    _canvas.height = Math.round(180 * devicePixelRatio);
    _canvas.style.height = '180px';
  }

  function _setOverall(status, text) {
    if (!_overall) return;
    _overall.className = `diagnostic-overall ${status}`;
    _overall.textContent = text;
  }

  function _setRunning(running) {
    if (_startButton) {
      _startButton.disabled = running;
      _startButton.hidden = running;
    }
    if (_cancelButton) _cancelButton.hidden = !running;
  }

  function _progressStatus(index) {
    if (_phase.kind === 'open' && index === 0) return 'active';
    if (_phase.kind === 'prepare' && index === _phase.fingerIndex + 1) return 'active';
    if (_phase.kind === 'capture' && index === _phase.fingerIndex + 1) return 'active';
    if (index === 0 && _openSamples.some(values => values.length)) return 'pass';
    if (index > 0 && _results[index - 1]) return _results[index - 1].status;
    return 'pending';
  }

  function _renderProgress() {
    if (!_progress) return;
    const labels = ['Открытая ладонь', ...SENSOR_LABELS];
    _progress.replaceChildren();
    labels.forEach((label, index) => {
      const item = document.createElement('div');
      const status = _progressStatus(index);
      item.className = `diagnostic-step ${status}`;
      const marker = document.createElement('span');
      marker.className = 'diagnostic-step-marker';
      marker.textContent = status === 'pass' ? '✓' : status === 'warn' ? '!' : status === 'fail' ? '×' : String(index + 1);
      const text = document.createElement('span');
      text.textContent = label;
      item.append(marker, text);
      _progress.appendChild(item);
    });
  }

  function _formatNumber(value, digits = 0) {
    return Number.isFinite(value) ? value.toFixed(digits) : '—';
  }

  function _appendMetric(container, label, value) {
    const metric = document.createElement('div');
    metric.className = 'finger-metric';
    const name = document.createElement('span');
    name.textContent = label;
    const reading = document.createElement('strong');
    reading.textContent = value;
    metric.append(name, reading);
    container.appendChild(metric);
  }

  function _playerResultStatus(percent) {
    if (percent >= 80) return 'pass';
    if (percent >= 50) return 'warn';
    return 'fail';
  }

  function _appendPlayerSummary(label, value) {
    const item = document.createElement('div');
    item.className = 'player-summary-item';
    const name = document.createElement('span');
    name.textContent = label;
    const reading = document.createElement('strong');
    reading.textContent = value;
    item.append(name, reading);
    _playerResultSummary?.appendChild(item);
  }

  function _formatMilliseconds(value) {
    return value !== null && value !== undefined && Number.isFinite(Number(value))
      ? `${Number(value).toFixed(1)} мс`
      : 'Нет данных';
  }

  function _timingProgress(result, history) {
    const currentValue = result?.timing?.meanErrorMs;
    if (currentValue === null || currentValue === undefined || !Number.isFinite(Number(currentValue))) return null;
    const currentMean = Number(currentValue);

    const comparable = history.filter(item => (
      item !== result
      && item?.songName === result.songName
      && item?.timing?.meanErrorMs !== null
      && item?.timing?.meanErrorMs !== undefined
      && Number.isFinite(Number(item.timing.meanErrorMs))
    ));
    if (!comparable.length) return null;

    const baseline = comparable[comparable.length - 1];
    const baselineMean = Number(baseline.timing.meanErrorMs);
    return {
      baselineMean,
      currentMean,
      delta: currentMean - baselineMean,
      completedAt: baseline.completedAt,
    };
  }

  function _renderPlayerResults() {
    const history = GameResults.loadHistory();
    const result = history[0] || null;
    if (!result) {
      if (_playerResultOverall) {
        _playerResultOverall.className = 'diagnostic-overall idle';
        _playerResultOverall.textContent = 'Нет результата';
      }
      if (_playerResultEmpty) _playerResultEmpty.hidden = false;
      if (_playerResultContent) _playerResultContent.hidden = true;
      return;
    }

    const status = _playerResultStatus(result.successPercent);
    if (_playerResultOverall) {
      _playerResultOverall.className = `diagnostic-overall ${status}`;
      _playerResultOverall.textContent = `${result.successPercent}% успеха`;
    }
    if (_playerResultEmpty) _playerResultEmpty.hidden = true;
    if (_playerResultContent) _playerResultContent.hidden = false;

    _playerResultSummary?.replaceChildren();
    _appendPlayerSummary('Игра', result.songName);
    _appendPlayerSummary('Счёт', Number(result.score || 0).toLocaleString('ru-RU'));
    _appendPlayerSummary('Попадания', `${result.hits} из ${result.totalNotes}`);
    _appendPlayerSummary('Промахи', String(result.misses));
    _appendPlayerSummary('Лучшая серия', String(result.maxCombo));
    _appendPlayerSummary('Средняя ошибка (MTE)', _formatMilliseconds(result.timing?.meanErrorMs));
    _appendPlayerSummary('Вариативность (SD)', _formatMilliseconds(result.timing?.variabilityMs));

    const progress = _timingProgress(result, history);
    if (progress) {
      const direction = progress.delta < 0 ? 'лучше' : progress.delta > 0 ? 'хуже' : 'без изменений';
      const change = Math.abs(progress.delta).toFixed(1);
      const date = new Date(progress.completedAt).toLocaleDateString('ru-RU');
      _appendPlayerSummary(
        'Прогресс MTE',
        `${progress.baselineMean.toFixed(1)} → ${progress.currentMean.toFixed(1)} мс, ${change} мс ${direction} с ${date}`
      );
    }
    _appendPlayerSummary('Завершено', new Date(result.completedAt).toLocaleString('ru-RU'));

    _playerFingerResults?.replaceChildren();
    (result.fingers || []).forEach((finger, index) => {
      const card = document.createElement('article');
      const fingerStatus = finger.successPercent === null ? 'idle' : _playerResultStatus(finger.successPercent);
      card.className = `player-finger-result ${fingerStatus}`;

      const heading = document.createElement('div');
      heading.className = 'player-finger-heading';
      const name = document.createElement('strong');
      name.textContent = finger.name || SENSOR_LABELS[index];
      const percent = document.createElement('span');
      percent.textContent = finger.successPercent === null ? 'Нет нот' : `${finger.successPercent}%`;
      heading.append(name, percent);

      const progress = document.createElement('div');
      progress.className = 'player-finger-progress';
      const fill = document.createElement('div');
      fill.style.width = `${finger.successPercent || 0}%`;
      progress.appendChild(fill);

      const details = document.createElement('span');
      details.className = 'player-finger-details';
      details.textContent = `${finger.hits} из ${finger.attempts} успешных нот`;
      const timing = document.createElement('span');
      timing.className = 'player-finger-details player-finger-timing';
      timing.textContent = finger.timing?.samples
        ? `MTE ${_formatMilliseconds(finger.timing.meanErrorMs)}, SD ${_formatMilliseconds(finger.timing.variabilityMs)}`
        : 'Нет данных о тайминге';
      card.append(heading, progress, details, timing);
      _playerFingerResults?.appendChild(card);
    });
  }

  function _renderResult(result, fingerIndex) {
    const card = document.createElement('article');
    card.className = `finger-result ${result.status}`;

    const header = document.createElement('div');
    header.className = 'finger-result-header';
    const title = document.createElement('h3');
    title.textContent = SENSOR_LABELS[fingerIndex];
    const badge = document.createElement('span');
    badge.className = `finger-status ${result.status}`;
    badge.textContent = result.status === 'pass' ? 'Исправен' : result.status === 'warn' ? 'Есть замечания' : 'Ошибка';
    header.append(title, badge);

    const summary = document.createElement('p');
    summary.className = 'finger-summary';
    summary.textContent = result.status === 'pass'
      ? 'Сенсор уверенно распознаёт сгибание и возврат.'
      : result.status === 'warn'
        ? 'Играть можно, но точность или независимость пальца ниже нормы.'
        : 'Сенсор не прошёл одну или несколько обязательных проверок.';

    const metrics = document.createElement('div');
    metrics.className = 'finger-metrics';
    _appendMetric(metrics, 'Отсчёты', String(result.metrics.samples));
    _appendMetric(metrics, 'Открытая рука', `${_formatNumber(result.metrics.openMean)} ± ${_formatNumber(result.metrics.openNoise, 1)} ADC`);
    _appendMetric(metrics, 'Мин. / макс.', `${_formatNumber(result.metrics.min)} / ${_formatNumber(result.metrics.max)}`);
    _appendMetric(metrics, 'Диапазон', `${_formatNumber(result.metrics.span)} ADC`);
    _appendMetric(metrics, 'Пороги сгиб / разгиб', `${result.metrics.bendThreshold} / ${result.metrics.releaseThreshold}`);
    _appendMetric(metrics, 'Сгибания', String(result.metrics.bends));
    _appendMetric(metrics, 'Крайние значения', `${_formatNumber(result.metrics.railRatio * 100, 1)}%`);
    const neighbor = result.metrics.largestOtherIndex >= 0
      ? SENSOR_LABELS[result.metrics.largestOtherIndex].toLowerCase()
      : 'нет';
    _appendMetric(metrics, 'Самый активный сосед', `${neighbor}: ${_formatNumber(result.metrics.largestOtherSpan)} ADC`);
    _appendMetric(metrics, 'Независимость', `${_formatNumber(result.metrics.independence, 2)}×`);

    const checks = document.createElement('div');
    checks.className = 'check-list';
    result.checks.forEach((check) => {
      const row = document.createElement('div');
      const status = check.passed ? 'pass' : check.level;
      row.className = `check-item ${status}`;
      const marker = document.createElement('span');
      marker.textContent = check.passed ? '✓' : check.level === 'warn' ? '!' : '×';
      const label = document.createElement('strong');
      label.textContent = check.label;
      const detail = document.createElement('span');
      detail.textContent = check.detail;
      row.append(marker, label, detail);
      checks.appendChild(row);
    });

    const recommendations = document.createElement('div');
    recommendations.className = 'recommendations';
    const recommendationTitle = document.createElement('strong');
    recommendationTitle.textContent = result.status === 'pass' ? 'Итог' : 'Что сделать';
    const list = document.createElement('ul');
    result.recommendations.forEach((text) => {
      const item = document.createElement('li');
      item.textContent = text;
      list.appendChild(item);
    });
    recommendations.append(recommendationTitle, list);

    card.append(header, summary, metrics, checks, recommendations);
    return card;
  }

  function _renderResults() {
    if (!_resultsContainer) return;
    _resultsContainer.replaceChildren();
    _results.forEach((result, index) => {
      if (result) _resultsContainer.appendChild(_renderResult(result, index));
    });
  }

  function _storeSample(sensors) {
    if (!['open', 'capture'].includes(_phase.kind)) return;
    const destination = _phase.kind === 'open' ? _openSamples : _captureSamples;
    SENSOR_KEYS.forEach((key, index) => destination[index].push(Number(sensors[key])));
  }

  function _onSensorData(sensors, status) {
    if (status !== 'connected' && ['open', 'prepare', 'capture'].includes(_phase.kind)) {
      _stopTest('Соединение с перчаткой потеряно. Подключите Bluetooth и запустите проверку заново.', true);
    }
    if (status === 'connected') _storeSample(sensors);
    if (!_active) return;

    SENSOR_KEYS.forEach((key, index) => {
      const value = Number(sensors[key]);
      _history[index][_histIdx] = value;
      if (_dcv[index]) _dcv[index].textContent = Math.round(value);
      if (_dcf[index]) _dcf[index].style.width = `${(value / MAX_ADC * 100).toFixed(1)}%`;
    });
    _histIdx = (_histIdx + 1) % HISTORY_LEN;

    const result = Gestures.classify(sensors);
    if (_ddGesture) _ddGesture.textContent = `${result.gesture.emoji}  ${result.gesture.name}`;
    if (_ddNote) _ddNote.textContent = result.note !== null ? `♩ ${result.noteName} (${result.note})` : '';
    SENSOR_KEYS.forEach((_, index) => {
      const active = Boolean(result.bits[index]);
      if (!_dcg[index]) return;
      _dcg[index].textContent = active ? '● АКТИВЕН' : '';
      _dcg[index].style.color = active ? COLORS[index] : '';
    });
    if (_statusDot) _statusDot.classList.toggle('on', status === 'connected');
  }

  function _drawGraph() {
    if (!_ctx2d || !_active) return;
    const width = _canvas.width;
    const height = _canvas.height;
    const dpr = devicePixelRatio;
    _ctx2d.clearRect(0, 0, width, height);
    _ctx2d.strokeStyle = '#dbe3f5';
    _ctx2d.lineWidth = 1;
    for (let grid = 0; grid <= 4; grid++) {
      const y = height * (1 - grid / 4);
      _ctx2d.beginPath();
      _ctx2d.moveTo(0, y);
      _ctx2d.lineTo(width, y);
      _ctx2d.stroke();
      _ctx2d.fillStyle = '#77839b';
      _ctx2d.font = `${10 * dpr}px Consolas, "Courier New", monospace`;
      _ctx2d.fillText(Math.round((grid / 4) * MAX_ADC), 4 * dpr, y - 3 * dpr);
    }
    for (let sensor = 0; sensor < SENSOR_KEYS.length; sensor++) {
      _ctx2d.strokeStyle = COLORS[sensor];
      _ctx2d.lineWidth = 2 * dpr;
      _ctx2d.beginPath();
      for (let index = 0; index < HISTORY_LEN; index++) {
        const ringIndex = (_histIdx + index) % HISTORY_LEN;
        const x = index / (HISTORY_LEN - 1) * width;
        const y = height * (1 - _history[sensor][ringIndex] / MAX_ADC);
        if (index === 0) _ctx2d.moveTo(x, y);
        else _ctx2d.lineTo(x, y);
      }
      _ctx2d.stroke();
    }
    let legendX = 8 * dpr;
    _ctx2d.font = `${9 * dpr}px Consolas, "Courier New", monospace`;
    SENSOR_LABELS.forEach((label, index) => {
      _ctx2d.fillStyle = COLORS[index];
      _ctx2d.fillRect(legendX, 6 * dpr, 16 * dpr, 2 * dpr);
      _ctx2d.fillText(label.toUpperCase(), legendX + 22 * dpr, 12 * dpr);
      legendX += (label.length * 6 + 34) * dpr;
    });
  }

  function _rafLoop() {
    _drawGraph();
    if (_active) _raf = requestAnimationFrame(_rafLoop);
  }

  function _wait(milliseconds, runId) {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const update = () => {
        if (runId !== _runId) return resolve(false);
        const remaining = Math.max(0, milliseconds - (Date.now() - startedAt));
        if (_instruction) _instruction.dataset.seconds = String(Math.ceil(remaining / 1000));
        if (remaining === 0) return resolve(true);
        setTimeout(update, Math.min(250, remaining));
      };
      update();
    });
  }

  async function _runTimedPhase(kind, fingerIndex, milliseconds, message, runId) {
    _phase = { kind, fingerIndex };
    if (_instruction) {
      _instruction.textContent = message;
      _instruction.className = 'diagnostic-instruction running';
    }
    _renderProgress();
    return _wait(milliseconds, runId);
  }

  function _finishTest() {
    _phase = { kind: 'done', fingerIndex: -1 };
    _setRunning(false);
    _renderProgress();
    const status = DiagnosticMetrics.overall(_results);
    const messages = {
      pass: 'Все 5 пальцев исправны',
      warn: 'Работает, есть замечания',
      fail: 'Обнаружена ошибка',
    };
    _setOverall(status, messages[status]);
    if (_instruction) {
      _instruction.className = `diagnostic-instruction ${status}`;
      _instruction.textContent = status === 'pass'
        ? 'Проверка завершена. Перчатка готова к игре.'
        : 'Проверка завершена. Откройте результат каждого пальца ниже и выполните рекомендации.';
      delete _instruction.dataset.seconds;
    }
  }

  function _stopTest(message = 'Проверка остановлена.', failed = false) {
    if (!['open', 'prepare', 'capture'].includes(_phase.kind)) return;
    _runId++;
    _phase = { kind: 'stopped', fingerIndex: -1 };
    _setRunning(false);
    _setOverall(failed ? 'fail' : 'idle', failed ? 'Проверка прервана' : 'Проверка остановлена');
    if (_instruction) {
      _instruction.className = `diagnostic-instruction ${failed ? 'fail' : ''}`.trim();
      _instruction.textContent = message;
      delete _instruction.dataset.seconds;
    }
    _renderProgress();
  }

  async function _startTest() {
    if (ESP32.status !== 'connected') {
      _setOverall('fail', 'Нет подключения');
      if (_instruction) {
        _instruction.className = 'diagnostic-instruction fail';
        _instruction.textContent = 'Сначала подключите FlortteGlove по Bluetooth. Без реальных данных тест не запускается.';
      }
      return;
    }

    const runId = ++_runId;
    _openSamples = SENSOR_KEYS.map(() => []);
    _captureSamples = SENSOR_KEYS.map(() => []);
    _results = Array(SENSOR_KEYS.length).fill(null);
    _resultsContainer?.replaceChildren();
    _setRunning(true);
    _setOverall('running', 'Проверка идёт');

    let continued = await _runTimedPhase(
      'open', -1, OPEN_CAPTURE_MS,
      'Полностью выпрямите все пальцы и держите ладонь неподвижно.', runId
    );
    if (!continued) return;

    for (let fingerIndex = 0; fingerIndex < SENSOR_KEYS.length; fingerIndex++) {
      continued = await _runTimedPhase(
        'prepare', fingerIndex, PREPARE_MS,
        `Приготовьтесь проверить ${SENSOR_LABELS[fingerIndex].toLowerCase()} палец. Остальные пальцы держите прямо.`, runId
      );
      if (!continued) return;

      _captureSamples = SENSOR_KEYS.map(() => []);
      continued = await _runTimedPhase(
        'capture', fingerIndex, FINGER_CAPTURE_MS,
        `Согните и полностью разогните ${SENSOR_LABELS[fingerIndex].toLowerCase()} палец минимум 3 раза. Остальные не двигайте.`, runId
      );
      if (!continued) return;

      _results[fingerIndex] = DiagnosticMetrics.analyzeFinger({
        openSamples: _openSamples,
        captureSamples: _captureSamples,
        fingerIndex,
        thresholds: Gestures.getThresholdPair(SENSOR_KEYS[fingerIndex]),
      });
      _renderResults();
      _renderProgress();
    }
    if (runId === _runId) _finishTest();
  }

  function _bindControls() {
    _startButton?.addEventListener('click', _startTest);
    _cancelButton?.addEventListener('click', () => _stopTest());
    _reconnectButton?.addEventListener('click', async () => {
      _reconnectButton.disabled = true;
      try {
        await ESP32.connect();
        _instruction.textContent = 'Перчатка подключена. Нажмите «Начать проверку».';
        _instruction.className = 'diagnostic-instruction pass';
      } catch (error) {
        _instruction.textContent = `Bluetooth: ${ESP32.lastError || error.message}`;
        _instruction.className = 'diagnostic-instruction fail';
      } finally {
        _reconnectButton.disabled = false;
      }
    });
  }

  function init() {
    _grabDom();
    _resize();
    _renderProgress();
    window.addEventListener('resize', _resize);
    ESP32.onData(_onSensorData);
    _bindControls();
  }

  function enter() {
    _active = true;
    _renderPlayerResults();
    _resize();
    _rafLoop();
  }

  function leave() {
    _active = false;
    cancelAnimationFrame(_raf);
    _raf = null;
    _stopTest('Проверка остановлена при выходе из диагностики.');
  }

  return { init, enter, leave };
})();
