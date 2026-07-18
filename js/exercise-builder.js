/** Build and persist individual gesture exercise plans. */
const ExerciseBuilder = (() => {
  const STORAGE_KEY = 'flortte_exercise_plan_v1';
  const FINGER_LABELS = ['Большой', 'Указательный', 'Средний', 'Безымянный', 'Мизинец'];
  const DEFAULT_PLAN = {
    name: 'Моя тренировка',
    gestureIds: [],
    repetitions: 3,
    intervalMs: 2800,
  };

  let _plan = { ...DEFAULT_PLAN, gestureIds: [] };
  let _onStart = null;
  let _els = null;

  function _clamp(value, min, max, fallback) {
    const numeric = parseInt(value, 10);
    return Number.isFinite(numeric) ? Math.max(min, Math.min(max, numeric)) : fallback;
  }

  function _catalogue() {
    if (typeof Gestures === 'undefined') return [];
    const gestures = Gestures.playableGestures
      ? Gestures.playableGestures()
      : Gestures.allGestures?.() || [];
    return gestures.filter(gesture => gesture.lane !== null && gesture.image);
  }

  function normalizePlan(raw = {}, catalogue = _catalogue()) {
    const availableIds = new Set(catalogue.map(gesture => gesture.id));
    const sourceIds = Array.isArray(raw.gestureIds) ? raw.gestureIds : [];
    const gestureIds = [];
    sourceIds.forEach((id) => {
      if (availableIds.has(id) && !gestureIds.includes(id)) gestureIds.push(id);
    });

    return {
      name: String(raw.name || DEFAULT_PLAN.name).trim().slice(0, 60) || DEFAULT_PLAN.name,
      gestureIds,
      repetitions: _clamp(raw.repetitions, 1, 10, DEFAULT_PLAN.repetitions),
      intervalMs: _clamp(raw.intervalMs, 1200, 5000, DEFAULT_PLAN.intervalMs),
    };
  }

  function loadPlan() {
    try {
      return normalizePlan(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'));
    } catch (_) {
      return normalizePlan(DEFAULT_PLAN);
    }
  }

  function savePlan(plan = _plan) {
    _plan = normalizePlan(plan);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(_plan));
    } catch (_) {
      // The current plan still works when local storage is unavailable.
    }
    return { ..._plan, gestureIds: [..._plan.gestureIds] };
  }

  function targetFingerIndexes(plan = _plan, catalogue = _catalogue()) {
    const selected = new Set(plan.gestureIds || []);
    const targets = new Set();

    catalogue.forEach((gesture) => {
      if (!selected.has(gesture.id)) return;
      const pattern = Array.isArray(gesture.pattern) ? gesture.pattern : [];
      if (gesture.id === 'fist' || gesture.id === 'open-hand') {
        FINGER_LABELS.forEach((_, index) => targets.add(index));
        return;
      }
      pattern.forEach((required, index) => {
        if (required === 1) targets.add(index);
      });
    });

    return Array.from(targets).sort((a, b) => a - b);
  }

  function createSong(rawPlan, catalogue = _catalogue()) {
    const plan = normalizePlan(rawPlan, catalogue);
    if (!plan.gestureIds.length) throw new Error('Выбери хотя бы один жест.');

    const selectedSet = new Set(plan.gestureIds);
    const activeGestures = catalogue.filter(gesture => selectedSet.has(gesture.id));
    const laneById = new Map(activeGestures.map((gesture, index) => [gesture.id, index]));
    const gestureById = new Map(catalogue.map(gesture => [gesture.id, gesture]));
    const notes = [];
    const leadInMs = 2600;
    let actionIndex = 0;

    for (let round = 0; round < plan.repetitions; round++) {
      plan.gestureIds.forEach((gestureId) => {
        const gesture = gestureById.get(gestureId);
        if (!gesture || !laneById.has(gestureId)) return;
        notes.push({
          time: leadInMs + actionIndex * plan.intervalMs,
          duration: Math.min(700, Math.round(plan.intervalMs * 0.4)),
          note: gesture.note,
          noteName: typeof Gestures !== 'undefined' && Gestures.midiToName
            ? Gestures.midiToName(gesture.note)
            : String(gesture.note),
          velocity: 90,
          lane: laneById.get(gestureId),
          gestureId,
          round: round + 1,
        });
        actionIndex++;
      });
    }

    return {
      name: plan.name,
      notes,
      durationMs: leadInMs + actionIndex * plan.intervalMs + 1000,
      preserveLanes: true,
      gestureIds: activeGestures.map(gesture => gesture.id),
      exercise: {
        repetitions: plan.repetitions,
        intervalMs: plan.intervalMs,
        sequence: [...plan.gestureIds],
        targetFingers: targetFingerIndexes(plan, catalogue),
      },
    };
  }

  function _gestureTargets(gesture) {
    const indexes = targetFingerIndexes({ gestureIds: [gesture.id] }, [gesture]);
    return indexes.map(index => FINGER_LABELS[index]).join(', ') || 'Вся кисть';
  }

  function _setGestureImage(container, gesture) {
    container.textContent = '';
    const image = document.createElement('img');
    image.src = gesture.image;
    image.alt = gesture.name;
    image.loading = 'lazy';
    container.appendChild(image);
  }

  function _buildGestureGrid() {
    if (!_els) return;
    _els.grid.innerHTML = '';
    _catalogue().forEach((gesture) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'exercise-gesture-card';
      card.dataset.gestureId = gesture.id;
      card.setAttribute('aria-pressed', 'false');
      card.innerHTML = `
        <span class="exercise-gesture-image"></span>
        <span class="exercise-gesture-check">✓</span>
        <strong></strong>
        <small></small>`;
      _setGestureImage(card.querySelector('.exercise-gesture-image'), gesture);
      card.querySelector('strong').textContent = gesture.name;
      card.querySelector('small').textContent = _gestureTargets(gesture);
      card.addEventListener('click', () => _toggleGesture(gesture.id));
      _els.grid.appendChild(card);
    });
  }

  function _toggleGesture(id) {
    const index = _plan.gestureIds.indexOf(id);
    if (index >= 0) _plan.gestureIds.splice(index, 1);
    else _plan.gestureIds.push(id);
    savePlan(_plan);
    _render();
  }

  function _moveGesture(index, direction) {
    const target = index + direction;
    if (target < 0 || target >= _plan.gestureIds.length) return;
    [_plan.gestureIds[index], _plan.gestureIds[target]] = [_plan.gestureIds[target], _plan.gestureIds[index]];
    savePlan(_plan);
    _render();
  }

  function _removeGesture(index) {
    _plan.gestureIds.splice(index, 1);
    savePlan(_plan);
    _render();
  }

  function _renderSequence() {
    const byId = new Map(_catalogue().map(gesture => [gesture.id, gesture]));
    _els.sequence.innerHTML = '';
    _els.empty.hidden = _plan.gestureIds.length > 0;

    _plan.gestureIds.forEach((id, index) => {
      const gesture = byId.get(id);
      if (!gesture) return;
      const item = document.createElement('div');
      item.className = 'exercise-sequence-item';
      item.innerHTML = `
        <span class="exercise-sequence-number"></span>
        <span class="exercise-sequence-image"></span>
        <div class="exercise-sequence-copy"><strong></strong><small></small></div>
        <div class="exercise-sequence-actions">
          <button type="button" class="exercise-order-button move-up" aria-label="Поднять выше">↑</button>
          <button type="button" class="exercise-order-button move-down" aria-label="Опустить ниже">↓</button>
          <button type="button" class="exercise-order-button remove" aria-label="Удалить">×</button>
        </div>`;
      item.querySelector('.exercise-sequence-number').textContent = index + 1;
      _setGestureImage(item.querySelector('.exercise-sequence-image'), gesture);
      item.querySelector('.exercise-sequence-copy strong').textContent = gesture.name;
      item.querySelector('.exercise-sequence-copy small').textContent = _gestureTargets(gesture);
      const up = item.querySelector('.move-up');
      const down = item.querySelector('.move-down');
      up.disabled = index === 0;
      down.disabled = index === _plan.gestureIds.length - 1;
      up.addEventListener('click', () => _moveGesture(index, -1));
      down.addEventListener('click', () => _moveGesture(index, 1));
      item.querySelector('.remove').addEventListener('click', () => _removeGesture(index));
      _els.sequence.appendChild(item);
    });
  }

  function _plural(number, one, few, many) {
    const mod10 = number % 10;
    const mod100 = number % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
  }

  function _render() {
    if (!_els) return;
    const selected = new Set(_plan.gestureIds);
    _els.grid.querySelectorAll('.exercise-gesture-card').forEach((card) => {
      const active = selected.has(card.dataset.gestureId);
      card.classList.toggle('selected', active);
      card.setAttribute('aria-pressed', String(active));
    });

    _renderSequence();
    const count = _plan.gestureIds.length;
    const actions = count * _plan.repetitions;
    const durationSeconds = actions ? Math.ceil((2600 + actions * _plan.intervalMs + 1000) / 1000) : 0;
    const targetNames = targetFingerIndexes().map(index => FINGER_LABELS[index]);
    _els.count.textContent = `${count} ${_plural(count, 'выбран', 'выбрано', 'выбрано')}`;
    _els.targets.textContent = targetNames.length ? targetNames.join(', ') : 'Не выбраны';
    _els.total.textContent = `${actions} ${_plural(actions, 'действие', 'действия', 'действий')}`;
    _els.duration.textContent = durationSeconds < 60
      ? `${durationSeconds} сек`
      : `${Math.floor(durationSeconds / 60)} мин ${durationSeconds % 60} сек`;
    _els.start.disabled = count === 0;
    _els.error.textContent = '';
  }

  function _syncFields() {
    _els.name.value = _plan.name;
    _els.repetitions.value = _plan.repetitions;
    _els.interval.value = String(_plan.intervalMs);
  }

  function _readFields() {
    _plan = normalizePlan({
      ..._plan,
      name: _els.name.value,
      repetitions: _els.repetitions.value,
      intervalMs: _els.interval.value,
    });
    _syncFields();
    savePlan(_plan);
    _render();
  }

  function init(onStart) {
    _onStart = onStart;
    _els = {
      name: document.getElementById('exercise-name'),
      repetitions: document.getElementById('exercise-repetitions'),
      interval: document.getElementById('exercise-interval'),
      grid: document.getElementById('exercise-gesture-grid'),
      count: document.getElementById('exercise-selected-count'),
      sequence: document.getElementById('exercise-sequence'),
      empty: document.getElementById('exercise-sequence-empty'),
      targets: document.getElementById('exercise-targets'),
      total: document.getElementById('exercise-total'),
      duration: document.getElementById('exercise-duration'),
      start: document.getElementById('exercise-start'),
      clear: document.getElementById('exercise-clear'),
      error: document.getElementById('exercise-error'),
    };
    if (!_els.grid) return;

    _plan = loadPlan();
    _buildGestureGrid();
    _syncFields();
    _render();

    _els.name.addEventListener('change', _readFields);
    _els.repetitions.addEventListener('change', _readFields);
    _els.interval.addEventListener('change', _readFields);
    _els.clear.addEventListener('click', () => {
      _plan.gestureIds = [];
      savePlan(_plan);
      _render();
    });
    _els.start.addEventListener('click', () => {
      _readFields();
      try {
        const song = createSong(_plan);
        if (_onStart) _onStart(song);
      } catch (error) {
        _els.error.textContent = error.message || 'Не удалось создать тренировку.';
      }
    });
  }

  function enter() {
    if (!_els) return;
    _plan = loadPlan();
    _buildGestureGrid();
    _syncFields();
    _render();
  }

  return { init, enter, normalizePlan, loadPlan, savePlan, targetFingerIndexes, createSong };
})();
