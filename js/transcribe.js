// 浏览器端离线转谱引擎（纯 JS，无外部依赖）
// - 旋律：YIN 自相关基频 -> 量化音符
// - 和弦：FFT 色度 -> 和弦模板匹配
import { toJianpu } from "./theory.js";

const CHORD_TEMPLATES = {
  maj: [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0],
  min: [1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0],
  "7": [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
  maj7: [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1],
  min7: [1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0],
  dim: [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0],
  sus4: [1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0],
};
const QUAL_ORDER = Object.keys(CHORD_TEMPLATES);
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// ---------------- FFT（迭代 radix-2） ----------------
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

// ---------------- YIN 基频 ----------------
function yinPitch(frame, sr) {
  const W = frame.length;
  const diff = new Float32Array(W);
  for (let tau = 1; tau < W; tau++) {
    let sum = 0;
    for (let i = 0; i < W - tau; i++) {
      const d = frame[i] - frame[i + tau];
      sum += d * d;
    }
    diff[tau] = sum;
  }
  // 累积均值归一化
  const cmnd = new Float32Array(W);
  let running = 0;
  for (let tau = 1; tau < W; tau++) { running += diff[tau]; cmnd[tau] = running > 0 ? diff[tau] * tau / running : 1; }
  // 绝对阈值
  const threshold = 0.15;
  let tauEst = -1;
  for (let tau = 2; tau < W; tau++) { if (cmnd[tau] < threshold) { while (tau + 1 < W && cmnd[tau + 1] < cmnd[tau]) tau++; tauEst = tau; break; } }
  if (tauEst < 2) return null;
  // 抛物线插值
  const x0 = tauEst > 1 ? tauEst - 1 : tauEst;
  const x2 = tauEst + 1 < W ? tauEst + 1 : tauEst;
  if (x0 === tauEst) return sr / tauEst;
  const s0 = cmnd[x0], s1 = cmnd[tauEst], s2 = cmnd[x2];
  const denom = 2 * (2 * s1 - s2 - s0);
  const shift = denom === 0 ? 0 : (s2 - s0) / denom;
  return sr / (tauEst + shift);
}

function hzToMidi(hz) { return 69 + 12 * Math.log2(hz / 440); }

// ---------------- 主分析（纯函数，可被 Node 测试） ----------------
export function analyze(samples, sr, maxSeconds = 90) {
  const N = samples.length;
  const maxLen = Math.floor(sr * maxSeconds);
  if (N > maxLen) samples = samples.subarray(0, maxLen);
  const hop = 512, frameLen = 2048;
  const fmin = 65.41, fmax = 1046.5; // C2..C6
  const numFrames = Math.max(1, Math.floor((samples.length - frameLen) / hop));
  const times = []; const pitches = []; const confs = []; const chromas = [];
  const hann = new Float32Array(frameLen);
  for (let i = 0; i < frameLen; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (frameLen - 1));
  const re = new Float32Array(frameLen), im = new Float32Array(frameLen);
  let prevSpec = null;
  for (let f = 0; f < numFrames; f++) {
    const start = f * hop;
    for (let i = 0; i < frameLen; i++) { re[i] = samples[start + i] * hann[i]; im[i] = 0; }
    const t = start / sr;
    const hz = yinPitch(re, sr);
    times.push(t);
    if (hz && hz >= fmin && hz <= fmax) {
      pitches.push(hzToMidi(hz)); confs.push(1);
    } else { pitches.push(null); confs.push(0); }
    // 频谱 + 色度
    fft(re, im);
    const mag = new Float32Array(frameLen / 2);
    for (let k = 0; k < frameLen / 2; k++) mag[k] = Math.hypot(re[k], im[k]);
    const chroma = new Array(12).fill(0);
    for (let k = 1; k < frameLen / 2; k++) {
      const freq = (k * sr) / frameLen;
      if (freq < 20) continue;
      const midi = 69 + 12 * Math.log2(freq / 440);
      const pc = ((Math.round(midi) % 12) + 12) % 12;
      chroma[pc] += mag[k];
    }
    chromas.push(chroma);
    // 起音强度（谱通量）
    if (prevSpec) {
      let flux = 0;
      for (let k = 0; k < mag.length; k++) { const d = mag[k] - prevSpec[k]; if (d > 0) flux += d; }
      confs[f] = flux; // 复用 confs 存 flux
    }
    prevSpec = mag;
  }
  // 起音检测
  const fluxArr = confs.slice();
  const meanFlux = fluxArr.reduce((a, b) => a + b, 0) / (fluxArr.length || 1);
  const boundaries = [0];
  for (let f = 1; f < numFrames - 1; f++) {
    if (fluxArr[f] > 1.6 * meanFlux && fluxArr[f] >= fluxArr[f - 1] && fluxArr[f] >= fluxArr[f + 1])
      boundaries.push(f);
  }
  boundaries.push(numFrames - 1);

  // 旋律
  const melody = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const a = boundaries[i], b = boundaries[i + 1];
    if (b - a < 2) continue;
    const seg = pitches.slice(a, b).filter((p) => p != null);
    if (!seg.length) continue;
    const med = seg.sort((x, y) => x - y)[Math.floor(seg.length / 2)];
    let midi = Math.round(med);
    while (midi < 52) midi += 12;
    while (midi > 84) midi -= 12;
    const strong = fluxArr[a] >= 0.3 * Math.max(...fluxArr);
    const isOnset = a === 0 || strong;
    const dur = times[b] - times[a];
    if (!isOnset && dur > 0.6) continue;
    if (dur > 2.0) continue;
    melody.push({ midi, start: times[a], end: times[b], label: NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1) });
  }
  const melodyF = melody.filter((m) => m.end - m.start >= 0.12);

  // 和弦
  function matchChord(chromaVec) {
    const norm = Math.hypot(...chromaVec) + 1e-9;
    const v = chromaVec.map((x) => x / norm);
    let best = null;
    for (let root = 0; root < 12; root++) {
      for (const qual of QUAL_ORDER) {
        const tmpl = CHORD_TEMPLATES[qual].slice();
        for (let k = 0; k < 12; k++) tmpl[k] = tmpl[(k - root + 12) % 12];
        const tn = Math.hypot(...tmpl) + 1e-9;
        let s = 0; for (let k = 0; k < 12; k++) s += v[k] * (tmpl[k] / tn);
        let label = NOTE_NAMES[root];
        if (qual !== "maj") label += qual === "min" ? "m" : qual;
        if (best == null || s > best[0]) best = [s, label];
      }
    }
    return best;
  }
  const chords = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const a = boundaries[i], b = boundaries[i + 1];
    if (b - a < 2) continue;
    const seg = chromas.slice(a, b);
    if (!seg.length) continue;
    const meanChroma = new Array(12).fill(0);
    for (const c of seg) for (let k = 0; k < 12; k++) meanChroma[k] += c[k];
    const [score, label] = matchChord(meanChroma);
    chords.push({ label, start: times[a], end: times[b], score: +score.toFixed(3) });
  }
  const merged = [];
  for (const c of chords) {
    if (merged.length && merged[merged.length - 1].label === c.label && c.start - merged[merged.length - 1].end < 0.4)
      merged[merged.length - 1].end = c.end;
    else merged.push({ ...c });
  }
  const chordsF = merged.filter((c) => c.end - c.start >= 0.3);

  return {
    melody: postProcessMelody(melodyF),
    chords: postProcessChords(chordsF),
    duration: +(samples.length / sr).toFixed(2),
  };
}

// ---------------- 离线算法精度增强 ----------------
function postProcessMelody(m) {
  if (!m.length) return m;
  const out = [{ ...m[0] }];
  for (let i = 1; i < m.length; i++) {
    const prev = out[out.length - 1];
    const cur = m[i];
    let best = cur.midi, bestDiff = Math.abs(cur.midi - prev.midi);
    for (const cand of [cur.midi - 12, cur.midi, cur.midi + 12]) {
      const diff = Math.abs(cand - prev.midi);
      if (diff < bestDiff) { bestDiff = diff; best = cand; }
    }
    const pc = ((best % 12) + 12) % 12;
    out.push({ ...cur, midi: best, label: NOTE_NAMES[pc] + (Math.floor(best / 12) - 1) });
  }
  return out;
}
function postProcessChords(c) {
  return c.filter((x) => x.score == null || x.score >= 0.65);
}

// 浏览器入口：解码音频文件
export async function transcribeFile(arrayBuffer) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  const audioBuf = await ctx.decodeAudioData(arrayBuffer.slice(0));
  const ch = audioBuf.getChannelData(0);
  return analyze(ch, audioBuf.sampleRate);
}

// 可选「高精度模式」：浏览器端 Basic Pitch（Spotify / TF.js）
// 浏览器端推理需联网加载 TF.js 与模型权重，且存在跨平台后端差异（详见 README「高精度模式接入」）。
// 当前实现：走增强版离线算法；若要启用真正的 Basic Pitch，请按 README 替换下方函数体。
export async function transcribeBasicPitch(arrayBuffer) {
  console.info("[高精度模式] 当前使用增强版离线算法；Basic Pitch 接入见 README。");
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  const audioBuf = await ctx.decodeAudioData(arrayBuffer.slice(0));
  const data = analyze(audioBuf.getChannelData(0), audioBuf.sampleRate);
  data.advancedFallback = true;
  return data;
}
