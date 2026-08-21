// 多乐器谱面渲染（输出 SVG / HTML 字符串）
import { voicing, TUNINGS, chordDiagramLines, melodyToTabLines, toJianpu, NOTE_NAMES } from "./theory.js";

// ---------- 和弦图（SVG） ----------
export function chordDiagramSVG(label, instrument = "guitar") {
  const strings = TUNINGS[instrument].strings;
  const n = strings.length;
  const { frets, base } = voicing(label, instrument);
  const W = 120, H = 150, pad = 18;
  const colW = (W - pad * 2) / (n - 1);
  const rowH = 22, top = 34, gridH = rowH * 4;
  let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" class="chord-svg">`;
  svg += `<text x="${W / 2}" y="18" text-anchor="middle" class="chord-name">${label}</text>`;
  // 弦线
  for (let i = 0; i < n; i++) {
    const x = pad + i * colW;
    svg += `<line x1="${x}" y1="${top}" x2="${x}" y2="${top + gridH}" class="cd-line"/>`;
  }
  // 品线
  for (let r = 0; r <= 4; r++) {
    const y = top + r * rowH;
    svg += `<line x1="${pad}" y1="${y}" x2="${pad + (n - 1) * colW}" y2="${y}" class="cd-line"/>`;
  }
  // 品柱（base>0 时标注把位）
  if (base > 0) svg += `<text x="2" y="${top + rowH / 2 + 4}" class="cd-fret">${base + 1}</text>`;
  frets.forEach((f, i) => {
    const x = pad + i * colW;
    if (f == null) {
      svg += `<text x="${x}" y="${top - 6}" text-anchor="middle" class="cd-x">x</text>`;
    } else if (f === 0) {
      svg += `<circle cx="${x}" cy="${top - 7}" r="4" class="cd-open"/>`;
    } else {
      const y = top + (f - base - 0.5) * rowH;
      svg += `<circle cx="${x}" cy="${y}" r="7" class="cd-dot"/>`;
    }
  });
  svg += `</svg>`;
  return svg;
}

// ---------- 六线谱（HTML pre） ----------
export function tabHTML(lines) {
  return `<pre class="tab">${lines.map((l) => escapeHtml(l)).join("\n")}</pre>`;
}

// ---------- 钢琴键盘（SVG） ----------
export function pianoSVG(midiSet, lo = 48, hi = 84) {
  const whitePcs = [0, 2, 4, 5, 7, 9, 11];
  const whiteKeys = [];
  for (let m = lo; m <= hi; m++) if (whitePcs.includes(((m % 12) + 12) % 12)) whiteKeys.push(m);
  const kw = 22, kh = 120, gap = 2;
  const W = whiteKeys.length * (kw + gap) + gap;
  const blackW = kw * 0.62;
  let svg = `<svg width="${W}" height="${kh + 20}" viewBox="0 0 ${W} ${kh + 20}" class="piano-svg">`;
  // 白键
  whiteKeys.forEach((m, idx) => {
    const x = gap + idx * (kw + gap);
    const on = midiSet.has(m);
    svg += `<rect x="${x}" y="14" width="${kw}" height="${kh}" rx="3" class="${on ? "pk-white-on" : "pk-white"}"/>`;
    svg += `<text x="${x + kw / 2}" y="${kh + 10}" text-anchor="middle" class="pk-label">${midiToName(m)}</text>`;
  });
  // 黑键
  whiteKeys.forEach((m, idx) => {
    const next = m + 1;
    if (next <= hi && [1, 3, 6, 8, 10].includes(((next % 12) + 12) % 12)) {
      const x = gap + idx * (kw + gap) + kw - blackW / 2;
      const on = midiSet.has(next);
      svg += `<rect x="${x}" y="14" width="${blackW}" height="${kh * 0.62}" rx="2" class="${on ? "pk-black-on" : "pk-black"}"/>`;
    }
  });
  svg += `</svg>`;
  return svg;
}

function midiToName(m) { return NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1); }

// ---------- 笛子简谱（HTML） ----------
export function jianpuHTML(melody, tonicMidi = 60) {
  if (!melody.length) return `<div class="hint">（无旋律）</div>`;
  const nums = melody.map((m) => toJianpu(m.midi, tonicMidi));
  const jp = nums.map((n) => n.label).join("  ");
  const sol = nums.map((n) => n.solfege).join(" ");
  const names = melody.map((m) => m.label).join(" ");
  return `<div class="jianpu">
    <div class="jp-row"><span class="jp-cap">简谱</span><b>${escapeHtml(jp)}</b></div>
    <div class="jp-row"><span class="jp-cap">唱名</span>${escapeHtml(sol)}</div>
    <div class="jp-row"><span class="jp-cap">音名</span>${escapeHtml(names)}</div>
  </div>`;
}

// ---------- 笛子指法图（六孔竹笛，筒音作 5/sol） ----------
// 孔序 1..6：1 最靠近吹孔（左），6 最远（右）；1=闭 ●，0=开 ○
const FLUTE_FINGER = {
  1: [1, 1, 1, 0, 0, 0],
  2: [1, 1, 0, 0, 0, 0],
  3: [1, 0, 0, 0, 0, 0],
  4: [0, 1, 1, 1, 1, 1],
  5: [1, 1, 1, 1, 1, 1],
  6: [1, 1, 1, 1, 1, 0],
  7: [1, 1, 1, 1, 0, 0],
};
const FLUTE_DEGREE_NAME = { 1: "do", 2: "re", 3: "mi", 4: "fa", 5: "sol", 6: "la", 7: "ti" };

export function fluteFingeringSVG(degree, label = "") {
  const f = FLUTE_FINGER[degree] || FLUTE_FINGER[5];
  const W = 210, H = 86, bodyY = 38, bodyH = 18;
  let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" class="flute-svg">`;
  svg += `<rect x="8" y="${bodyY}" width="${W - 16}" height="${bodyH}" rx="9" class="fl-body"/>`;
  // 吹孔
  svg += `<circle cx="34" cy="${bodyY + bodyH / 2}" r="5" class="fl-hole-closed"/>`;
  svg += `<text x="34" y="${bodyY - 7}" text-anchor="middle" class="fl-cap">吹</text>`;
  // 膜孔
  svg += `<circle cx="60" cy="${bodyY + bodyH / 2}" r="4" class="fl-memb"/>`;
  const xs = [86, 104, 122, 140, 158, 176];
  f.forEach((st, i) => {
    const cx = xs[i], cy = bodyY + bodyH / 2;
    svg += st === 1
      ? `<circle cx="${cx}" cy="${cy}" r="6" class="fl-hole-closed"/>`
      : `<circle cx="${cx}" cy="${cy}" r="6" class="fl-hole-open"/>`;
  });
  svg += `<text x="${W / 2}" y="${H - 6}" text-anchor="middle" class="fl-name">${escapeHtml(label)}</text>`;
  svg += `</svg>`;
  return svg;
}

// 给定旋律，返回去重后的指法图集合（笛子为旋律乐器，逐个音指法）
export function fluteFingeringSetHTML(melody, tonicMidi = 60) {
  if (!melody.length) return `<div class="hint">（无旋律）</div>`;
  const seen = new Map();
  for (const m of melody) {
    const jp = toJianpu(m.midi, tonicMidi);
    const key = jp.num;
    if (!seen.has(key)) seen.set(key, jp);
  }
  const wraps = [...seen.values()].map((jp) => {
    const label = jp.label + "（" + FLUTE_DEGREE_NAME[jp.num] + "）";
    return `<div class="fing-wrap">${fluteFingeringSVG(jp.num, label)}</div>`;
  }).join("");
  return `<div class="fing-grid">${wraps}</div>`;
}

// ---------- 钢琴五线谱（高音谱表） ----------
const DIATONIC = { 0: 0, 2: 1, 4: 2, 5: 3, 7: 4, 9: 5, 11: 6 };
function diatonicOf(midi) {
  const pc = ((Math.round(midi) % 12) + 12) % 12;
  const d = DIATONIC[pc] != null ? DIATONIC[pc] : 0;
  const oct = Math.floor(midi / 12) - 1;
  return (oct - 4) * 7 + d; // 以 C4=0
}

export function staffSVG(melody) {
  if (!melody || !melody.length) return `<div class="hint">（无旋律）</div>`;
  const W = 760, lineGap = 14, half = lineGap / 2, Y0 = 150; // E4(d=2) 为第一线
  const firstLineD = 2;
  const H = Y0 + 50;
  const left = 70;
  const step = Math.max(32, Math.min(66, Math.floor((W - left - 40) / Math.max(1, melody.length))));
  const notes = melody.map((m, i) => {
    const d = diatonicOf(m.midi);
    return { x: left + i * step, y: Y0 - (d - firstLineD) * half, d, label: m.label };
  });
  let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" class="staff-svg">`;
  for (let k = 0; k < 5; k++) {
    const y = Y0 - k * lineGap;
    svg += `<line x1="22" y1="${y}" x2="${W - 10}" y2="${y}" class="st-line"/>`;
  }
  // 高音谱号
  svg += `<text x="30" y="${Y0 - 2 * lineGap + 16}" text-anchor="middle" class="st-clef">𝄞</text>`;
  // 加线（ledger lines）
  for (const n of notes) {
    if (n.d < 0) for (let dd = 0; dd >= n.d; dd -= 2) {
      const y = Y0 - (dd - firstLineD) * half;
      svg += `<line x1="${n.x - 12}" y1="${y}" x2="${n.x + 12}" y2="${y}" class="st-line"/>`;
    }
    if (n.d > 10) for (let dd = 12; dd <= n.d; dd += 2) {
      const y = Y0 - (dd - firstLineD) * half;
      svg += `<line x1="${n.x - 12}" y1="${y}" x2="${n.x + 12}" y2="${y}" class="st-line"/>`;
    }
  }
  // 符头 + 符干
  for (const n of notes) {
    const up = n.y > Y0 - 2 * lineGap;
    svg += `<ellipse cx="${n.x}" cy="${n.y}" rx="7" ry="5.4" class="st-note" transform="rotate(-18 ${n.x} ${n.y})"/>`;
    svg += `<line x1="${n.x + 6}" y1="${n.y}" x2="${n.x + 6}" y2="${up ? n.y - 34 : n.y + 34}" class="st-stem"/>`;
    svg += `<text x="${n.x}" y="${H - 12}" text-anchor="middle" class="st-lbl">${escapeHtml(n.label)}</text>`;
  }
  svg += `</svg>`;
  return svg;
}

export { chordDiagramLines, melodyToTabLines };

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
