/** Screen routing, quick training presets, settings, and game HUD. */
const App = (() => {
  let _currentScreen = 'home';
  let _loadedSession = null;

  function showScreen(id) {
    if (_currentScreen === 'diag') Diagnostics.leave();
    if (_currentScreen === 'game') Game.pause();

    document.querySelectorAll('.screen').forEach(screen => screen.classList.remove('active'));
    document.getElementById(`screen-${id}`)?.classList.add('active');
    _currentScreen = id;

    if (id === 'diag') Diagnostics.enter();
    if (id === 'exercise') ExerciseBuilder.enter();
    if (id === 'game' && _loadedSession) {
      const hudName = document.getElementById('hud-song-name');
      if (hudName) hudName.textContent = _loadedSession.name;
      const details = _loadedSession.exercise
        ? `${_loadedSession.exercise.bpm} BPM · ${_loadedSession.exercise.actionCount} жестов · падение ${(_loadedSession.approachTimeMs / 1000).toFixed(1)} с`
        : _loadedSession.name;
      _showGameOverlay('Готов?', details, 'Поехали!', () => Game.start(_loadedSession));
    }
  }

  function _initHomePreview() {
    const fills = [0, 1, 2, 3, 4].map(index => document.getElementById(`hp-f${index}`));
    const dot = document.getElementById('esp-dot');
    const label = document.getElementById('esp-status-label');
    const max = 4095;

    ESP32.onData((sensors, status) => {
      const values = [sensors.keyPinch, sensors.indexThumb, sensors.middleThumb, sensors.ring, sensors.little];
      values.forEach((value, index) => {
        if (fills[index]) fills[index].style.width = `${(value / max * 100).toFixed(1)}%`;
      });
      dot.className = `esp-dot${status === 'connected' ? ' connected' : status === 'error' ? ' error' : ''}`;
      label.textContent = status === 'connected' ? 'Перчатка FlortteGlove подключена'
        : status === 'connecting' ? 'Подключение Bluetooth…'
        : status === 'error' ? `Bluetooth: ${ESP32.lastError}`
        : 'Bluetooth не подключён';
      label.title = ESP32.lastError || ESP32.lastUrl;
    });
  }

  function _buildQuickTrainingList() {
    const container = document.getElementById('song-list');
    if (!container) return;
    container.innerHTML = '';

    ExerciseBuilder.audioPresets()
      .filter(preset => preset.id !== 'none')
      .forEach((preset) => {
        const card = document.createElement('section');
        card.className = 'song-card quick-training-card';
        card.innerHTML = `
          <div class="song-card-main">
            <div class="song-thumb"></div>
            <div class="song-info">
              <div class="song-title"></div>
              <div class="song-meta"></div>
            </div>
            <button class="btn-primary song-play-button" type="button">Начать</button>
          </div>
          <p class="song-card-error" role="alert"></p>`;
        card.querySelector('.song-thumb').textContent = preset.emoji;
        card.querySelector('.song-title').textContent = preset.name;
        card.querySelector('.song-meta').textContent = `30 жестов · ${preset.defaultBpm} BPM · сбалансированный набор`;
        const button = card.querySelector('.song-play-button');
        const error = card.querySelector('.song-card-error');
        button.addEventListener('click', () => {
          error.textContent = '';
          try {
            _loadedSession = ExerciseBuilder.createQuickTraining(preset.id, undefined, {
              fallDurationMs: Game.getApproachTime(),
              hitWindowMs: Game.getWindow(),
            });
            showScreen('game');
          } catch (caught) {
            error.textContent = caught.message || 'Не удалось создать тренировку.';
          }
        });
        container.appendChild(card);
      });
  }

  function _showGameOverlay(title, sub, buttonText, onButton, secondaryText = '', onSecondary = null) {
    const overlay = document.getElementById('game-overlay');
    const titleElement = document.getElementById('overlay-title');
    const subtitle = document.getElementById('overlay-sub');
    const button = document.getElementById('overlay-btn');
    const secondary = document.getElementById('overlay-secondary-btn');

    titleElement.textContent = title;
    subtitle.textContent = sub;
    button.textContent = buttonText;
    overlay.classList.remove('hidden');
    button.onclick = () => {
      overlay.classList.add('hidden');
      if (onButton) onButton();
    };
    secondary.textContent = secondaryText;
    secondary.classList.toggle('hidden', !secondaryText);
    secondary.onclick = secondaryText ? () => {
      overlay.classList.add('hidden');
      if (onSecondary) onSecondary();
    } : null;
  }

  function _bindGameHud() {
    const scoreElement = document.getElementById('hud-score');
    const comboElement = document.getElementById('hud-combo');
    Game.onScoreChange(({ score, combo }) => {
      scoreElement.textContent = score.toLocaleString();
      comboElement.textContent = combo > 1 ? `x${combo}` : '';
    });

    Game.onEnd(({ score, hits, totalNotes, successPercent, timing }) => {
      const timingText = timing?.meanErrorMs !== null
        && timing?.meanErrorMs !== undefined
        && Number.isFinite(Number(timing.meanErrorMs))
        ? ` · MTE: ${Number(timing.meanErrorMs).toFixed(1)} мс · SD: ${Number(timing.variabilityMs).toFixed(1)} мс`
        : '';
      _showGameOverlay(
        '🎉 Тренировка завершена!',
        `Счёт: ${score.toLocaleString()} · Успех: ${successPercent}% · ${hits} из ${totalNotes} плиток${timingText}`,
        'Повторить тренировку',
        () => {
          if (_loadedSession) Game.start(_loadedSession);
        },
        'Выйти в меню',
        () => {
          Game.stop();
          showScreen('home');
        }
      );
    });
  }

  function _bindSettings() {
    const bluetoothButton = document.getElementById('settings-bluetooth-connect');
    const approachInput = document.getElementById('settings-approach');
    const approachValue = document.getElementById('settings-approach-val');
    const windowInput = document.getElementById('settings-window');
    const windowValue = document.getElementById('settings-window-val');
    const volumeInput = document.getElementById('settings-vol');
    const volumeValue = document.getElementById('settings-vol-val');
    const saveButton = document.getElementById('settings-save');
    if (!saveButton) return;

    const readNumber = (input, min, max, fallback) => {
      const numeric = /^\d+$/.test(String(input.value || '').trim()) ? parseInt(input.value, 10) : NaN;
      const value = Number.isFinite(numeric) ? Math.max(min, Math.min(max, numeric)) : fallback;
      input.value = value;
      input.classList.remove('input-error');
      return value;
    };
    const markNumber = (input, min, max) => {
      const numeric = /^\d+$/.test(String(input.value || '').trim()) ? parseInt(input.value, 10) : NaN;
      const valid = Number.isFinite(numeric) && numeric >= min && numeric <= max;
      input.classList.toggle('input-error', !valid);
    };

    approachInput.value = Game.getApproachTime();
    approachValue.textContent = `${Game.getApproachTime()} мс`;
    windowInput.value = Game.getWindow();
    windowValue.textContent = Game.getWindow();
    volumeInput.value = Math.round(AudioPlayer.getVolume() * 100);
    volumeValue.textContent = `${volumeInput.value}%`;

    approachInput.addEventListener('input', () => {
      markNumber(approachInput, 1000, 5000);
      approachValue.textContent = `${approachInput.value} мс`;
    });
    windowInput.addEventListener('input', () => {
      markNumber(windowInput, 100, 500);
      windowValue.textContent = windowInput.value;
    });
    volumeInput.addEventListener('input', () => {
      markNumber(volumeInput, 0, 100);
      volumeValue.textContent = `${volumeInput.value}%`;
    });

    saveButton.addEventListener('click', () => {
      const approach = readNumber(approachInput, 1000, 5000, Game.getApproachTime());
      const hitWindow = readNumber(windowInput, 100, 500, Game.getWindow());
      const volume = readNumber(volumeInput, 0, 100, Math.round(AudioPlayer.getVolume() * 100));
      Game.setApproachTime(approach);
      Game.setWindow(hitWindow);
      AudioPlayer.setVolume(volume / 100);
      approachValue.textContent = `${approach} мс`;
      windowValue.textContent = hitWindow;
      volumeValue.textContent = `${volume}%`;
      saveButton.textContent = '✓ Сохранено';
      setTimeout(() => { saveButton.textContent = 'Сохранить'; }, 1500);
    });

    bluetoothButton?.addEventListener('click', async () => {
      bluetoothButton.disabled = true;
      try {
        await ESP32.connect();
        bluetoothButton.textContent = '✓ FlortteGlove подключена';
      } catch (_) {
        bluetoothButton.textContent = ESP32.lastError || 'Ошибка Bluetooth';
      } finally {
        bluetoothButton.disabled = false;
      }
    });
  }

  function _wireNav() {
    const nav = (buttonId, target) => {
      document.getElementById(buttonId)?.addEventListener('click', () => showScreen(target));
    };
    nav('btn-play', 'songs');
    nav('btn-exercise', 'exercise');
    nav('btn-diag', 'diag');
    nav('btn-settings', 'settings');
    nav('songs-back', 'home');
    nav('exercise-back', 'home');
    nav('diag-back', 'home');
    nav('settings-back', 'home');

    document.getElementById('btn-bluetooth-connect')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await ESP32.connect();
        button.textContent = '✓ FlortteGlove подключена';
      } catch (_) {
        button.textContent = 'Повторить подключение';
      } finally {
        button.disabled = false;
      }
    });

    document.getElementById('game-back')?.addEventListener('click', () => {
      const wasActive = Game.isActive();
      if (wasActive) Game.pause();
      _showGameOverlay(
        'Выйти из игры?',
        'Текущий результат этой попытки не сохранится.',
        'Продолжить игру',
        () => {
          if (wasActive) Game.resume();
          else showScreen('game');
        },
        'Выйти в меню',
        () => {
          Game.stop();
          showScreen('home');
        }
      );
    });
  }

  function _wireDebugKeys() {
    const fingerKeyMap = {
      KeyA: { index: 0, label: 'Большой' },
      KeyS: { index: 1, label: 'Указательный' },
      KeyD: { index: 2, label: 'Средний' },
      KeyF: { index: 3, label: 'Безымянный' },
      KeyG: { index: 4, label: 'Мизинец' },
    };
    const comboByCode = {
      Digit0: { bits: [0, 0, 0, 0, 0], label: 'Кулак' },
      Digit1: { bits: [1, 1, 0, 0, 0], label: 'Указательный + большой' },
      Digit2: { bits: [1, 0, 0, 0, 0], label: 'Только большой' },
      Digit3: { bits: [0, 1, 0, 0, 0], label: 'Только указательный' },
      Digit4: { bits: [0, 1, 1, 0, 0], label: 'Указательный + средний' },
      Digit5: { bits: [0, 1, 1, 1, 0], label: 'Три пальца' },
      Digit6: { bits: [0, 1, 1, 1, 1], label: 'Четыре пальца' },
      Digit8: { bits: [1, 1, 1, 0, 0], label: 'Три пальца с большим' },
      Digit9: { bits: [1, 1, 1, 1, 1], label: 'Открытая ладонь' },
    };
    Object.keys(comboByCode).forEach((code) => {
      comboByCode[code.replace('Digit', 'Numpad')] = comboByCode[code];
    });
    const heldFingerBits = [0, 0, 0, 0, 0];
    const heldCombos = new Map();
    const isTyping = target => target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
    const makeValues = bits => ({
      keyPinch: bits[0] ? 50 : 3600,
      indexThumb: bits[1] ? 50 : 3600,
      middleThumb: bits[2] ? 50 : 3600,
      ring: bits[3] ? 50 : 3600,
      little: bits[4] ? 50 : 3600,
    });
    const currentBits = () => {
      const combos = Array.from(heldCombos.values());
      return combos.length ? combos[combos.length - 1].bits : heldFingerBits;
    };
    const emit = () => ESP32.injectSensors(makeValues(currentBits()));

    document.addEventListener('keydown', (event) => {
      if (isTyping(event.target)) return;
      const combo = comboByCode[event.code];
      if (combo) {
        if (event.repeat && heldCombos.has(event.code)) return;
        event.preventDefault();
        heldCombos.set(event.code, combo);
        emit();
        AudioPlayer.resumeCtx();
        return;
      }
      const finger = fingerKeyMap[event.code];
      if (!finger || event.repeat) return;
      event.preventDefault();
      heldFingerBits[finger.index] = 1;
      emit();
      AudioPlayer.resumeCtx();
    });

    document.addEventListener('keyup', (event) => {
      if (isTyping(event.target)) return;
      if (comboByCode[event.code]) {
        event.preventDefault();
        heldCombos.delete(event.code);
        emit();
        return;
      }
      const finger = fingerKeyMap[event.code];
      if (!finger) return;
      event.preventDefault();
      heldFingerBits[finger.index] = 0;
      emit();
    });
  }

  function init() {
    Diagnostics.init();
    GloveSettings.init();
    Game.init();
    ExerciseBuilder.init((session) => {
      _loadedSession = session;
      showScreen('game');
    });
    _initHomePreview();
    _buildQuickTrainingList();
    _bindGameHud();
    _bindSettings();
    _wireNav();
    _wireDebugKeys();
    ESP32.start();
    document.addEventListener('click', () => AudioPlayer.resumeCtx(), { once: true });
    showScreen('home');
  }

  document.addEventListener('DOMContentLoaded', init);
  return { showScreen };
})();
