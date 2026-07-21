/** Game performance calculations and local result history. */
const GameResults = (() => {
  const STORAGE_KEY = 'flortte_game_results_v1';
  const HISTORY_LIMIT = 20;
  const FINGER_LABELS = ['Большой', 'Указательный', 'Средний', 'Безымянный', 'Мизинец'];

  function _gesturePattern(gestureForLane, lane) {
    const gesture = typeof gestureForLane === 'function' ? gestureForLane(lane) : null;
    return Array.isArray(gesture?.pattern) ? gesture.pattern : [];
  }

  function createSession(song, gestureForLane) {
    const session = {
      songName: song?.name || 'Без названия',
      durationMs: Number(song?.durationMs) || 0,
      totalNotes: 0,
      hits: 0,
      timingErrorsMs: [],
      fingerAttempts: FINGER_LABELS.map(() => 0),
      fingerHits: FINGER_LABELS.map(() => 0),
      fingerTimingErrorsMs: FINGER_LABELS.map(() => []),
    };

    (song?.notes || []).forEach((note) => {
      if (note.lane === null || note.lane === undefined) return;
      session.totalNotes++;
      _gesturePattern(gestureForLane, note.lane).forEach((required, index) => {
        if (required === 1 && index < session.fingerAttempts.length) {
          session.fingerAttempts[index]++;
        }
      });
    });

    return session;
  }

  function recordHit(session, note, gestureForLane, { movementTimeMs } = {}) {
    if (!session || !note || note.resultRecorded) return;
    note.resultRecorded = true;
    session.hits++;

    const targetTimeMs = Number(note.time);
    const actualTimeMs = Number(movementTimeMs);
    const timingErrorMs = Number.isFinite(targetTimeMs) && Number.isFinite(actualTimeMs)
      ? Math.abs(actualTimeMs - targetTimeMs)
      : null;

    if (timingErrorMs !== null) session.timingErrorsMs.push(timingErrorMs);

    _gesturePattern(gestureForLane, note.lane).forEach((required, index) => {
      if (required === 1 && index < session.fingerHits.length) {
        session.fingerHits[index]++;
        if (timingErrorMs !== null) session.fingerTimingErrorsMs[index].push(timingErrorMs);
      }
    });
  }

  function _percent(hits, attempts) {
    return attempts > 0 ? Math.round((hits / attempts) * 100) : null;
  }

  function timingMetrics(values = []) {
    const errors = values
      .filter(value => value !== null && value !== undefined && value !== '')
      .map(Number)
      .filter(value => Number.isFinite(value) && value >= 0);
    if (!errors.length) return { samples: 0, meanErrorMs: null, variabilityMs: null };

    const mean = errors.reduce((sum, value) => sum + value, 0) / errors.length;
    const variance = errors.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / errors.length;
    return {
      samples: errors.length,
      meanErrorMs: Math.round(mean * 100) / 100,
      variabilityMs: Math.round(Math.sqrt(variance) * 100) / 100,
    };
  }

  function finalizeSession(session, { score = 0, maxCombo = 0 } = {}) {
    if (!session) return null;
    const hits = Math.min(session.hits, session.totalNotes);
    const result = {
      songName: session.songName,
      completedAt: new Date().toISOString(),
      durationMs: session.durationMs,
      score,
      maxCombo,
      totalNotes: session.totalNotes,
      hits,
      misses: Math.max(0, session.totalNotes - hits),
      successPercent: _percent(hits, session.totalNotes) ?? 0,
      timing: timingMetrics(session.timingErrorsMs),
      fingers: FINGER_LABELS.map((name, index) => ({
        name,
        attempts: session.fingerAttempts[index],
        hits: session.fingerHits[index],
        successPercent: _percent(session.fingerHits[index], session.fingerAttempts[index]),
        timing: timingMetrics(session.fingerTimingErrorsMs[index]),
      })),
    };
    return result;
  }

  function loadHistory() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function save(result) {
    if (!result) return;
    try {
      const history = [result, ...loadHistory()].slice(0, HISTORY_LIMIT);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    } catch (_) {
      // The completed result still reaches the end screen when storage is unavailable.
    }
  }

  function latest() {
    return loadHistory()[0] || null;
  }

  return { createSession, recordHit, timingMetrics, finalizeSession, loadHistory, save, latest };
})();
