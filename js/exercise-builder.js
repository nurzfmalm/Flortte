/** Build and persist individual gesture exercise plans. */
const ExerciseBuilder = (() => {
  const STORAGE_KEY = 'flortte_exercise_plan_v1';
  const FINGER_LABELS = ['Большой', 'Указательный', 'Средний', 'Безымянный', 'Мизинец'];
  const DEFAULT_PLAN = {
    name: 'Моя тренировка',
    gestureIds: [],
    repetitions: 3,
    intervalMs: 2800,
    tempoPercent: 70,
    gestureCount: 0,
  };

  let _plan = { ...DEFAULT_PLAN, gestureIds: [] };
  let _onStart = null;
  let _els = null;
  let _builtInSongPromise = null;
  let _selectedSong = null;
  let _customAudioUrl = null;
  let _sourceActionCount = 1;

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
      tempoPercent: _clamp(raw.tempoPercent, 25, 200, DEFAULT_PLAN.tempoPercent),
      gestureCount: _clamp(raw.gestureCount, 0, 999, DEFAULT_PLAN.gestureCount),
    };
  }

  function _groupMidiNotes(sourceNotes = []) {
    const groups = [];
    [...sourceNotes]
      .filter(note => Number.isFinite(Number(note.time)) && Number.isFinite(Number(note.note)))
      .sort((a, b) => Number(a.time) - Number(b.time))
      .forEach((note) => {
        const lastGroup = groups[groups.length - 1];
        if (lastGroup && Math.abs(Number(note.time) - lastGroup.time) <= 24) {
          lastGroup.notes.push(note);
          return;
        }
        groups.push({ time: Number(note.time), notes: [note] });
      });
    return groups;
  }

  function _evenlySpacedIndexes(total, requested) {
    const count = Math.max(0, Math.min(total, requested));
    if (!count) return new Set();
    if (count === total) return new Set(Array.from({ length: total }, (_, index) => index));
    if (count === 1) return new Set([Math.floor((total - 1) / 2)]);

    const indexes = new Set();
    for (let index = 0; index < count; index++) {
      indexes.add(Math.round(index * (total - 1) / (count - 1)));
    }
    return indexes;
  }

  function countSongActions(song) {
    return _groupMidiNotes(song?.notes).length;
  }

  function configureSong(sourceSong, rawSettings = {}) {
    if (!sourceSong || !Array.isArray(sourceSong.notes) || !sourceSong.notes.length) {
      throw new Error('В выбранной песне нет игровых нот.');
    }

    const tempoPercent = _clamp(rawSettings.tempoPercent, 25, 200, DEFAULT_PLAN.tempoPercent);
    const playableIndexes = [];
    sourceSong.notes.forEach((note, index) => {
      if (Number.isInteger(note.lane)) playableIndexes.push(index);
    });
    if (!playableIndexes.length) throw new Error('В выбранной песне нет доступных жестов.');

    const requested = _clamp(rawSettings.gestureCount, 0, playableIndexes.length, 0);
    const actionCount = requested || playableIndexes.length;
    const selectedPositions = _evenlySpacedIndexes(playableIndexes.length, actionCount);
    const selectedNoteIndexes = new Set(
      [...selectedPositions].map(position => playableIndexes[position])
    );
    const notes = sourceSong.notes.map((note, index) => ({
      ...note,
      lane: selectedNoteIndexes.has(index) ? note.lane : null,
    }));

    return {
      ...sourceSong,
      notes,
      preserveLanes: true,
      playbackRate: tempoPercent / 100,
      songSettings: {
        tempoPercent,
        gestureCount: actionCount,
        totalActions: playableIndexes.length,
      },
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
      playbackRate: plan.tempoPercent / 100,
      exercise: {
        repetitions: plan.repetitions,
        intervalMs: plan.intervalMs,
        tempoPercent: plan.tempoPercent,
        sequence: [...plan.gestureIds],
        targetFingers: targetFingerIndexes(plan, catalogue),
      },
    };
  }

  function createSongFromMidi(rawPlan, sourceSong, catalogue = _catalogue()) {
    const plan = normalizePlan(rawPlan, catalogue);
    if (!plan.gestureIds.length) throw new Error('Выбери хотя бы один жест.');
    if (!sourceSong || !Array.isArray(sourceSong.notes) || !sourceSong.notes.length) {
      throw new Error('В выбранном MIDI нет нот.');
    }

    const selectedSet = new Set(plan.gestureIds);
    const activeGestures = catalogue.filter(gesture => selectedSet.has(gesture.id));
    const gestureById = new Map(catalogue.map(gesture => [gesture.id, gesture]));
    const laneById = new Map(activeGestures.map((gesture, index) => [gesture.id, index]));
    const noteGroups = _groupMidiNotes(sourceSong.notes);
    const actionCount = plan.gestureCount
      ? Math.min(plan.gestureCount, noteGroups.length)
      : noteGroups.length;
    const selectedGroupIndexes = _evenlySpacedIndexes(noteGroups.length, actionCount);
    let selectedIndex = 0;

    const notes = noteGroups.map((group, index) => {
      const isSelected = selectedGroupIndexes.has(index);
      const gestureId = isSelected
        ? plan.gestureIds[selectedIndex++ % plan.gestureIds.length]
        : null;
      const gesture = gestureById.get(gestureId);
      const representative = group.notes.reduce((highest, note) =>
        Number(note.note) > Number(highest.note) ? note : highest
      );
      return {
        time: group.time,
        duration: Math.max(...group.notes.map(note => Number(note.duration) || 300)),
        note: Number(representative.note),
        noteName: typeof Gestures !== 'undefined' && Gestures.midiToName
          ? Gestures.midiToName(Number(representative.note))
          : String(representative.note),
        velocity: Math.max(...group.notes.map(note => Number(note.velocity) || 80)),
        lane: isSelected ? laneById.get(gestureId) : null,
        gestureId,
      };
    });

    return {
      name: plan.name,
      notes,
      durationMs: Number(sourceSong.durationMs) || notes.reduce((max, note) => Math.max(max, note.time + note.duration), 0) + 1000,
      preserveLanes: true,
      gestureIds: activeGestures.map(gesture => gesture.id),
      audioUrl: sourceSong.audioUrl || null,
      audioName: sourceSong.audioName || null,
      playbackRate: plan.tempoPercent / 100,
      exercise: {
        sequence: [...plan.gestureIds],
        targetFingers: targetFingerIndexes(plan, catalogue),
        sourceName: sourceSong.name || 'Своя песня',
        simultaneousNotesCombined: true,
        tempoPercent: plan.tempoPercent,
        gestureCount: actionCount,
        totalSourceActions: noteGroups.length,
      },
    };
  }

  function _loadBuiltInSong() {
    if (!_builtInSongPromise) {
      _builtInSongPromise = MidiPlayer.loadUrl('assets/midi/potter.mid').then((song) => ({
        ...song,
        name: 'Harry Potter Theme',
        audioUrl: 'assets/audio/potter.mp3',
        audioName: 'potter.mp3',
      })).catch((error) => {
        _builtInSongPromise = null;
        throw error;
      });
    }
    return _builtInSongPromise;
  }

  function _selectBuiltInMusic() {
    _selectedSong = null;
    _els?.potter?.classList.add('selected');
    _els?.potter?.setAttribute('aria-pressed', 'true');
    _els?.uploadCard?.classList.remove('selected');
    if (_els?.musicState) _els.musicState.textContent = 'Гарри Поттер выбран';
    _render();
    _refreshSongLimits();
  }

  function _selectCustomMusic(song, audioFile) {
    if (_customAudioUrl) URL.revokeObjectURL(_customAudioUrl);
    _customAudioUrl = URL.createObjectURL(audioFile);
    _selectedSong = {
      ...song,
      audioUrl: _customAudioUrl,
      audioName: audioFile.name,
    };
    _els.potter.classList.remove('selected');
    _els.potter.setAttribute('aria-pressed', 'false');
    _els.uploadCard.classList.add('selected');
    _els.musicState.textContent = `${_selectedSong.name} выбрана`;
    _render();
    _refreshSongLimits();
  }

  async function _selectedSourceSong() {
    return _selectedSong || _loadBuiltInSong();
  }

  function _setSyncedControl(range, number, value) {
    if (range) range.value = value;
    if (number) number.value = value;
  }

  function _syncActionControls() {
    if (!_els) return;
    const useAll = _plan.gestureCount === 0;
    const exactCount = useAll
      ? _sourceActionCount
      : Math.max(1, Math.min(_sourceActionCount, _plan.gestureCount));
    _els.allActions.checked = useAll;
    [_els.actionRange, _els.actionNumber].forEach((input) => {
      input.min = '1';
      input.max = String(_sourceActionCount);
      input.disabled = useAll;
    });
    _setSyncedControl(_els.actionRange, _els.actionNumber, exactCount);
    _els.actionValue.textContent = useAll
      ? `Все, ${_sourceActionCount}`
      : `${exactCount} из ${_sourceActionCount}`;
  }

  async function _refreshSongLimits() {
    if (!_els) return;
    try {
      const sourceSong = await _selectedSourceSong();
      _sourceActionCount = Math.max(1, countSongActions(sourceSong));
      if (_plan.gestureCount > _sourceActionCount) _plan.gestureCount = _sourceActionCount;
      _syncActionControls();
      _render();
    } catch (_) {
      _sourceActionCount = 1;
      _syncActionControls();
    }
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
    const actions = count ? 'По ритму MIDI' : '0 действий';
    const targetNames = targetFingerIndexes().map(index => FINGER_LABELS[index]);
    _els.count.textContent = `${count} ${_plural(count, 'выбран', 'выбрано', 'выбрано')}`;
    _els.targets.textContent = targetNames.length ? targetNames.join(', ') : 'Не выбраны';
    _els.total.textContent = _plan.gestureCount
      ? `${Math.min(_plan.gestureCount, _sourceActionCount)} действий`
      : actions;
    const sourceDuration = _selectedSong?.durationMs || 34666;
    const adjustedMinutes = sourceDuration / (_plan.tempoPercent / 100) / 60000;
    _els.duration.textContent = `${Math.max(1, Math.ceil(adjustedMinutes))} мин`;
    _els.tempoValue.textContent = `${_plan.tempoPercent}%`;
    _syncActionControls();
    _els.start.disabled = count === 0;
    _els.error.textContent = '';
  }

  function _syncFields() {
    _els.name.value = _plan.name;
    if (_els.repetitions) _els.repetitions.value = _plan.repetitions;
    if (_els.interval) _els.interval.value = String(_plan.intervalMs);
    _setSyncedControl(_els.tempoRange, _els.tempoNumber, _plan.tempoPercent);
    _syncActionControls();
  }

  function _readFields() {
    _plan = normalizePlan({
      ..._plan,
      name: _els.name.value,
      repetitions: _els.repetitions?.value ?? _plan.repetitions,
      intervalMs: _els.interval?.value ?? _plan.intervalMs,
      tempoPercent: _els.tempoNumber.value,
      gestureCount: _els.allActions.checked ? 0 : _els.actionNumber.value,
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
      potter: document.getElementById('exercise-music-potter'),
      musicState: document.getElementById('exercise-music-state'),
      uploadCard: document.getElementById('exercise-upload-card'),
      midiInput: document.getElementById('exercise-midi-input'),
      audioInput: document.getElementById('exercise-audio-input'),
      addMusic: document.getElementById('exercise-add-music'),
      uploadError: document.getElementById('exercise-upload-error'),
      tempoRange: document.getElementById('exercise-tempo-range'),
      tempoNumber: document.getElementById('exercise-tempo-number'),
      tempoValue: document.getElementById('exercise-tempo-value'),
      allActions: document.getElementById('exercise-all-actions'),
      actionRange: document.getElementById('exercise-action-range'),
      actionNumber: document.getElementById('exercise-action-number'),
      actionValue: document.getElementById('exercise-action-value'),
    };
    if (!_els.grid) return;

    _plan = loadPlan();
    _buildGestureGrid();
    _syncFields();
    _render();

    _els.name.addEventListener('change', _readFields);
    _els.repetitions?.addEventListener('change', _readFields);
    _els.interval?.addEventListener('change', _readFields);
    const syncTempo = (source) => {
      const value = _clamp(source.value, 25, 200, _plan.tempoPercent);
      _setSyncedControl(_els.tempoRange, _els.tempoNumber, value);
      _plan.tempoPercent = value;
      savePlan(_plan);
      _render();
    };
    _els.tempoRange.addEventListener('input', () => syncTempo(_els.tempoRange));
    _els.tempoNumber.addEventListener('input', () => syncTempo(_els.tempoNumber));
    const syncActionCount = (source) => {
      const value = _clamp(source.value, 1, _sourceActionCount, _sourceActionCount);
      _setSyncedControl(_els.actionRange, _els.actionNumber, value);
      _plan.gestureCount = value;
      savePlan(_plan);
      _render();
    };
    _els.actionRange.addEventListener('input', () => syncActionCount(_els.actionRange));
    _els.actionNumber.addEventListener('input', () => syncActionCount(_els.actionNumber));
    _els.allActions.addEventListener('change', () => {
      _plan.gestureCount = _els.allActions.checked
        ? 0
        : _clamp(_els.actionNumber.value, 1, _sourceActionCount, _sourceActionCount);
      savePlan(_plan);
      _render();
    });
    _els.clear.addEventListener('click', () => {
      _plan.gestureIds = [];
      savePlan(_plan);
      _render();
    });
    _els.potter?.addEventListener('click', _selectBuiltInMusic);
    _els.addMusic?.addEventListener('click', async () => {
      const midiFile = _els.midiInput.files[0];
      const audioFile = _els.audioInput.files[0];
      _els.uploadError.textContent = '';
      if (!midiFile || !audioFile) {
        _els.uploadError.textContent = 'Выбери оба файла: MIDI и аудио.';
        return;
      }
      _els.addMusic.disabled = true;
      _els.addMusic.textContent = 'Загрузка…';
      try {
        const song = await MidiPlayer.loadFile(midiFile);
        _selectCustomMusic(song, audioFile);
        _els.addMusic.textContent = '✓ Песня добавлена';
      } catch (_) {
        _els.uploadError.textContent = 'MIDI не открылся. Проверь файл и попробуй снова.';
        _els.addMusic.textContent = 'Добавить песню';
      } finally {
        _els.addMusic.disabled = false;
      }
    });
    _els.start.addEventListener('click', async () => {
      _readFields();
      _els.start.disabled = true;
      _els.start.textContent = 'Подготовка…';
      try {
        const sourceSong = await _selectedSourceSong();
        const song = createSongFromMidi(_plan, sourceSong);
        if (_onStart) _onStart(song);
      } catch (error) {
        _els.error.textContent = error.message || 'Не удалось создать тренировку.';
      } finally {
        _els.start.textContent = 'Начать тренировку';
        _render();
      }
    });
    _refreshSongLimits();
  }

  function enter() {
    if (!_els) return;
    _plan = loadPlan();
    _buildGestureGrid();
    _syncFields();
    _render();
    _refreshSongLimits();
  }

  return {
    init,
    enter,
    normalizePlan,
    loadPlan,
    savePlan,
    targetFingerIndexes,
    countSongActions,
    configureSong,
    createSong,
    createSongFromMidi,
  };
})();
