/** Standard MIDI files with a shared, quarter-note tempo map. */
const MidiFile = (() => {
  function parse(buffer) {
    const view = new DataView(buffer);
    let cursor = 0;
    let limit = view.byteLength;
    const invalid = () => { throw new Error('Invalid or unsupported Standard MIDI File'); };
    function number(bytes) {
      if (cursor + bytes > limit) invalid();
      let result = 0;
      while (bytes-- > 0) result = result * 256 + view.getUint8(cursor++);
      return result;
    }
    function variable() {
      let result = 0;
      for (let i = 0; i < 4; i++) {
        const byte = number(1);
        result = result * 128 + (byte & 127);
        if (byte < 128) return result;
      }
      return invalid();
    }
    function skip(bytes) {
      cursor += bytes;
      if (cursor > limit) invalid();
    }

    if (number(4) !== 0x4d546864) invalid();
    const headerSize = number(4);
    if (headerSize < 6) invalid();
    const format = number(2);
    const tracks = number(2);
    const division = number(2);
    if (format > 1 || !tracks || (format === 0 && tracks !== 1) || !division || division >= 0x8000) invalid();
    skip(headerSize - 6);

    const tempos = [{ tick: 0, micros: 500000 }];
    const notes = [];
    let lastTick = 0;
    for (let track = 0; track < tracks; track++) {
      if (number(4) !== 0x4d54726b) invalid();
      const length = number(4);
      const end = cursor + length;
      if (end > limit) invalid();
      limit = end;
      let tick = 0;
      let running = 0;
      const held = new Map();
      while (cursor < limit) {
        tick += variable();
        let status = number(1);
        if (status < 128) {
          if (!running) invalid();
          cursor--;
          status = running;
        }
        if (status === 0xff) {
          running = 0;
          const type = number(1);
          const size = variable();
          if (type === 0x51 && size === 3) {
            const micros = number(3);
            if (!micros) invalid();
            tempos.push({ tick, micros });
          } else {
            skip(size);
          }
          if (type === 0x2f) break;
          continue;
        }
        if (status === 0xf0 || status === 0xf7) {
          running = 0;
          skip(variable());
          continue;
        }
        if (status >= 0xf0) invalid();
        running = status;
        const kind = status >> 4;
        const pitch = number(1);
        const velocity = kind === 12 || kind === 13 ? 0 : number(1);
        if (pitch >= 128 || velocity >= 128) invalid();
        const key = (status & 15) * 128 + pitch;
        if (kind === 9 && velocity) {
          if (held.has(key)) notes.push({ ...held.get(key), end: tick });
          held.set(key, { tick, pitch, velocity });
        } else if (kind === 8 || kind === 9) {
          if (held.has(key)) notes.push({ ...held.get(key), end: tick });
          held.delete(key);
        }
      }
      for (const note of held.values()) notes.push({ ...note, end: tick });
      lastTick = Math.max(lastTick, tick);
      cursor = end;
      limit = view.byteLength;
    }
    if (!notes.length || !lastTick || lastTick / division > 50000) invalid();

    tempos.sort((a, b) => a.tick - b.tick);
    let previous = { tick: 0, micros: 500000, time: 0 };
    for (const tempo of tempos) {
      tempo.time = previous.time + (tempo.tick - previous.tick) * previous.micros / division / 1000;
      previous = tempo;
    }
    function timeAt(tick) {
      let low = 0;
      let high = tempos.length;
      while (low + 1 < high) {
        const mid = (low + high) >> 1;
        if (tempos[mid].tick <= tick) low = mid;
        else high = mid;
      }
      const tempo = tempos[low];
      return tempo.time + (tick - tempo.tick) * tempo.micros / division / 1000;
    }

    return {
      defaultBpm: Math.round(60000000 / tempos.findLast(event => event.tick === 0).micros),
      trackDurationMs: timeAt(lastTick),
      beats: Array.from({ length: Math.ceil(lastTick / division) }, (_, index) => timeAt(index * division)),
      midiNotes: notes.sort((a, b) => a.tick - b.tick).map(note => ({
        time: timeAt(note.tick),
        duration: Math.max(20, timeAt(note.end) - timeAt(note.tick)),
        pitch: note.pitch,
        velocity: note.velocity,
      })),
    };
  }

  return { parse };
})();
