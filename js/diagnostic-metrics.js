/** Pure calculations used by the guided glove diagnostic. */
const DiagnosticMetrics = (() => {
  // Keep calculation modules usable independently of the browser interface.
  const _t = typeof I18n !== 'undefined' ? I18n.t : (message, ...values) =>
    typeof message === 'string' ? message : message.reduce((text, part, index) =>
      text + part + (index < values.length ? values[index] : ''), '');
  const MIN_SAMPLES = 20;
  const MIN_SPAN = 120;
  const MAX_OPEN_NOISE = 80;
  const MIN_INDEPENDENCE = 1.25;

  function stats(values = []) {
    const valid = values.map(Number).filter(Number.isFinite);
    if (!valid.length) return { count: 0, min: 0, max: 0, mean: 0, span: 0, stddev: 0 };

    const min = Math.min(...valid);
    const max = Math.max(...valid);
    const mean = valid.reduce((sum, value) => sum + value, 0) / valid.length;
    const variance = valid.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / valid.length;
    return { count: valid.length, min, max, mean, span: max - min, stddev: Math.sqrt(variance) };
  }

  function countBends(values, bend, release) {
    let active = false;
    let bends = 0;

    values.forEach((value) => {
      if (!active && value <= bend + 80) {
        active = true;
        bends++;
      } else if (active && value >= release) {
        active = false;
      }
    });

    return bends;
  }

  function check(id, label, passed, level, detail) {
    return { id, label, passed, level, detail };
  }

  function analyzeFinger({ openSamples, captureSamples, fingerIndex, thresholds }) {
    const ownOpen = stats(openSamples[fingerIndex]);
    const own = stats(captureSamples[fingerIndex]);
    const otherSpans = captureSamples
      .map((values, index) => index === fingerIndex ? 0 : stats(values).span);
    const largestOtherSpan = Math.max(0, ...otherSpans);
    const largestOtherIndex = otherSpans.indexOf(largestOtherSpan);
    const independence = own.span / Math.max(1, largestOtherSpan);
    const bends = countBends(captureSamples[fingerIndex], thresholds.bend, thresholds.release);
    const railSamples = captureSamples[fingerIndex]
      .filter(value => value <= 5 || value >= 4090).length;
    const railRatio = own.count ? railSamples / own.count : 0;
    const stuckAtRail = own.span < 40 && railRatio > 0.8;
    const bendReached = own.min <= thresholds.bend + 80;
    const releaseReached = own.max >= thresholds.release;
    const thresholdsValid = thresholds.release > thresholds.bend + 50;

    const checks = [
      check('stream', _t('Поток данных'), own.count >= MIN_SAMPLES, 'fail', _t`${own.count} отсчётов`),
      check('baseline', _t('Базовое открытое положение'), ownOpen.count >= 10, 'fail', _t`${ownOpen.count} отсчётов`),
      check('thresholds', _t('Порядок порогов'), thresholdsValid, 'fail', _t`сгиб ${thresholds.bend}, разгиб ${thresholds.release}`),
      check('range', _t('Диапазон движения'), own.span >= MIN_SPAN, 'fail', `${Math.round(own.span)} ADC`),
      check('bend', _t('Порог сгибания'), bendReached, 'fail', _t`минимум ${Math.round(own.min)}, порог ${thresholds.bend}`),
      check('release', _t('Возврат в прямое положение'), releaseReached, 'fail', _t`максимум ${Math.round(own.max)}, порог ${thresholds.release}`),
      check('rail', _t('Сенсор не завис на границе'), !stuckAtRail, 'fail', _t`${Math.round(railRatio * 100)}% крайних значений`),
      check('cycles', _t('Повторяемость'), bends >= 2, 'warn', _t`${bends} сгибаний`),
      check('noise', _t('Шум в открытом положении'), ownOpen.stddev <= MAX_OPEN_NOISE, 'warn', `σ ${ownOpen.stddev.toFixed(1)} ADC`),
      check('isolation', _t('Независимость от соседних пальцев'), independence >= MIN_INDEPENDENCE, 'warn', `${independence.toFixed(2)}×`),
    ];

    const failures = checks.filter(item => !item.passed && item.level === 'fail');
    const warnings = checks.filter(item => !item.passed && item.level === 'warn');
    const status = failures.length ? 'fail' : warnings.length ? 'warn' : 'pass';

    const recommendations = [];
    const failed = (id) => checks.some(item => item.id === id && !item.passed);
    if (failed('stream') || failed('baseline')) recommendations.push(_t('Проверьте Bluetooth, питание ESP32 и повторите тест без пауз в передаче данных.'));
    if (failed('thresholds')) recommendations.push(_t('В Настройках задайте порог разгибания минимум на 51 ADC выше порога сгибания.'));
    if (failed('range') || stuckAtRail) recommendations.push(_t('Проверьте пайку, резистор 10 кОм и провод этого сенсора.'));
    if (!bendReached || !releaseReached) recommendations.push(_t('Повторите калибровку и затем снова запустите тест.'));
    if (failed('cycles')) recommendations.push(_t('Повторите тест и согните палец минимум три раза.'));
    if (failed('noise')) recommendations.push(_t('Закрепите провод и добавьте фильтрацию питания возле ESP32.'));
    if (failed('isolation')) recommendations.push(_t('Двигайте только проверяемым пальцем или ослабьте крепление соседнего сенсора.'));
    if (!recommendations.length) recommendations.push(_t('Сенсор готов к игре.'));

    return {
      status,
      checks,
      recommendations,
      metrics: {
        samples: own.count,
        openMean: ownOpen.mean,
        openNoise: ownOpen.stddev,
        min: own.min,
        max: own.max,
        span: own.span,
        bends,
        bendThreshold: thresholds.bend,
        releaseThreshold: thresholds.release,
        railRatio,
        largestOtherSpan,
        largestOtherIndex,
        independence,
      },
    };
  }

  function overall(results = []) {
    if (!results.length || results.some(result => !result)) return 'idle';
    if (results.some(result => result.status === 'fail')) return 'fail';
    if (results.some(result => result.status === 'warn')) return 'warn';
    return 'pass';
  }

  return { stats, countBends, analyzeFinger, overall };
})();
