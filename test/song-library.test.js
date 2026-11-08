const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const builderSource = fs.readFileSync(path.join(root, 'js', 'exercise-builder.js'), 'utf8');
const gameSource = fs.readFileSync(path.join(root, 'js', 'game.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const audioFiles = [
  ['Гарри Поттер', 'potter.mp3'],
  ['Синий трактор', 'blue-tractor.mp3'],
  ['Baby Shark', 'baby-shark-training.mp3'],
];
audioFiles.forEach(([name, file]) => {
  assert.ok(builderSource.includes(name), `Missing audio preset ${name}`);
  const bytes = fs.readFileSync(path.join(root, 'assets', 'audio', file));
  assert.ok(bytes.length > 20_000, `${file} should contain a full training track`);
  assert.ok(bytes.subarray(0, 3).toString('ascii') === 'ID3' || bytes[0] === 0xff, `${file} should be MP3`);
});

assert.ok(appSource.includes('ExerciseBuilder.createQuickTraining'));
assert.ok(gameSource.includes('AudioPlayer.play'));
assert.ok(indexSource.includes('js/audio.js'));
assert.ok(indexSource.includes('js/midi.js'));
const vm = require('node:vm');
const midiSource = fs.readFileSync(path.join(root, 'js', 'midi.js'), 'utf8');
const midi = vm.runInNewContext(midiSource + '\nMidiFile');
const events = [
  0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20, // 120 BPM
  0, 0x90, 60, 90,
  96, 60, 0, // running status, note off via zero velocity
  0, 0xff, 0x51, 3, 0x0f, 0x42, 0x40, // 60 BPM
  0, 0x90, 62, 90,
  96, 0x80, 62, 0,
  0, 0xff, 0x2f, 0,
];
const fixture = Uint8Array.from([
  0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96,
  0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, events.length, ...events,
]).buffer;
const score = midi.parse(fixture);
assert.equal(score.defaultBpm, 120);
assert.deepEqual(Array.from(score.beats), [0, 500]);
assert.deepEqual(Array.from(score.midiNotes, note => [note.time, note.duration, note.pitch]), [
  [0, 500, 60], [500, 1000, 62],
]);
assert.equal(score.trackDurationMs, 1500);
assert.throws(() => midi.parse(fixture.slice(0, -1)));
console.log('Audio training library and MIDI tempo map passed.');
