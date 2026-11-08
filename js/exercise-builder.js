/** Build deterministic, MIDI-free gesture training sessions. */
const ExerciseBuilder = (() => {
  // Keep calculation modules usable independently of the browser interface.
  const _t = typeof I18n !== 'undefined' ? I18n.t : (message, ...values) =>
    typeof message === 'string' ? message : message.reduce((text, part, index) =>
      text + part + (index < values.length ? values[index] : ''), '');
  const REFERENCE_APPROACH_MS = 2800;
  const STORAGE_KEY = 'flortte_exercise_plan_v2';
  const FINGER_LABELS = [_t('Большой'), _t('Указательный'), _t('Средний'), _t('Безымянный'), _t('Мизинец')];
  const GENERATION_MODES = new Set(['balanced', 'random', 'no-repeat', 'sequence']);
  const REPLACED_AUDIO_IDS = new Map([
    ['blue-tractor', 'the-builder'],
    ['baby-shark', 'porch-swing-days'],
  ]);
  const AUDIO_PRESETS = [
    {
      id: 'potter',
      name: _t('Гарри Поттер'),
      emoji: '🧙',
      description: _t('Встроенное аудио'),
      audioUrl: 'assets/audio/potter.mp3',
      defaultBpm: 125,
      trackDurationMs: 34667,
      firstBeatMs: 481,
      // Measured from the local recording, whose tempo is not constant.
      beats: [
        481, 824, 1335, 1788, 2374, 2728, 3227, 3674, 4185, 4661, 5143, 5625,
        6246, 6635, 7105, 7569, 8022, 8492, 8968, 9456, 10060, 10489, 11041,
        11401, 11999, 12347, 12852, 13328, 13943, 14315, 14837, 15313, 15876,
        16236, 16840, 17200, 17792, 18158, 18738, 19086, 19545, 20062, 20561,
        21019, 21635, 22111, 22569, 23034, 23550, 23910, 24537, 24868, 25437,
        25861, 26401, 26859, 27312, 27689, 28125, 28595, 29117, 29524, 29971,
        30418, 30865, 31370, 31794, 32246, 32699, 33152, 33634, 34139,
      ],
    },
    {
      id: 'the-builder',
      name: 'The Builder',
      description: 'Kevin MacLeod (CC BY 4.0)',
      audioUrl: 'assets/audio/the-builder.mp3',
      defaultBpm: 123,
      trackDurationMs: 117629,
      firstBeatMs: 24,
    },
    {
      id: 'porch-swing-days',
      name: 'Porch Swing Days (slower)',
      description: 'Kevin MacLeod (CC BY 4.0)',
      audioUrl: 'assets/audio/porch-swing-days.mp3',
      defaultBpm: 110,
      trackDurationMs: 216288,
      firstBeatMs: 18,
    },
    {
      id: 'carefree',
      name: 'Carefree',
      description: 'Kevin MacLeod (CC BY 4.0)',
      audioUrl: 'assets/audio/carefree.mp3',
      defaultBpm: 96,
      trackDurationMs: 205140,
      firstBeatMs: 29,
      lastBeatMs: 200030,
    },
    {
      id: 'monkeys',
      name: 'Monkeys Spinning Monkeys',
      description: 'Kevin MacLeod (CC BY 4.0)',
      audioUrl: 'assets/audio/monkeys-spinning-monkeys.mp3',
      defaultBpm: 144,
      trackDurationMs: 125074,
      firstBeatMs: 44,
    },
    {
      id: 'workshop',
      name: _t('Ритм мастерской'),
      description: _t('Подстраивается под темп тренировки'),
      audioUrl: null,
      rhythm: true,
      defaultBpm: 84,
    },
    {
      id: 'none',
      name: _t('Без фоновой музыки'),
      emoji: '🔕',
      description: _t('Звуки нот генерируются приложением'),
      audioUrl: null,
      defaultBpm: 60,
    },
  ];
  const DEFAULT_PLAN = {
    name: _t('Моя тренировка'),
    gestureIds: [],
    bpm: 125,
    fallDurationMs: 2800,
    hitWindowMs: 250,
    actionCount: 30,
    generationMode: 'balanced',
    audioId: 'potter',
    seed: 42,
  };

  let _plan = { ...DEFAULT_PLAN, gestureIds: [] };
  let _onStart = null;
  let _els = null;
  let _customAudio = null;
  let _stopPreview = null;

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

    const replacement = REPLACED_AUDIO_IDS.get(raw.audioId);
    const requestedAudioId = replacement ?? raw.audioId;
    const audioId = validAudioIds.has(requestedAudioId) ? requestedAudioId : DEFAULT_PLAN.audioId;
    const nativeBpm = audioPreset(audioId).defaultBpm;

    return {
      name: String(raw.name || DEFAULT_PLAN.name).trim().slice(0, 60) || DEFAULT_PLAN.name,
      gestureIds,
      bpm: _clamp(replacement ? nativeBpm : raw.bpm, Math.min(30, nativeBpm), Math.max(180, nativeBpm), nativeBpm),
      sourceBpm: _clamp(raw.sourceBpm ?? raw.bpm, 30, 300, nativeBpm),
      fallDurationMs: _clamp(raw.fallDurationMs, 1000, 5000, DEFAULT_PLAN.fallDurationMs),
      hitWindowMs: _clamp(raw.hitWindowMs, 100, 500, DEFAULT_PLAN.hitWindowMs),
      actionCount: _clamp(raw.actionCount, 5, 200, DEFAULT_PLAN.actionCount),
      generationMode,
      audioId,
      firstBeatMs: _clamp(raw.firstBeatMs, 0, 60000, 0),
      audioLoop: raw.audioLoop !== false,
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
    return AUDIO_PRESETS.find(preset => preset.id === (REPLACED_AUDIO_IDS.get(id) ?? id))
      || AUDIO_PRESETS.find(preset => preset.id === DEFAULT_PLAN.audioId);
  }

  function sourceBpm(plan, preset) {
    return preset.id === 'custom' && !preset.midiNotes ? plan.sourceBpm : preset.defaultBpm;
  }

  function playbackRate(plan, preset) {
    const rate = plan.bpm / sourceBpm(plan, preset) * REFERENCE_APPROACH_MS / plan.fallDurationMs;
    return Math.min(4, Math.max(0.25, rate));
  }

  function beatTimes(plan, preset, rate) {
    const interval = 60000 / sourceBpm(plan, preset);
    const leadIn = REFERENCE_APPROACH_MS + 500 * rate;
    if (!preset.trackDurationMs) {
      return Array.from({ length: plan.actionCount }, (_, index) => (leadIn + index * interval) / rate);
    }

    const firstBeat = preset.id === 'custom' && !preset.midiNotes ? plan.firstBeatMs : preset.firstBeatMs;
    const duration = preset.trackDurationMs;
    if (firstBeat >= duration) return [];
    const beatCount = preset.beats?.length ?? Math.max(0, Math.ceil((Math.min(duration, preset.lastBeatMs ?? duration) - firstBeat) / interval));
    if (!beatCount) return [];
    const times = [];
    const preparationMs = leadIn / rate;
    // A silent approach precedes the recording, so even a short clip keeps its first beat.
    for (let cycle = 0; times.length < plan.actionCount; cycle++) {
      for (let index = 0; index < beatCount && times.length < plan.actionCount; index++) {
        const beat = preset.beats?.[index] ?? firstBeat + index * interval;
        times.push(preparationMs + (cycle * duration + beat) / rate);
      }
      if (!plan.audioLoop) break;
    }
    return times;
  }

  function createSession(rawPlan, catalogue = _catalogue()) {
    const plan = normalizePlan(rawPlan, catalogue);
    if (!plan.gestureIds.length) throw new Error(_t('Выбери хотя бы один жест.'));
    if (plan.audioId === 'custom' && !_customAudio) {
      throw new Error(_t('Загрузи аудиофайл заново. Локальный файл не сохраняется после перезапуска приложения.'));
    }

    const selected = new Set(plan.gestureIds);
    const activeGestures = catalogue.filter(gesture => selected.has(gesture.id));
    const gestureById = new Map(activeGestures.map(gesture => [gesture.id, gesture]));
    const laneById = new Map(activeGestures.map((gesture, index) => [gesture.id, index]));
    const sequence = generateGestureIds(plan, catalogue);
    const preset = audioPreset(plan.audioId);
    const rate = playbackRate(plan, preset);
    const bpm = sourceBpm(plan, preset) * rate;
    const intervalMs = 60000 / bpm;
    const times = beatTimes(plan, preset, rate);
    if (!times.length) throw new Error(_t('В записи нет доступных долей. Проверь темп и начало первой доли.'));
    const notes = times.map((time, index) => {
      const gestureId = sequence[index];
      const gesture = gestureById.get(gestureId);
      return {
        time,
        duration: Math.min(600, Math.round(intervalMs * 0.45)),
        note: gesture.note,
        noteName: gesture.emoji || String(index + 1),
        velocity: 88,
        lane: laneById.get(gestureId),
        gestureId,
      };
    });
    const lastTime = times[times.length - 1];

    return {
      name: plan.name,
      notes,
      durationMs: Math.round(lastTime + plan.hitWindowMs + 900),
      preserveLanes: true,
      gestureIds: activeGestures.map(gesture => gesture.id),
      audioUrl: preset.audioUrl,
      audioName: preset.name,
      audioLoop: plan.audioLoop,
      trackDurationMs: preset.trackDurationMs,
      midiNotes: preset.midiNotes,
      playbackRate: rate,
      playbackLeadMs: preset.trackDurationMs ? REFERENCE_APPROACH_MS / rate + 500 : 0,
      audioRhythm: preset.rhythm ? { bpm, anchorMs: times[0] } : null,
      approachTimeMs: REFERENCE_APPROACH_MS / rate,
      hitWindowMs: plan.hitWindowMs,
      exercise: {
        bpm: Math.round(bpm),
        intervalMs: Math.round(intervalMs),
        fallDurationMs: REFERENCE_APPROACH_MS / rate,
        hitWindowMs: plan.hitWindowMs,
        actionCount: notes.length,
        generationMode: plan.generationMode,
        seed: plan.seed,
        sequence: sequence.slice(0, notes.length),
        targetFingers: targetFingerIndexes(plan, catalogue),
        audioId: plan.audioId,
      },
    };
  }

  function createQuickTraining(audioId, catalogue = _catalogue(), overrides = {}) {
    const preset = audioPreset(audioId);
    const selected = normalizePlan(loadPlan(), catalogue).gestureIds;
    return createSession({
      ...DEFAULT_PLAN,
      name: _t`Быстрая тренировка: ${preset.name}`,
      gestureIds: selected.length ? selected : catalogue.map(gesture => gesture.id),
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
    return indexes.map(index => FINGER_LABELS[index]).join(', ') || _t('Вся кисть');
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
      card.innerHTML = '<span class="exercise-music-icon"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M9 18V6l11-2v12M9 18a3 2 0 1 1-3-2c1.7 0 3 .9 3 2Zm11-2a3 2 0 1 1-3-2c1.7 0 3 .9 3 2Z"/></svg></span><span><strong></strong><small></small></span><span class="exercise-music-check">✓</span>';
      card.querySelector('strong').textContent = preset.name;
      card.querySelector('small').textContent = preset.description;
      card.addEventListener('click', () => {
        _stopPreview?.();
        _plan = normalizePlan({ ..._plan, audioId: preset.id, bpm: preset.defaultBpm });
        _syncFields();
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

  function _renderPreview(beatCount) {
    const byId = new Map(_catalogue().map(gesture => [gesture.id, gesture]));
    const sequence = generateGestureIds(_plan).slice(0, Math.min(12, beatCount));
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
    const audio = audioPreset(_plan.audioId);
    _els.audioPreview.disabled = !audio.audioUrl && !audio.rhythm && !audio.midiNotes;
    _els.audioLoop.disabled = !audio.trackDurationMs;
    _els.audioLoop.checked = _plan.audioLoop;
    _els.firstBeatRow.hidden = audio.id !== 'custom' || Boolean(audio.midiNotes);
    _els.sourceBpmRow.hidden = _els.firstBeatRow.hidden;
    const rate = playbackRate(_plan, audio);

    const count = _plan.gestureIds.length;
    const targets = targetFingerIndexes().map(index => FINGER_LABELS[index]);
    const times = beatTimes(_plan, audio, rate);
    const lastTime = times[times.length - 1];
    const durationSeconds = lastTime === undefined ? 0 : Math.ceil((lastTime + _plan.hitWindowMs + 900) / 1000);
    _els.count.textContent = `${count} ${_plural(count, _t('выбран'), _t('выбрано'), _t('выбрано'))}`;
    _els.targets.textContent = targets.length ? targets.join(', ') : _t('Не выбраны');
    _els.total.textContent = _t`${times.length} действий`;
    _els.duration.textContent = _t`${durationSeconds} сек`;
    _els.bpmValue.textContent = `${Math.round(sourceBpm(_plan, audio) * rate)} BPM`;
    _els.fallValue.textContent = _t`${(REFERENCE_APPROACH_MS / rate / 1000).toFixed(1)} с`;
    _els.windowValue.textContent = _t`±${_plan.hitWindowMs} мс`;
    _els.actionValue.textContent = String(_plan.actionCount);
    _els.seedValue.textContent = `Seed ${_plan.seed}`;
    _els.start.disabled = count === 0 || _els.addAudio.disabled;
    _els.error.textContent = '';
    _renderPreview(times.length);
  }

  function _syncFields() {
    _els.name.value = _plan.name;
    const nativeBpm = audioPreset(_plan.audioId).defaultBpm;
    _els.bpm.min = Math.min(30, nativeBpm);
    _els.bpm.max = Math.max(180, nativeBpm);
    _els.bpm.value = _plan.bpm;
    _els.sourceBpm.value = _plan.sourceBpm;
    _els.firstBeat.value = _plan.firstBeatMs;
    _els.fall.value = _plan.fallDurationMs;
    _els.window.value = _plan.hitWindowMs;
    _els.actionCount.value = _plan.actionCount;
    _els.mode.value = _plan.generationMode;
  }

  function _readFields() {
    _stopPreview?.();
    _plan = normalizePlan({
      ..._plan,
      name: _els.name.value,
      bpm: _els.bpm.value,
      sourceBpm: _els.sourceBpm.value,
      firstBeatMs: _els.firstBeat.value,
      fallDurationMs: _els.fall.value,
      hitWindowMs: _els.window.value,
      actionCount: _els.actionCount.value,
      generationMode: _els.mode.value,
    });
    _syncFields();
    savePlan(_plan);
    _render();
  }

  function init(onStart, bindPreview) {
    _onStart = onStart;
    _els = {
      name: document.getElementById('exercise-name'),
      grid: document.getElementById('exercise-gesture-grid'),
      count: document.getElementById('exercise-selected-count'),
      audioGrid: document.getElementById('exercise-audio-presets'),
      customCard: document.getElementById('exercise-upload-card'),
      audioInput: document.getElementById('exercise-audio-input'),
      audioPreview: document.getElementById('exercise-audio-preview'),
      audioLoop: document.getElementById('exercise-audio-loop'),
      firstBeat: document.getElementById('exercise-first-beat'),
      sourceBpm: document.getElementById('exercise-source-bpm'),
      sourceBpmRow: document.getElementById('exercise-source-bpm-row'),
      firstBeatRow: document.getElementById('exercise-first-beat-row'),
      audioStatus: document.getElementById('exercise-audio-status'),
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
    if (_plan.audioId === 'custom' && !_customAudio) _plan = normalizePlan({ ..._plan, audioId: DEFAULT_PLAN.audioId });
    _buildGestureGrid();
    _renderAudioCards();
    _syncFields();
    _render();

    _els.name.addEventListener('change', _readFields);
    [_els.bpm, _els.fall, _els.window, _els.actionCount].forEach(input => {
      input.addEventListener('input', _readFields);
    });
    _els.mode.addEventListener('change', _readFields);
    _els.firstBeat.addEventListener('change', _readFields);
    _els.sourceBpm.addEventListener('change', _readFields);
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
    _stopPreview = bindPreview(_els.audioPreview, _els.audioStatus, () => {
      const audio = audioPreset(_plan.audioId);
      return {
        audioUrl: audio.audioUrl,
        trackDurationMs: audio.trackDurationMs,
        midiNotes: audio.midiNotes,
        playbackRate: playbackRate(_plan, audio),
        audioRhythm: audio.rhythm ? { bpm: audio.defaultBpm * playbackRate(_plan, audio), anchorMs: 0 } : null,
      };
    });
    _els.audioLoop.addEventListener('change', () => {
      _plan.audioLoop = _els.audioLoop.checked;
      savePlan(_plan);
      _render();
    });
    _els.addAudio.addEventListener('click', async () => {
      const file = _els.audioInput.files[0];
      _els.uploadError.textContent = '';
      if (!file) {
        _els.uploadError.textContent = _t('Выбери аудиофайл.');
        return;
      }
      _stopPreview?.();
      const isMidi = /\.midi?$/i.test(file.name) || file.type === 'audio/midi';
      const audioUrl = isMidi ? null : URL.createObjectURL(file);
      _els.addAudio.disabled = true;
      _els.addAudio.textContent = _t('Файл проверяется…');
      _render();
      let source;
      try {
        source = isMidi
          ? MidiFile.parse(await file.arrayBuffer())
          : { trackDurationMs: await AudioPlayer.validateFile(audioUrl), defaultBpm: _plan.bpm };
      } catch (_) {
        source = null;
      }
      _els.addAudio.disabled = false;
      _els.addAudio.textContent = _t('Выбрать аудио');
      _render();
      if (!source?.trackDurationMs || _els.audioInput.files[0] !== file) {
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        if (_els.audioInput.files[0] === file) {
          _els.uploadError.textContent = _t('Этот аудиофайл не открывается. Попробуй другой.');
        }
        return;
      }
      _stopPreview?.();
      if (_customAudio?.audioUrl) URL.revokeObjectURL(_customAudio.audioUrl);
      _customAudio = {
        id: 'custom',
        name: file.name.replace(/\.[^.]+$/, ''),
        emoji: '🎧',
        description: _t('Локальный аудиофайл'),
        audioUrl,
        ...source,
      };
      _plan = normalizePlan({
        ..._plan, audioId: 'custom', bpm: source.defaultBpm, sourceBpm: source.defaultBpm, firstBeatMs: 0,
      });
      _syncFields();
      savePlan(_plan);
      _els.addAudio.textContent = _t('✓ Аудио выбрано');
      _render();
    });
    _els.start.addEventListener('click', () => {
      _readFields();
      try {
        const session = createSession(_plan);
        if (_onStart) _onStart(session);
      } catch (error) {
        _els.error.textContent = error.message || _t('Не удалось создать тренировку.');
      }
    });
  }

  function enter() {
    if (!_els) return;
    _plan = loadPlan();
    if (_plan.audioId === 'custom' && !_customAudio) _plan = normalizePlan({ ..._plan, audioId: DEFAULT_PLAN.audioId });
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
