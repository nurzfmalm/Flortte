const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
function load({ saved = null, search = '', unavailable = false } = {}) {
  const storage = new Map(saved ? [['flortte_language', saved]] : []);
  const context = vm.createContext({ URL, location: { href: 'http://localhost/' + search }, localStorage: {
    getItem(key) { if (unavailable) throw new Error('Storage blocked'); return storage.get(key) || null; },
    setItem(key, value) { storage.set(key, value); },
  } });
  vm.runInContext(source('js/i18n-kk.js') + '\n' + source('js/i18n.js') + '\nglobalThis.i18n = I18n; globalThis.messages = KAZAKH_MESSAGES;', context);
  return context;
}
const ru = load();
assert.equal(ru.i18n.language, 'ru');
assert.equal(ru.i18n.t('Сохранить'), 'Сохранить');
const kk = load({ saved: 'kk' });
assert.equal(kk.i18n.language, 'kk');
assert.equal(kk.i18n.locale, 'kk-KZ');
assert.equal(kk.i18n.t('Сохранить'), 'Сақтау');
assert.equal(vm.runInContext('I18n.t`${3} из ${10}`', kk), '10 ішінен 3');
assert.equal(vm.runInContext('I18n.t`Быстрая тренировка: ${"My ${0} title"}`', kk), 'Жылдам жаттығу: My ${0} title');
assert.equal(kk.i18n.t('Название пользователя ${0}'), 'Название пользователя ${0}');
assert.equal(load({ saved: 'kk', search: '?lang=ru' }).i18n.language, 'ru');
assert.equal(load({ saved: 'kk', search: '?lang=invalid' }).i18n.language, 'kk');
assert.equal(load({ unavailable: true, search: '?lang=kk' }).i18n.language, 'kk');
assert.equal(load({ saved: 'invalid' }).i18n.language, 'ru');
for (const [key, translated] of Object.entries(kk.messages)) {
  const placeholders = text => (text.match(/\$\{\d+\}/g) || []).sort();
  assert.deepEqual(placeholders(key), placeholders(translated), 'Mismatched placeholders: ' + key);
  assert.ok(translated.trim(), 'Empty translation: ' + key);
}
// Every static Russian label and accessibility description has a translation.
const html = source('index.html');
for (const match of html.matchAll(/>([^<>]+)</g)) {
  const text = match[1].trim();
  if (/[А-Яа-яЁё]/.test(text) && !['Русский', 'Қазақша'].includes(text)) {
    assert.ok(Object.hasOwn(kk.messages, text), 'Missing HTML translation: ' + text);
  }
}
for (const match of html.matchAll(/(?:value|placeholder|title|aria-label)="([^"]+)"/g)) {
  if (/[А-Яа-яЁё]/.test(match[1])) assert.ok(Object.hasOwn(kk.messages, match[1]), 'Missing attribute: ' + match[1]);
}
// Loading the real modules in Kazakh translates data used by generated UI and errors.
for (const file of ['js/gestures.js', 'js/game-results.js', 'js/exercise-builder.js', 'js/diagnostic-metrics.js']) vm.runInContext(source(file), kk);
assert.equal(vm.runInContext('ExerciseBuilder.audioPresets()[1].name', kk), 'Көк трактор');
assert.equal(vm.runInContext('ExerciseBuilder.normalizePlan().name', kk), 'Менің жаттығуым');
assert.equal(vm.runInContext('ExerciseBuilder.normalizePlan({name:"Мой личный план"}).name', kk), 'Мой личный план');
assert.equal(vm.runInContext('Gestures.playableGestures()[0].name', kk), '1. Сұқ саусақ + бас бармақ');
assert.throws(() => vm.runInContext('ExerciseBuilder.createSession({gestureIds: []})', kk), /Кемінде бір қимылды таңдаңыз/);
assert.ok(html.indexOf('js/i18n.js') < html.indexOf('js/esp32.js'));
const packageJson = JSON.parse(source('package.json'));
const lock = JSON.parse(source('package-lock.json'));
assert.equal(packageJson.version, lock.version);
assert.equal(packageJson.version, lock.packages[''].version);
for (const file of ['package.json', 'capacitor.config.json', 'index.html', '.github/workflows/windows.yml']) assert.ok(!/6767|1\.67\.0|16700/.test(source(file)), 'Branding numbers in ' + file);
console.log('Russian/Kazakh messages, interpolation, saved preferences, translation coverage and branding passed.');
