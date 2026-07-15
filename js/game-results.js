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
      fingerAttempts: FINGER_LABELS.map(() => 0),
      fingerHits: FINGER_LABELS.map(() => 0),
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

  function recordHit(session, note, gestureForLane) {
    if (!session || !note || note.resultRecorded) return;
    note.resultRecorded = true;
    session.hits++;
    _gesturePattern(gestureForLane, note.lane).forEach((required, index) => {
      if (required === 1 && index < session.fingerHits.length) {
        session.fingerHits[index]++;
      }
    });
  }

  function _percent(hits, attempts) {
    return attempts > 0 ? Math.round((hits / attempts) * 100) : null;
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
      fingers: FINGER_LABELS.map((name, index) => ({
        name,
        attempts: session.fingerAttempts[index],
        hits: session.fingerHits[index],
        successPercent: _percent(session.fingerHits[index], session.fingerAttempts[index]),
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

  return { createSession, recordHit, finalizeSession, loadHistory, save, latest };
})();
