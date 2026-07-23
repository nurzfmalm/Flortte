const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, '..', 'assets', 'midi');
const DIVISION = 480;

function variableLength(value) {
  const bytes = [value & 0x7f];
  let remaining = value >> 7;
  while (remaining > 0) {
    bytes.unshift((remaining & 0x7f) | 0x80);
    remaining >>= 7;
  }
  return bytes;
}

function uint32(value) {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function uint16(value) {
  return [(value >>> 8) & 0xff, value & 0xff];
}

function makeMidi({ notes, bpm = 105, leadBeats = 4, beatTicks = DIVISION }) {
  const track = [];
  const microsecondsPerBeat = Math.round(60000000 / bpm);
  track.push(0x00, 0xff, 0x51, 0x03);
  track.push(
    (microsecondsPerBeat >>> 16) & 0xff,
    (microsecondsPerBeat >>> 8) & 0xff,
    microsecondsPerBeat & 0xff
  );
  track.push(0x00, 0xc0, 0x00);

  notes.forEach((note, index) => {
    const firstDelay = index === 0 ? leadBeats * DIVISION : Math.round(beatTicks * 0.18);
    const duration = Math.round(beatTicks * 0.82);
    track.push(...variableLength(firstDelay), 0x90, note, 92);
    track.push(...variableLength(duration), 0x80, note, 0);
  });

  track.push(0x00, 0xff, 0x2f, 0x00);
  const header = [
    0x4d, 0x54, 0x68, 0x64,
    0x00, 0x00, 0x00, 0x06,
    ...uint16(0),
    ...uint16(1),
    ...uint16(DIVISION),
  ];
  const chunk = [0x4d, 0x54, 0x72, 0x6b, ...uint32(track.length), ...track];
  return Buffer.from([...header, ...chunk]);
}

function sequence(pattern, repeats, shifts = [0]) {
  const notes = [];
  for (let repeat = 0; repeat < repeats; repeat++) {
    const shift = shifts[repeat % shifts.length];
    pattern.forEach(note => notes.push(note + shift));
  }
  return notes;
}

const levels = [
  {
    file: 'blue-tractor-warmup.mid',
    bpm: 96,
    notes: sequence([60, 62, 64, 62, 60, 62, 67, 64], 6, [0, 0, 2]),
  },
  {
    file: 'blue-tractor-animals.mid',
    bpm: 108,
    notes: sequence([55, 60, 62, 64, 62, 60, 57, 59], 7, [0, 2, 0, 5]),
  },
  {
    file: 'fixies-workshop.mid',
    bpm: 118,
    notes: sequence([64, 67, 69, 67, 72, 71, 69, 67], 7, [0, 0, -2]),
  },
  {
    file: 'malyshariki-hands.mid',
    bpm: 88,
    notes: sequence([60, 64, 67, 64, 62, 65, 69, 65], 6, [0, 0, -5]),
  },
  {
    file: 'three-cats-steps.mid',
    bpm: 112,
    notes: sequence([62, 64, 66, 67, 69, 67, 66, 64], 7, [0, 3, 0]),
  },
  {
    file: 'masha-friendship.mid',
    bpm: 100,
    notes: sequence([57, 60, 64, 65, 64, 60, 62, 59], 7, [0, 0, 5, 0]),
  },
];

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
levels.forEach((level) => {
  fs.writeFileSync(path.join(OUTPUT_DIR, level.file), makeMidi(level));
});

console.log(`Generated ${levels.length} original practice MIDI levels.`);
