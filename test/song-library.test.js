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
assert.ok(!indexSource.toLowerCase().includes('.mid'));
assert.ok(!builderSource.includes('MidiPlayer'));
console.log('Audio training library passed.');
