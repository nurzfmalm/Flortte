const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const gameSource = fs.readFileSync(path.join(root, 'js', 'game.js'), 'utf8');
const midiSource = `${fs.readFileSync(path.join(root, 'js', 'midi.js'), 'utf8')}
globalThis.MidiPlayer = MidiPlayer;`;
const midiContext = vm.createContext({
  localStorage: { getItem: () => null, setItem: () => {} },
  Gestures: { laneCount: () => 9, midiToName: note => String(note) },
});
vm.runInContext(midiSource, midiContext);
const expectedLevels = [
  ['Синий трактор: Разминка', 'blue-tractor-warmup.mid'],
  ['Синий трактор: Животные', 'blue-tractor-animals.mid'],
  ['Фиксики: Мастерская', 'fixies-workshop.mid'],
  ['Малышарики: Ладошки', 'malyshariki-hands.mid'],
  ['Три кота: Весёлые шаги', 'three-cats-steps.mid'],
  ['Маша и Медведь: Дружба', 'masha-friendship.mid'],
];

expectedLevels.forEach(([name, file]) => {
  assert.ok(appSource.includes(name), `Missing level ${name}`);
  const bytes = fs.readFileSync(path.join(root, 'assets', 'midi', file));
  assert.strictEqual(bytes.subarray(0, 4).toString('ascii'), 'MThd');
  assert.strictEqual(bytes.subarray(14, 18).toString('ascii'), 'MTrk');
  assert.ok(bytes.length > 400, `${file} should contain a full practice chart`);
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const parsed = midiContext.MidiPlayer.parseBuffer(arrayBuffer);
  assert.ok(parsed.notes.length >= 48, `${file} should expose at least 48 playable notes`);
  assert.ok(parsed.durationMs > 20000, `${file} should run as a full level`);
});

assert.ok(appSource.includes('ExerciseBuilder.configureSong(song, settings)'));
assert.ok(!gameSource.includes('MidiPlayer.noteOn(best.note'));

console.log('Flexible song library passed.');
