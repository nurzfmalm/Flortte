/**
 * app.js — Screen router, home screen live preview, settings, song list
 *
 * Screen IDs: home | songs | exercise | game | diag | settings
 * Navigation is hash-based but fully managed here (no page reloads).
 */

const App = (() => {
  // ── Built-in song catalogue (MIDI files in assets/midi/) ──
  const BUILT_IN_SONGS = [
    {
      name: 'Harry Potter Theme',
      file: 'assets/midi/potter.mid',
      audio: 'assets/audio/potter.mp3',
      emoji: '🧙',
    },
  ];

  let _currentScreen = 'home';
  let _loadedSong    = null;
  let _customSongs   = []; // user-uploaded MIDI and optional original audio

  // ── Screen switching ──────────────────────────────────────
  function showScreen(id) {
    // Leave hooks
    if (_currentScreen === 'diag')     Diagnostics.leave();
    if (_currentScreen === 'game')     Game.pause();

    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(`screen-${id}`)?.classList.add('active');
    _currentScreen = id;

    // Enter hooks
    if (id === 'diag') Diagnostics.enter();
    if (id === 'exercise') ExerciseBuilder.enter();
    if (id === 'game' && _loadedSong) {
      const hudName = document.getElementById('hud-song-name');
      if (hudName) hudName.textContent = _loadedSong.name;
      // show overlay first
      const typeLabel = _loadedSong.exercise ? 'Тренировка' : 'Песня';
      _showGameOverlay('Готов?', `${typeLabel}: ${_loadedSong.name}`, 'Поехали!', () => {
        Game.start(_loadedSong);
      });
    }
  }

  // ── Home screen live sensor bars ─────────────────────────
  function _initHomePreview() {
    const fills = [
      document.getElementById('hp-f0'),
      document.getElementById('hp-f1'),
      document.getElementById('hp-f2'),
      document.getElementById('hp-f3'),
      document.getElementById('hp-f4'),
    ];
    const dot   = document.getElementById('esp-dot');
    const label = document.getElementById('esp-status-label');
    const MAX   = 4095;

    ESP32.onData((sensors, status) => {
      const vals = [sensors.keyPinch, sensors.indexThumb, sensors.middleThumb, sensors.ring, sensors.little];
      vals.forEach((v, i) => {
        if (fills[i]) fills[i].style.width = (v / MAX * 100).toFixed(1) + '%';
      });

      dot.className   = 'esp-dot' + (status === 'connected' ? ' connected' : status === 'error' ? ' error' : '');
      label.textContent = status === 'connected' ? 'Перчатка FlortteGlove подключена'
                        : status === 'connecting' ? 'Подключение Bluetooth…'
                        : status === 'error' ? `Bluetooth: ${ESP32.lastError}`
                        : 'Bluetooth не подключён';
      label.title = ESP32.lastError || ESP32.lastUrl;
    });
  }

  // ── Song list screen ──────────────────────────────────────
  function _buildSongList() {
    const container = document.getElementById('song-list');
    if (!container) return;

    function _renderList() {
      container.innerHTML = '';

      const all = [
        ...BUILT_IN_SONGS,
        ...(_customSongs.map(s => ({ name: s.name, _song: s, emoji: '🎵' }))),
      ];

      // Pair a MIDI chart with the user's licensed audio file.
      const uploadCard = document.createElement('section');
      uploadCard.className = 'upload-card';
      uploadCard.innerHTML = `
        <div class="upload-icon">🎧</div>
        <div class="upload-copy"><h3>Добавь свою песню</h3><p>Выбери MIDI с нотами и аудио с оригинальным звучанием.</p></div>
        <label class="file-pick"><span>1. MIDI</span><input type="file" accept=".mid,.midi,audio/midi" id="midi-upload-input" /></label>
        <label class="file-pick"><span>2. Аудио</span><input type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac" id="audio-upload-input" /></label>
        <button class="btn-primary upload-song-btn" type="button">Добавить песню</button>
        <p class="upload-error" role="alert"></p>`;
      uploadCard.querySelector('.upload-song-btn').addEventListener('click', async () => {
        const midiFile = uploadCard.querySelector('#midi-upload-input').files[0];
        const audioFile = uploadCard.querySelector('#audio-upload-input').files[0];
        const error = uploadCard.querySelector('.upload-error');
        error.textContent = '';
        if (!midiFile || !audioFile) { error.textContent = 'Выбери оба файла: MIDI и аудио.'; return; }
        try { const song = await MidiPlayer.loadFile(midiFile); song.audioUrl = URL.createObjectURL(audioFile); song.audioName = audioFile.name; _customSongs.push(song); _renderList(); }
        catch (err) { error.textContent = 'MIDI не открылся. Проверь файл и попробуй снова.'; }
      });
      container.appendChild(uploadCard);

      all.forEach(entry => {
        const card = document.createElement('div');
        card.className = 'song-card';
        const noteCount = entry._song
          ? entry._song.notes.filter(n => n.lane !== null).length
          : '…';
        const dur = entry._song
          ? Math.ceil(entry._song.durationMs / 1000) + 's'
          : '';
        card.innerHTML = `
          <div class="song-thumb">${entry.emoji}</div>
          <div class="song-info">
            <div class="song-title">${entry.name}</div>
            <div class="song-meta">${entry._song ? `${noteCount} нот · ${dur} · ${entry._song.audioUrl ? 'оригинальное аудио' : 'MIDI-звук'}` : 'Учебная версия'}</div>
          </div>
          <span class="song-arrow">›</span>
        `;

        card.addEventListener('click', async () => {
          if (entry._song) {
            _loadedSong = entry._song;
            showScreen('game');
          } else {
            // Load built-in
            try {
              card.querySelector('.song-arrow').textContent = '…';
              const song = await MidiPlayer.loadUrl(entry.file);
              song.name = entry.name;
              if (entry.audio) {
                song.audioUrl = entry.audio;
                song.audioName = entry.audio.split('/').pop();
              }
              entry._song = song;
              _loadedSong = song;
              _renderList();
              showScreen('game');
            } catch (err) {
              alert('Не удалось загрузить: ' + err.message);
              card.querySelector('.song-arrow').textContent = '›';
            }
          }
        });

        container.appendChild(card);
      });
    }

    _renderList();
  }

  // ── Game overlay ──────────────────────────────────────────
  function _showGameOverlay(title, sub, btnText, onBtn, secondaryText = '', onSecondary = null) {
    const overlay = document.getElementById('game-overlay');
    const oTitle  = document.getElementById('overlay-title');
    const oSub    = document.getElementById('overlay-sub');
    const oBtn    = document.getElementById('overlay-btn');
    const secondaryBtn = document.getElementById('overlay-secondary-btn');

    oTitle.textContent = title;
    oSub.textContent   = sub;
    oBtn.textContent   = btnText;
    overlay.classList.remove('hidden');

    oBtn.onclick = () => {
      overlay.classList.add('hidden');
      if (onBtn) onBtn();
    };
    secondaryBtn.textContent = secondaryText;
    secondaryBtn.classList.toggle('hidden', !secondaryText);
    secondaryBtn.onclick = secondaryText ? () => {
      overlay.classList.add('hidden');
      if (onSecondary) onSecondary();
    } : null;
  }

  // ── Game HUD updates ──────────────────────────────────────
  function _bindGameHud() {
    const scoreEl = document.getElementById('hud-score');
    const comboEl = document.getElementById('hud-combo');
    Game.onScoreChange(({ score, combo }) => {
      scoreEl.textContent = score.toLocaleString();
      comboEl.textContent = combo > 1 ? `x${combo}` : '';
    });

    Game.onEnd(({ score, hits, totalNotes, successPercent, timing }) => {
      const isExercise = !!_loadedSong?.exercise;
      const timingText = timing?.meanErrorMs !== null
        && timing?.meanErrorMs !== undefined
        && Number.isFinite(Number(timing.meanErrorMs))
        ? ` · MTE: ${Number(timing.meanErrorMs).toFixed(1)} мс · SD: ${Number(timing.variabilityMs).toFixed(1)} мс`
        : '';
      _showGameOverlay(
        isExercise ? '🎉 Тренировка завершена!' : '🎉 Готово!',
        `Счёт: ${score.toLocaleString()} · Успех: ${successPercent}% · ${hits} из ${totalNotes} нот${timingText}`,
        isExercise ? 'Повторить тренировку' : 'Сыграть ещё',
        () => {
          if (_loadedSong) Game.start(_loadedSong);
        }
      );
    });
  }

  // ── Settings screen ───────────────────────────────────────
  function _bindSettings() {
    const bluetoothButton = document.getElementById('settings-bluetooth-connect');
    const speedInput = document.getElementById('settings-speed');
    const speedVal   = document.getElementById('settings-speed-val');
    const tempoInput = document.getElementById('settings-tempo');
    const tempoVal   = document.getElementById('settings-tempo-val');
    const winInput   = document.getElementById('settings-window');
    const winVal     = document.getElementById('settings-window-val');
    const volInput   = document.getElementById('settings-vol');
    const volVal     = document.getElementById('settings-vol-val');
    const saveBtn    = document.getElementById('settings-save');

    if (!saveBtn) return;

    const readBoundedNumber = (input, min, max, fallback) => {
      const text = String(input.value || '').trim();
      const numeric = /^\d+$/.test(text) ? parseInt(text, 10) : NaN;
      const value = Number.isFinite(numeric)
        ? Math.max(min, Math.min(max, numeric))
        : fallback;
      input.value = value;
      input.classList.remove('input-error');
      return value;
    };

    const markBoundedNumber = (input, min, max) => {
      const text = String(input.value || '').trim();
      const numeric = /^\d+$/.test(text) ? parseInt(text, 10) : NaN;
      const valid = Number.isFinite(numeric) && numeric >= min && numeric <= max;
      input.classList.toggle('input-error', !valid);
      return valid;
    };

    // Load current values
    speedInput.value = Game.getSpeed();
    speedVal.textContent = Game.getSpeed() + ' px/s';
    tempoInput.value = Math.round(MidiPlayer.getTempo() * 100);
    tempoVal.textContent = tempoInput.value + '%';
    winInput.value   = Game.getWindow();
    winVal.textContent   = Game.getWindow();
    volInput.value   = Math.round(MidiPlayer.getVolume() * 100);
    volVal.textContent   = Math.round(MidiPlayer.getVolume() * 100) + '%';

    tempoInput.addEventListener('input', () => { tempoVal.textContent = tempoInput.value + '%'; });
    speedInput.addEventListener('input', () => {
      markBoundedNumber(speedInput, 100, 600);
      speedVal.textContent = speedInput.value + ' px/s';
    });
    winInput.addEventListener('input',   () => {
      markBoundedNumber(winInput, 80, 400);
      winVal.textContent   = winInput.value;
    });
    volInput.addEventListener('input',   () => {
      markBoundedNumber(volInput, 0, 100);
      volVal.textContent   = volInput.value + '%';
    });

    saveBtn.addEventListener('click', () => {
      const speed = readBoundedNumber(speedInput, 100, 600, Game.getSpeed());
      const tempo = readBoundedNumber(tempoInput, 50, 100, Math.round(MidiPlayer.getTempo() * 100));
      const hitWindow = readBoundedNumber(winInput, 80, 400, Game.getWindow());
      const volume = readBoundedNumber(volInput, 0, 100, Math.round(MidiPlayer.getVolume() * 100));

      Game.setSpeed(speed);
      MidiPlayer.setTempo(tempo / 100);
      Game.setWindow(hitWindow);
      MidiPlayer.setVolume(volume / 100);
      speedVal.textContent = speed + ' px/s';
      tempoVal.textContent = tempo + '%';
      winVal.textContent = hitWindow;
      volVal.textContent = volume + '%';

      saveBtn.textContent = '✓ Сохранено';
      setTimeout(() => { saveBtn.textContent = 'Сохранить'; }, 1500);
    });

    bluetoothButton?.addEventListener('click', async () => {
      bluetoothButton.disabled = true;
      try { await ESP32.connect(); bluetoothButton.textContent = '✓ FlortteGlove подключена'; }
      catch (_) { bluetoothButton.textContent = ESP32.lastError || 'Ошибка Bluetooth'; }
      finally { bluetoothButton.disabled = false; }
    });
  }

  // ── Wire navigation buttons ───────────────────────────────
  function _wireNav() {
    const nav = (btnId, target) => {
      const el = document.getElementById(btnId);
      if (el) el.addEventListener('click', () => showScreen(target));
    };

    nav('btn-play',      'songs');
    nav('btn-exercise',  'exercise');
    nav('btn-diag',      'diag');
    nav('btn-settings',  'settings');
    nav('songs-back',    'home');
    nav('exercise-back', 'home');
    nav('diag-back',     'home');
    nav('settings-back', 'home');

    document.getElementById('btn-bluetooth-connect')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try { await ESP32.connect(); button.textContent = '✓ FlortteGlove подключена'; }
      catch (_) { button.textContent = 'Повторить подключение'; }
      finally { button.disabled = false; }
    });

    // Confirm leaving so an accidental tap does not erase the current session.
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

    const comboByKey = {
      '1': { bits: [1,1,0,0,0], label: '1. Указательный + большой' },
      '2': { bits: [1,0,0,0,0], label: '2. Только большой' },
      '3': { bits: [0,1,0,0,0], label: '3. Только указательный' },
      '4': { bits: [0,1,1,0,0], label: '4. Указательный + средний' },
      '5': { bits: [0,1,1,1,0], label: 'Три пальца без большого и мизинца' },
      '6': { bits: [0,1,1,1,1], label: 'Четыре пальца без большого' },
      '8': { bits: [1,1,1,0,0], label: '8. Указательный + средний + большой' },
      '0': { bits: [0,0,0,0,0], label: 'Кулак' },
      '9': { bits: [1,1,1,1,1], label: 'Открытая ладонь' },
    };

    const comboByCode = {
      Digit0: comboByKey['0'],
      Digit1: comboByKey['1'],
      Digit2: comboByKey['2'],
      Digit3: comboByKey['3'],
      Digit4: comboByKey['4'],
      Digit5: comboByKey['5'],
      Digit6: comboByKey['6'],
      Digit8: comboByKey['8'],
      Digit9: comboByKey['9'],
      Numpad0: comboByKey['0'],
      Numpad1: comboByKey['1'],
      Numpad2: comboByKey['2'],
      Numpad3: comboByKey['3'],
      Numpad4: comboByKey['4'],
      Numpad5: comboByKey['5'],
      Numpad6: comboByKey['6'],
      Numpad8: comboByKey['8'],
      Numpad9: comboByKey['9'],
    };

    const heldFingerBits = [0, 0, 0, 0, 0];
    const heldCombos = new Map();

    const makeValues = (bits) => ({
      keyPinch:    bits[0] ? 50 : 3600,
      indexThumb:  bits[1] ? 50 : 3600,
      middleThumb: bits[2] ? 50 : 3600,
      ring:        bits[3] ? 50 : 3600,
      little:      bits[4] ? 50 : 3600,
    });

    const isTypingTarget = (target) =>
      target && (target.isContentEditable || ['INPUT','TEXTAREA','SELECT'].includes(target.tagName));

    const getComboEntry = (event) => comboByCode[event.code] || comboByKey[event.key];

    const currentKeyboardBits = () => {
      const activeCombos = Array.from(heldCombos.values());
      return activeCombos.length ? activeCombos[activeCombos.length - 1].bits : heldFingerBits;
    };

    const emitKeyboardSensors = () => {
      ESP32.injectSensors(makeValues(currentKeyboardBits()));
    };

    document.addEventListener('keydown', (event) => {
      if (isTypingTarget(event.target)) return;

      const comboEntry = getComboEntry(event);
      if (comboEntry) {
        if (event.repeat && heldCombos.has(event.code)) return;
        event.preventDefault();
        heldCombos.set(event.code, comboEntry);
        emitKeyboardSensors();
        MidiPlayer.resumeCtx();
        console.debug(`Keyboard gesture: ${comboEntry.label}`, comboEntry.bits);
        return;
      }

      const fingerEntry = fingerKeyMap[event.code];
      if (!fingerEntry || event.repeat) return;
      event.preventDefault();
      heldFingerBits[fingerEntry.index] = 1;
      emitKeyboardSensors();
      MidiPlayer.resumeCtx();
      console.debug(`Keyboard finger: ${fingerEntry.label}`, heldFingerBits);
    });

    document.addEventListener('keyup', (event) => {
      if (isTypingTarget(event.target)) return;

      const comboEntry = getComboEntry(event);
      if (comboEntry) {
        event.preventDefault();
        heldCombos.delete(event.code);
        emitKeyboardSensors();
        return;
      }

      const fingerEntry = fingerKeyMap[event.code];
      if (!fingerEntry) return;
      event.preventDefault();
      heldFingerBits[fingerEntry.index] = 0;
      emitKeyboardSensors();
    });
  }

  // ── Boot ──────────────────────────────────────────────────
  function init() {
    // Init all modules
    Diagnostics.init();
    GloveSettings.init();
    Game.init();
    ExerciseBuilder.init((song) => {
      _loadedSong = song;
      showScreen('game');
    });

    _initHomePreview();
    _buildSongList();
    _bindGameHud();
    _bindSettings();
    _wireNav();
    _wireDebugKeys();

    // Start ESP32 polling
    ESP32.start();

    // Unlock AudioContext on first interaction
    document.addEventListener('click', () => MidiPlayer.resumeCtx(), { once: true });

    showScreen('home');
  }

  document.addEventListener('DOMContentLoaded', init);

  return { showScreen };
})();
