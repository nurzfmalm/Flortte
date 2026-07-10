/**
 * esp32.js — Polling the ESP32 glove bridge
 *
 * Exports a singleton `ESP32` with:
 *   ESP32.start()          — begin polling
 *   ESP32.stop()           — stop polling
 *   ESP32.onData(fn)       — subscribe to sensor updates
 *   ESP32.offData(fn)      — unsubscribe
 *   ESP32.sensors          — latest smoothed values { keyPinch/thumb, indexThumb/index, middleThumb/middle }
 *   ESP32.status           — 'connecting' | 'connected' | 'error'
 *   ESP32.setIP(ip)        — change target IP
 *   ESP32.calibrate()      — run ESP32 calibration
 *   ESP32.setCalibration() — manually update raw open/bent calibration values
 *   ESP32.pollInterval     — ms between polls (settable)
 */

const ESP32 = (() => {
  const STATE_TIMEOUT_MS = 10000;
  const PROXY_BASE_PATH = '/esp32';
  const LOCAL_DEV_PROXY_BASE_URL = 'http://127.0.0.1:8000/esp32';
  const PROXY_TARGET = 'local-proxy';
  const DEFAULT_ESP_PORT = 8080;
  const DIRECT_AP_IP = '192.168.4.1:8080';
  const DIRECT_AP_IP_PORTLESS = '192.168.4.1';
  let _proxyBaseUrl = _defaultProxyBaseUrl();
  let _ip           = _normalizeTarget(localStorage.getItem('esp32_ip') || PROXY_TARGET);
  let _pollInterval = _normalizePollInterval(localStorage.getItem('esp32_poll') || '600');
  let _timerId      = null;
  let _listeners    = [];
  let _status       = 'connecting';
  let _consecutiveErrors = 0;
  let _pollInFlight = false;
  let _lastError    = '';
  let _lastUrl      = '';
  let _lastState = {
    raw: {},
    calibration: {},
    enabled: {},
    calibrating: false,
    calibratedAt: 0,
  };

  const sensors = { keyPinch: 4095, indexThumb: 4095, middleThumb: 4095 };

  // ── helpers ────────────────────────────────────────────────
  function _normalizePollInterval(value) {
    const ms = parseInt(value, 10);
    return Number.isFinite(ms) ? Math.max(300, ms) : 600;
  }

  function _defaultProxyBaseUrl() {
    if (typeof window !== 'undefined' && /^https?:$/.test(window.location.protocol)) {
      return PROXY_BASE_PATH;
    }
    return LOCAL_DEV_PROXY_BASE_URL;
  }

  function _unique(list) {
    return list.filter((item, index) => item && list.indexOf(item) === index);
  }

  function _proxyBaseCandidates() {
    const candidates = [_proxyBaseUrl, PROXY_BASE_PATH, LOCAL_DEV_PROXY_BASE_URL];

    if (typeof window !== 'undefined' && /^https?:$/.test(window.location.protocol) && window.location.hostname) {
      candidates.push(`${window.location.protocol}//${window.location.hostname}:8000/esp32`);
    }

    return _unique(candidates.map(base => String(base).replace(/\/+$/, '')));
  }

  function _normalizeTarget(value) {
    const target = String(value || '').trim()
      .replace(/^https?:\/\//i, '')
      .replace(/\/.*$/, '');
    if (!target) return PROXY_TARGET;
    if (target === PROXY_TARGET || target === 'proxy' || target === '/esp32') return PROXY_TARGET;
    if (typeof window !== 'undefined') {
      const pageHost = window.location.host;
      const pageHostname = window.location.hostname;
      if (target === pageHost || target === pageHostname) return PROXY_TARGET;
    }
    if (/:(8000)$/.test(target)) return PROXY_TARGET;
    if (!/:\d+$/.test(target)) return `${target}:${DEFAULT_ESP_PORT}`;
    return target || PROXY_TARGET;
  }

  function _url(path = 'state') { return _urlFor(_ip, path); }
  function _urlFor(target, path = 'state') {
    return target === PROXY_TARGET ? `${_proxyBaseUrl}/${path}` : `http://${target}/${path}`;
  }

  function _fallbackTargets(primary) {
    const targets = [primary, PROXY_TARGET, DIRECT_AP_IP, DIRECT_AP_IP_PORTLESS];
    return targets.filter((target, index) => target && targets.indexOf(target) === index);
  }

  async function _fetchJsonUrl(url, options = {}) {
    const { timeoutMs = STATE_TIMEOUT_MS, ...fetchOptions } = options;
    _lastUrl = url;
    const res = await fetch(url, {
      ...fetchOptions,
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function _fetchTarget(target, path, options = {}) {
    if (target !== PROXY_TARGET) {
      return _fetchJsonUrl(_urlFor(target, path), options);
    }

    let lastErr = null;
    for (const base of _proxyBaseCandidates()) {
      try {
        const data = await _fetchJsonUrl(`${base}/${path}`, options);
        _proxyBaseUrl = base;
        return data;
      } catch (err) {
        lastErr = err;
      }
    }

    throw lastErr || new Error('local proxy request failed');
  }

  async function _fetchState(target) {
    return _fetchTarget(target, 'state');
  }

  function _copyCalibration(calibration = {}) {
    return Object.keys(calibration).reduce((copy, key) => {
      copy[key] = { ...calibration[key] };
      return copy;
    }, {});
  }

  function _snapshotState() {
    return {
      ..._lastState,
      raw: { ..._lastState.raw },
      calibration: _copyCalibration(_lastState.calibration),
      enabled: { ...(_lastState.enabled || {}) },
    };
  }

  function _emit() {
    const snap = { ...sensors };
    const state = _snapshotState();
    _listeners.forEach(fn => { try { fn(snap, _status, state); } catch(e) {} });
  }

  function _setStatus(s) {
    if (_status === s) return;
    _status = s;
    _emit();
  }

  function _applyState(data = {}) {
    const s = data.sensors || {};
    sensors.keyPinch    = s.keyPinch    ?? s.thumb  ?? sensors.keyPinch;
    sensors.indexThumb  = s.indexThumb  ?? s.index  ?? sensors.indexThumb;
    sensors.middleThumb = s.middleThumb ?? s.middle ?? sensors.middleThumb;

    const enabledFromCalibration = Object.keys(data.calibration || {}).reduce((enabled, key) => {
      if (data.calibration[key]?.enabled !== undefined) enabled[key] = data.calibration[key].enabled !== false;
      return enabled;
    }, {});
    const enabled = data.enabled || (Object.keys(enabledFromCalibration).length ? enabledFromCalibration : null);

    _lastState = {
      raw: { ...(_lastState.raw || {}), ...(data.raw || {}) },
      calibration: data.calibration ? _copyCalibration(data.calibration) : _lastState.calibration,
      enabled: enabled ? { ...enabled } : _lastState.enabled,
      calibrating: !!data.calibrating,
      calibratedAt: data.calibratedAt ?? _lastState.calibratedAt,
    };

    if (typeof Gestures !== 'undefined' && Gestures.setEnabledFingers) {
      Gestures.setEnabledFingers(_lastState.enabled);
    }
  }

  // ── poll ───────────────────────────────────────────────────
  async function _poll() {
    if (_pollInFlight) return;
    _pollInFlight = true;

    try {
      let data;
      let connectedTarget = _ip;
      let lastErr = null;

      for (const target of _fallbackTargets(_ip)) {
        try {
          data = await _fetchState(target);
          connectedTarget = target;
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
        }
      }

      if (!data) throw lastErr || new Error('state request failed');

      _ip = connectedTarget;
      localStorage.setItem('esp32_ip', _ip);
      _lastError = '';
      _applyState(data);
      _consecutiveErrors = 0;
      _setStatus('connected');
      _emit();
    } catch (err) {
      _lastError = `${err.name || 'Error'}: ${err.message || 'state request failed'}`;
      _consecutiveErrors++;
      if (_consecutiveErrors >= 3) _setStatus('error');
    } finally {
      _pollInFlight = false;
    }
  }

  // ── public API ─────────────────────────────────────────────
  function start() {
    if (_timerId) return;
    _poll(); // immediate first hit
    _timerId = setInterval(_poll, _pollInterval);
  }

  function stop() {
    if (_timerId) { clearInterval(_timerId); _timerId = null; }
  }

  function onData(fn)  { if (!_listeners.includes(fn)) _listeners.push(fn); }
  function offData(fn) { _listeners = _listeners.filter(f => f !== fn); }

  function setIP(ip) {
    _ip = _normalizeTarget(ip);
    localStorage.setItem('esp32_ip', _ip);
    _consecutiveErrors = 0;
    _setStatus('connecting');
    stop(); start(); // restart with new target
  }

  function setPollInterval(ms) {
    _pollInterval = _normalizePollInterval(ms);
    localStorage.setItem('esp32_poll', _pollInterval);
    if (_timerId) { stop(); start(); }
  }

  async function calibrate(action = 'start') {
    _lastState = { ..._lastState, calibrating: true };
    _emit();

    try {
      const data = await _fetchTarget(_ip, 'calibrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ action }),
        timeoutMs: 15000,
      });
      _applyState(data);
      _consecutiveErrors = 0;
      _setStatus('connected');
      _emit();
      return _snapshotState();
    } catch (err) {
      _lastState = { ..._lastState, calibrating: false };
      _setStatus('error');
      _emit();
      throw err;
    }
  }

  async function setCalibration(calibration) {
    const body = new URLSearchParams();
    Object.entries(calibration || {}).forEach(([key, pair]) => {
      if (pair?.open !== undefined) body.set(`${key}Open`, pair.open);
      if (pair?.bent !== undefined) body.set(`${key}Bent`, pair.bent);
    });

    const data = await _fetchTarget(_ip, 'calibration', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      timeoutMs: 10000,
    });
    _applyState(data);
    _consecutiveErrors = 0;
    _setStatus('connected');
    _emit();
    return _snapshotState();
  }

  function injectSensors(values) {
    sensors.keyPinch    = values.keyPinch    ?? values.thumb  ?? sensors.keyPinch;
    sensors.indexThumb  = values.indexThumb  ?? values.index  ?? sensors.indexThumb;
    sensors.middleThumb = values.middleThumb ?? values.middle ?? sensors.middleThumb;
    _emit();
  }

  return {
    get sensors()      { return sensors; },
    get status()       { return _status; },
    get ip()           { return _ip; },
    get pollInterval() { return _pollInterval; },
    get lastState()    { return _snapshotState(); },
    get lastError()    { return _lastError; },
    get lastUrl()      { return _lastUrl || _url('state'); },
    start, stop, onData, offData, setIP, setPollInterval, calibrate, setCalibration, injectSensors,
  };
})();
