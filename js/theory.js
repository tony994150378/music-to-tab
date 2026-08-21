// 音乐理论核心（浏览器/Node 通用，ESM 导出）
export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export const TUNINGS = {
  guitar: { name: "吉他", strings: [40, 45, 50, 55, 59, 64], open: ["E", "A", "D", "G", "B", "E"] },
  ukulele: { name: "尤克里里", strings: [55, 60, 64, 67], open: ["G", "C", "E", "A"] },
};

export const CHORD_SHAPES = {
  maj: [0, 4, 7], min: [0, 3, 7], dim: [0, 3, 6], aug: [0, 4, 8],
  sus2: [0, 2, 7], sus4: [0, 5, 7], "7": [0, 4, 7, 10], maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10], min7b5: [0, 3, 6, 10], dim7: [0, 3, 6, 9],
  add9: [0, 4, 7, 14], "6": [0, 4, 7, 9], m6: [0, 3, 7, 9], "9": [0, 4, 7, 10, 14],
};

export function midiToNote(midi) {
  midi = Math.round(midi);
  return NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}

export function noteToMidi(note) {
  note = note.trim();
  let i = 0, name = "";
  while (i < note.length && /[A-Ga-g]/.test(note[i])) { name += note[i]; i++; }
  if (i < note.length && (note[i] === "#" || note[i] === "b")) { name += note[i]; i++; }
  let octave = parseInt(note.slice(i)) || 4;
  let base = NOTE_NAMES.indexOf(name[0].toUpperCase());
  if (name.length === 2) base += name[1] === "#" ? 1 : -1;
  return ((base % 12) + 12) % 12 + (octave + 1) * 12;
}

export function parseChord(label) {
  label = label.trim();
  let bass = null;
  if (label.includes("/")) {
    const [head, bassPart] = label.split("/");
    bass = noteToMidi(bassPart.trim()) % 12;
    label = head.trim();
  }
  let rootChar = label[0], idx = 1;
  if (label[1] === "#" || label[1] === "b") { rootChar += label[1]; idx = 2; }
  let root = NOTE_NAMES.indexOf(rootChar.toUpperCase());
  if (rootChar.length === 2) root += rootChar[1] === "#" ? 1 : -1;
  root = ((root % 12) + 12) % 12;
  let quality = label.slice(idx);
  const qmap = { "": "maj", "m": "min", "M7": "maj7", "maj": "maj", "min": "min", "dim": "dim",
    "aug": "aug", "sus2": "sus2", "sus4": "sus4", "7": "7", "maj7": "maj7", "min7": "m7",
    "m7": "min7", "min7b5": "min7b5", "dim7": "dim7", "add9": "add9", "6": "6", "m6": "m6", "9": "9" };
  quality = qmap[quality] || "maj";
  return [root, quality, bass];
}

export function buildChord(root, quality, bass) {
  const name = NOTE_NAMES[((root % 12) + 12) % 12];
  const suffix = { maj: "", min: "m", dim: "dim", aug: "aug", sus2: "sus2", sus4: "sus4",
    "7": "7", maj7: "maj7", min7: "m7", min7b5: "m7b5", dim7: "dim7", add9: "add9",
    "6": "6", m6: "m6", "9": "9" }[quality] || "";
  let out = name + suffix;
  if (bass != null) out += "/" + NOTE_NAMES[((bass % 12) + 12) % 12];
  return out;
}

export function transposeLabel(label, semitones) {
  const [root, qual, bass] = parseChord(label);
  return buildChord((root + semitones + 120) % 12, qual,
    bass != null ? (bass + semitones + 120) % 12 : null);
}

export function chordNotes(label) {
  const [root, quality, bass] = parseChord(label);
  const intervals = CHORD_SHAPES[quality] || CHORD_SHAPES.maj;
  let notes = intervals.map((iv) => ((root + iv) % 12 + 12) % 12);
  if (bass != null) notes = [bass, ...notes];
  return [...new Set(notes)].sort((a, b) => a - b);
}

export function voicing(label, instrument = "guitar", maxFret = 12) {
  const strings = TUNINGS[instrument].strings;
  const target = new Set(chordNotes(label));
  const [, , bass] = parseChord(label);
  let best = null;
  for (let base = 0; base < maxFret - 3; base++) {
    const frets = []; let ok = 0;
    for (const s of strings) {
      let found = null;
      for (let f = base; f < base + 5; f++) if (target.has(((s + f) % 12 + 12) % 12)) { found = f; break; }
      if (found == null && base === 0 && target.has(((s % 12) + 12) % 12)) found = 0;
      frets.push(found); if (found != null) ok++;
    }
    if (ok < 3) continue;
    const voiced = frets.filter((f) => f != null);
    const span = Math.max(...voiced) - Math.min(...voiced);
    const score = base * 1000 + span * 10 + Math.min(...voiced);
    if (best == null || score < best[0]) best = [score, base, frets.slice()];
  }
  if (best == null) {
    const frets = strings.map((s) => {
      const cand = []; for (let f = 0; f <= maxFret; f++) if (target.has(((s + f) % 12 + 12) % 12)) cand.push(f);
      return cand.length ? cand[0] : null;
    });
    return { frets, base: 0, notes: [...target] };
  }
  const frets = best[2];
  if (bass != null) {
    const low = strings[0], b = ((bass % 12) + 12) % 12;
    const cand = []; for (let f = best[1]; f < best[1] + 5; f++) if ((((low + f) % 12) + 12) % 12 === b) cand.push(f);
    if (cand.length) frets[0] = cand[0];
  }
  return { frets, base: best[1], notes: [...target] };
}

// 返回和弦图行数组（不含空行），便于前端渲染
export function chordDiagramLines(label, instrument = "guitar") {
  const strings = TUNINGS[instrument].strings;
  const { frets, base } = voicing(label, instrument);
  const n = strings.length, W = 3;
  const out = [label.padStart(Math.floor((n * W) / 2)), "-".repeat(n * W - 1)];
  for (let row = base; row < base + 5; row++) {
    let line = "";
    for (const f of frets) {
      if (f == null) line += " x ";
      else if (f === 0) line += row === 0 ? " O " : " | ";
      else line += f === row ? " ● " : " | ";
    }
    out.push(line.trimEnd());
  }
  out.push("-".repeat(n * W - 1));
  out.push(strings.map((_, i) => TUNINGS[instrument].open[i]).join(" "));
  return out;
}

export function melodyToTabLines(notes, instrument = "guitar", maxFret = 19) {
  const strings = TUNINGS[instrument].strings;
  const n = strings.length;
  if (!notes.length) return ["(无旋律识别结果)"];
  const duration = Math.max(...notes.map((m) => m.end));
  const step = 0.25;
  const cols = Math.floor(duration / step) + 1;
  const grid = Array.from({ length: n }, () => Array(cols).fill("-"));
  for (const note of notes) {
    if (note.midi == null) continue;
    let pos = Math.max(0, Math.min(cols - 1, Math.floor(note.start / step)));
    let bestSf = null;
    strings.forEach((s, si) => {
      const f = note.midi - s;
      if (f >= 0 && f <= maxFret) {
        if (bestSf == null || f < bestSf[1] || (f === bestSf[1] && si > bestSf[0])) bestSf = [si, f];
      }
    });
    if (!bestSf) continue;
    const [si, f] = bestSf;
    grid[n - 1 - si][pos] = String(f);
  }
  const header = "  " + Array.from({ length: cols }, (_, i) => (i % 4 === 0 ? String(Math.floor(i * step)) : " ")).join("");
  return [header, ...grid.map((row, r) => TUNINGS[instrument].open[n - 1 - r] + "|" + row.join(""))];
}

// 钢琴：返回 88 键中某 midi 是否黑键、以及相对 C 的索引
export function pianoKeyInfo(midi) {
  const pc = ((midi % 12) + 12) % 12;
  const black = [1, 3, 6, 8, 10].includes(pc);
  return { black, pc };
}

// 简谱（numbered notation）：给定主音 tonicMidi（默认 C4=60），把 midi 转为 {num, octave, accidental}
export function toJianpu(midi, tonicMidi = 60) {
  const majorScale = [0, 2, 4, 5, 7, 9, 11];
  const pc = ((midi % 12) + 12) % 12;
  let deg = majorScale.indexOf(pc);
  let accidental = "";
  if (deg < 0) {
    // 找最近的音级
    for (let d = 0; d < 7; d++) {
      const diff = ((pc - majorScale[d]) % 12 + 12) % 12;
      if (diff === 1) { deg = d; accidental = "#"; break; }
      if (diff === 11) { deg = d; accidental = "b"; break; }
    }
  }
  const octave = Math.floor((midi - tonicMidi) / 12);
  const solfege = ["do", "re", "mi", "fa", "sol", "la", "si"][deg];
  return { num: deg + 1, octave, accidental, solfege, label: (accidental === "b" ? "♭" : accidental === "#" ? "#" : "") + (deg + 1) + (octave > 0 ? "˙".repeat(octave) : octave < 0 ? "̣".repeat(-octave) : "") };
}

export const INSTRUMENTS = [
  { id: "guitar", name: "吉他", type: "chord+tabs" },
  { id: "ukulele", name: "尤克里里", type: "chord+tabs" },
  { id: "piano", name: "钢琴", type: "keyboard" },
  { id: "flute", name: "笛子/长笛", type: "melody" },
];
