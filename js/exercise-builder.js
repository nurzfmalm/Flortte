/** Build deterministic, MIDI-free gesture training sessions. */
const ExerciseBuilder = (() => {
  const STORAGE_KEY = 'flortte_exercise_plan_v2';
  const FINGER_LABELS = ['Большой', 'Указательный', 'Средний', 'Безымянный', 'Мизинец'];
  const GENERATION_MODES = new Set(['balanced', 'random', 'no-repeat', 'sequence']);
  const AUDIO_PRESETS = [
    {
      id: 'potter',
      name: 'Гарри Поттер',
      emoji: '🧙',
      description: 'Встроенное аудио',
      audioUrl: 'assets/audio/potter.mp3',
      defaultBpm: 70,
    },
    {
      id: 'blue-tractor',
      name: 'Синий трактор',
      emoji: '🚜',
      description: 'Инструментальный тренировочный трек',
      audioUrl: 'assets/audio/blue-tractor.mp3',
      defaultBpm: 90,
    },
    {
      id: 'baby-shark',
      name: 'Baby Shark',
      emoji: '🦈',
      description: 'Оригинальный детский тренировочный ритм',
      audioUrl: 'assets/audio/baby-shark-training.mp3',
      defaultBpm: 115,
    },
    {
      id: 'none',
      name: 'Без фоновой музыки',
      emoji: '🔕',
      description: 'Звуки нот генерируются приложением',
      audioUrl: null,
      defaultBpm: 60,
    },
  ];
  const DEFAULT_PLAN = {
    name: 'Моя тренировка',
    gestureIds: [],
    bpm: 70,
    fallDurationMs: 2800,
    hitWindowMs: 250,
    actionCount: 30,
    generationMode: 'balanced',
    audioId: 'potter',
    seed: 6767,
  };

  let _plan = { ...DEFAULT_PLAN, gestureIds: [] };
  let _onStart = null;
  let _els = null;
  let _customAudio = null;

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
    const gestureIds = [];
    (Array.isArray(raw.gestureIds) ? raw.gestureIds : []).forEach((id) => {
      if (availableIds.has(id) && !gestureIds.includes(id)) gestureIds.push(id);
    });
    const generationMode = GENERATION_MODES.has(raw.generationMode)
      ? raw.generationMode
      : DEFAULT_PLAN.generationMode;
    const validAudioIds = new Set([...AUDIO_PRESETS.map(preset => preset.id), 'custom']);

    return {
      name: String(raw.name || DEFAULT_PLAN.name).trim().slice(0, 60) || DEFAULT_PLAN.name,
      gestureIds,
      bpm: _clamp(raw.bpm, 30, 180, DEFAULT_PLAN.bpm),
      fallDurationMs: _clamp(raw.fallDurationMs, 1000, 5000, DEFAULT_PLAN.fallDurationMs),
      hitWindowMs: _clamp(raw.hitWindowMs, 100, 500, DEFAULT_PLAN.hitWindowMs),
      actionCount: _clamp(raw.actionCount, 5, 200, DEFAULT_PLAN.actionCount),
      generationMode,
      audioId: validAudioIds.has(raw.audioId) ? raw.audioId : DEFAULT_PLAN.audioId,
      seed: _clamp(raw.seed, 1, 999999999, DEFAULT_PLAN.seed),
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
    } catch (_) {}
    return { ..._plan, gestureIds: [..._plan.gestureIds] };
  }

  function targetFingerIndexes(plan = _plan, catalogue = _catalogue()) {
    const selected = new Set(plan.gestureIds || []);
    const targets = new Set();
    catalogue.forEach((gesture) => {
      if (!selected.has(gesture.id)) return;
      if (gesture.id === 'fist' || gesture.id === 'open-hand') {
        FINGER_LABELS.forEach((_, index) => targets.add(index));
        return;
      }
      (gesture.pattern || []).forEach((required, index) => {
        if (required === 1) targets.add(index);
      });
    });
    return Array.from(targets).sort((a, b) => a - b);
  }

  function _random(seed) {
    let state = seed >>> 0;
    return () => {
      state += 0x6D2B79F5;
      let value = state;
      value = Math.imul(value ^ value >>> 15, value | 1);
      value ^= value + Math.imul(value ^ value >>> 7, value | 61);
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
  }

  function _shuffle(values, random) {
    const copy = [...values];
    for (let index = copy.length - 1; index > 0; index--) {
      const target = Math.floor(random() * (index + 1));
      [copy[index], copy[target]] = [copy[target], copy[index]];
    }
    return copy;
  }

  function generateGestureIds(rawPlan, catalogue = _catalogue()) {
    const plan = normalizePlan(rawPlan, catalogue);
    if (!plan.gestureIds.length) return [];
    const random = _random(plan.seed);
    const result = [];

    if (plan.generationMode === 'sequence') {
      for (let index = 0; index < plan.actionCount; index++) {
        result.push(plan.gestureIds[index % plan.gestureIds.length]);
      }
      return result;
    }

    if (plan.generationMode === 'balanced') {
      while (result.length < plan.actionCount) {
        let cycle = _shuffle(plan.gestureIds, random);
        if (result.length && cycle.length > 1 && cycle[0] === result[result.length - 1]) {
          [cycle[0], cycle[1]] = [cycle[1], cycle[0]];
        }
        result.push(...cycle.slice(0, plan.actionCount - result.length));
      }
      return result;
    }

    while (result.length < plan.actionCount) {
      let candidates = plan.gestureIds;
      if (plan.generationMode === 'no-repeat' && plan.gestureIds.length > 1 && result.length) {
        candidates = plan.gestureIds.filter(id => id !== result[result.length - 1]);
      }
      result.push(candidates[Math.floor(random() * candidates.length)]);
    }
    return result;
  }

  function audioPreset(id) {
    if (id === 'custom' && _customAudio) return _customAudio;
    return AUDIO_PRESETS.find(preset => preset.id === id)
      || AUDIO_PRESETS.find(preset => preset.id === DEFAULT_PLAN.audioId);
  }

  function createSession(rawPlan, catalogue = _catalogue()) {
    const plan = normalizePlan(rawPlan, catalogue);
    if (!plan.gestureIds.length) throw new Error('Выбери хотя бы один жест.');
    if (plan.audioId === 'custom' && !_customAudio) {
      throw new Error('Загрузи аудиофайл заново. Локальный файл не сохраняется после перезапуска приложения.');
    }

    const selected = new Set(plan.gestureIds);
    const activeGestures = catalogue.filter(gesture => selected.has(gesture.id));
    const gestureById = new Map(activeGestures.map(gesture => [gesture.id, gesture]));
    const laneById = new Map(activeGestures.map((gesture, index) => [gesture.id, index]));
    const sequence = generateGestureIds(plan, catalogue);
    const intervalMs = 60000 / plan.bpm;
    const leadInMs = plan.fallDurationMs + 500;
    const notes = sequence.map((gestureId, index) => {
      const gesture = gestureById.get(gestureId);
      return {
        time: Math.round(leadInMs + index * intervalMs),
        duration: Math.min(600, Math.round(intervalMs * 0.45)),
        note: gesture.note,
        noteName: gesture.emoji || String(index + 1),
        velocity: 88,
        lane: laneById.get(gestureId),
        gestureId,
      };
    });
    const preset = audioPreset(plan.audioId);
    const lastTime = notes.length ? notes[notes.length - 1].time : leadInMs;

    return {
      name: plan.name,
      notes,
      durationMs: Math.round(lastTime + plan.hitWindowMs + 900),
      preserveLanes: true,
      gestureIds: activeGestures.map(gesture => gesture.id),
      audioUrl: preset.audioUrl,
      audioName: preset.name,
      audioLoop: true,
      approachTimeMs: plan.fallDurationMs,
      hitWindowMs: plan.hitWindowMs,
      exercise: {
        bpm: plan.bpm,
        intervalMs: Math.round(intervalMs),
        fallDurationMs: plan.fallDurationMs,
        hitWindowMs: plan.hitWindowMs,
        actionCount: plan.actionCount,
        generationMode: plan.generationMode,
        seed: plan.seed,
        sequence,
        targetFingers: targetFingerIndexes(plan, catalogue),
        audioId: plan.audioId,
      },
    };
  }

  function createQuickTraining(audioId, catalogue = _catalogue(), overrides = {}) {
    const preset = audioPreset(audioId);
    return createSession({
      ...DEFAULT_PLAN,
      name: `Быстрая тренировка: ${preset.name}`,
      gestureIds: catalogue.map(gesture => gesture.id),
      bpm: preset.defaultBpm,
      actionCount: 30,
      audioId: preset.id,
      seed: Math.max(1, Date.now() % 999999999),
      ...overrides,
    }, catalogue);
  }

  function _setGestureImage(container, gesture) {
    container.textContent = '';
    const image = document.createElement('img');
    image.src = gesture.image;
    image.alt = gesture.name;
    image.loading = 'lazy';
    container.appendChild(image);
  }

  function _gestureTargets(gesture) {
    const indexes = targetFingerIndexes({ gestureIds: [gesture.id] }, [gesture]);
    return indexes.map(index => FINGER_LABELS[index]).join(', ') || 'Вся кисть';
  }

  function _buildGestureGrid() {
    _els.grid.innerHTML = '';
    _catalogue().forEach((gesture) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'exercise-gesture-card';
      card.dataset.gestureId = gesture.id;
      card.setAttribute('aria-pressed', 'false');
      card.innerHTML = '<span class="exercise-gesture-image"></span><span class="exercise-gesture-check">✓</span><strong></strong><small></small>';
      _setGestureImage(card.querySelector('.exercise-gesture-image'), gesture);
      card.querySelector('strong').textContent = gesture.name;
      card.querySelector('small').textContent = _gestureTargets(gesture);
      card.addEventListener('click', () => {
        const index = _plan.gestureIds.indexOf(gesture.id);
        if (index >= 0) _plan.gestureIds.splice(index, 1);
        else _plan.gestureIds.push(gesture.id);
        savePlan(_plan);
        _render();
      });
      _els.grid.appendChild(card);
    });
  }

  function _renderAudioCards() {
    _els.audioGrid.innerHTML = '';
    AUDIO_PRESETS.forEach((preset) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'exercise-music-card';
      card.dataset.audioId = preset.id;
      card.innerHTML = '<span class="exercise-music-icon"></span><span><strong></strong><small></small></span><span class="exercise-music-check">✓</span>';
      card.querySelector('.exercise-music-icon').textContent = preset.emoji;
      card.querySelector('strong').textContent = preset.name;
      card.querySelector('small').textContent = preset.description;
      card.addEventListener('click', () => {
        _plan.audioId = preset.id;
        savePlan(_plan);
        _render();
      });
      _els.audioGrid.appendChild(card);
    });
  }

  function _plural(number, one, few, many) {
    const mod10 = number % 10;
    const mod100 = number % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
  }

  function _renderPreview() {
    const byId = new Map(_catalogue().map(gesture => [gesture.id, gesture]));
    const sequence = generateGestureIds(_plan).slice(0, 12);
    _els.sequence.innerHTML = '';
    _els.empty.hidden = sequence.length > 0;
    sequence.forEach((id, index) => {
      const gesture = byId.get(id);
      if (!gesture) return;
      const item = document.createElement('div');
      item.className = 'exercise-sequence-item preview';
      item.innerHTML = '<span class="exercise-sequence-number"></span><span class="exercise-sequence-image"></span><div class="exercise-sequence-copy"><strong></strong><small></small></div>';
      item.querySelector('.exercise-sequence-number').textContent = index + 1;
      _setGestureImage(item.querySelector('.exercise-sequence-image'), gesture);
      item.querySelector('strong').textContent = gesture.name;
      item.querySelector('small').textContent = _gestureTargets(gesture);
      _els.sequence.appendChild(item);
    });
  }

  function _render() {
    if (!_els) return;
    const selected = new Set(_plan.gestureIds);
    _els.grid.querySelectorAll('.exercise-gesture-card').forEach((card) => {
      const active = selected.has(card.dataset.gestureId);
      card.classList.toggle('selected', active);
      card.setAttribute('aria-pressed', String(active));
    });
    _els.audioGrid.querySelectorAll('.exercise-music-card').forEach((card) => {
      const active = card.dataset.audioId === _plan.audioId;
      card.classList.toggle('selected', active);
      card.setAttribute('aria-pressed', String(active));
    });
    _els.customCard.classList.toggle('selected', _plan.audioId === 'custom');

    const count = _plan.gestureIds.length;
    const targets = targetFingerIndexes().map(index => FINGER_LABELS[index]);
    const durationSeconds = Math.ceil((_plan.fallDurationMs + 500 + (_plan.actionCount - 1) * 60000 / _plan.bpm + 1000) / 1000);
    _els.count.textContent = `${count} ${_plural(count, 'выбран', 'выбрано', 'выбрано')}`;
    _els.targets.textContent = targets.length ? targets.join(', ') : 'Не выбраны';
    _els.total.textContent = `${_plan.actionCount} действий`;
    _els.duration.textContent = `${durationSeconds} сек`;
    _els.bpmValue.textContent = `${_plan.bpm} BPM`;
    _els.fallValue.textContent = `${(_plan.fallDurationMs / 1000).toFixed(1)} с`;
    _els.windowValue.textContent = `±${_plan.hitWindowMs} мс`;
    _els.actionValue.textContent = String(_plan.actionCount);
    _els.seedValue.textContent = `Seed ${_plan.seed}`;
    _els.start.disabled = count === 0;
    _els.error.textContent = '';
    _renderPreview();
  }

  function _syncFields() {
    _els.name.value = _plan.name;
    _els.bpm.value = _plan.bpm;
    _els.fall.value = _plan.fallDurationMs;
    _els.window.value = _plan.hitWindowMs;
    _els.actionCount.value = _plan.actionCount;
    _els.mode.value = _plan.generationMode;
  }

  function _readFields() {
    _plan = normalizePlan({
      ..._plan,
      name: _els.name.value,
      bpm: _els.bpm.value,
      fallDurationMs: _els.fall.value,
      hitWindowMs: _els.window.value,
      actionCount: _els.actionCount.value,
      generationMode: _els.mode.value,
    });
    _syncFields();
    savePlan(_plan);
    _render();
  }

  function init(onStart) {
    _onStart = onStart;
    _els = {
      name: document.getElementById('exercise-name'),
      grid: document.getElementById('exercise-gesture-grid'),
      count: document.getElementById('exercise-selected-count'),
      audioGrid: document.getElementById('exercise-audio-presets'),
      customCard: document.getElementById('exercise-upload-card'),
      audioInput: document.getElementById('exercise-audio-input'),
      addAudio: document.getElementById('exercise-add-audio'),
      uploadError: document.getElementById('exercise-upload-error'),
      bpm: document.getElementById('exercise-bpm'),
      bpmValue: document.getElementById('exercise-bpm-value'),
      fall: document.getElementById('exercise-fall-duration'),
      fallValue: document.getElementById('exercise-fall-value'),
      window: document.getElementById('exercise-hit-window'),
      windowValue: document.getElementById('exercise-window-value'),
      actionCount: document.getElementById('exercise-action-count'),
      actionValue: document.getElementById('exercise-action-value'),
      mode: document.getElementById('exercise-generation-mode'),
      newSeed: document.getElementById('exercise-new-seed'),
      seedValue: document.getElementById('exercise-seed-value'),
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
    _renderAudioCards();
    _syncFields();
    _render();

    _els.name.addEventListener('change', _readFields);
    [_els.bpm, _els.fall, _els.window, _els.actionCount].forEach(input => {
      input.addEventListener('input', _readFields);
    });
    _els.mode.addEventListener('change', _readFields);
    _els.newSeed.addEventListener('click', () => {
      _plan.seed = Math.max(1, Date.now() % 999999999);
      savePlan(_plan);
      _render();
    });
    _els.clear.addEventListener('click', () => {
      _plan.gestureIds = [];
      savePlan(_plan);
      _render();
    });
    _els.addAudio.addEventListener('click', () => {
      const file = _els.audioInput.files[0];
      _els.uploadError.textContent = '';
      if (!file) {
        _els.uploadError.textContent = 'Выбери аудиофайл.';
        return;
      }
      if (_customAudio?.audioUrl) URL.revokeObjectURL(_customAudio.audioUrl);
      _customAudio = {
        id: 'custom',
        name: file.name.replace(/\.[^.]+$/, ''),
        emoji: '🎧',
        description: 'Локальный аудиофайл',
        audioUrl: URL.createObjectURL(file),
        defaultBpm: _plan.bpm,
      };
      _plan.audioId = 'custom';
      savePlan(_plan);
      _els.addAudio.textContent = '✓ Аудио выбрано';
      _render();
    });
    _els.start.addEventListener('click', () => {
      _readFields();
      try {
        const session = createSession(_plan);
        if (_onStart) _onStart(session);
      } catch (error) {
        _els.error.textContent = error.message || 'Не удалось создать тренировку.';
      }
    });
  }

  function enter() {
    if (!_els) return;
    _plan = loadPlan();
    if (_plan.audioId === 'custom' && !_customAudio) _plan.audioId = DEFAULT_PLAN.audioId;
    _buildGestureGrid();
    _renderAudioCards();
    _syncFields();
    _render();
  }

  return {
    init,
    enter,
    normalizePlan,
    loadPlan,
    savePlan,
    targetFingerIndexes,
    generateGestureIds,
    createSession,
    createQuickTraining,
    audioPreset,
    audioPresets: () => AUDIO_PRESETS.map(preset => ({ ...preset })),
  };
})();
