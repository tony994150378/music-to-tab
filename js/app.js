// 前端交互逻辑（ES 模块）
import * as T from "./theory.js";
import {
  chordDiagramSVG, melodyToTabLines, pianoSVG, jianpuHTML, tabHTML,
  fluteFingeringSetHTML, staffSVG,
} from "./instruments.js";
import { transcribeFile, transcribeBasicPitch } from "./transcribe.js";

let SONGS = {};
let lastMelody = [];
const CHORD_INSTRS = ["guitar", "ukulele"];

function esc(s) { return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

function switchMode(m) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.mode === m));
  document.getElementById("panel-audio").style.display = m === "audio" ? "block" : "none";
  document.getElementById("panel-song").style.display = m === "song" ? "block" : "none";
}

async function loadSongs() {
  try {
    const r = await fetch("data/songs.json");
    SONGS = await r.json();
    document.getElementById("songList").innerHTML =
      Object.keys(SONGS).map((t) => `<option value="${esc(t)}">${esc(SONGS[t].artist || "")}</option>`).join("");
  } catch (e) { console.warn("加载曲库失败", e); }
}

function chordMidiSet(label) {
  const set = new Set();
  for (const pc of T.chordNotes(label)) {
    for (const oct of [3, 4, 5]) { const m = 12 * (oct + 1) + pc; if (m >= 48 && m <= 84) set.add(m); }
  }
  return set;
}
function uniqueChords(chords) { return [...new Set(chords)]; }

// ---------- 导出 PNG / PDF（动态加载截图库，仅首次需联网） ----------
let libCache = null;
async function loadExportLibs() {
  if (libCache) return libCache;
  const [h2c, jspdf] = await Promise.all([
    import("https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/+esm"),
    import("https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm"),
  ]);
  libCache = { html2canvas: h2c.default, jsPDF: jspdf.jsPDF };
  return libCache;
}
async function exportImage(targetId, format) {
  const el = document.getElementById(targetId);
  if (!el || !el.innerHTML.trim()) { alert("请先生成谱面再导出"); return; }
  const btn = event && event.target;
  if (btn) { btn.disabled = true; btn.textContent = "生成中…"; }
  try {
    const { html2canvas, jsPDF } = await loadExportLibs();
    const canvas = await html2canvas(el, { backgroundColor: "#ffffff", scale: 2, useCORS: true });
    const name = targetId === "songResult" ? "song" : "tab";
    if (format === "png") {
      const a = document.createElement("a");
      a.download = name + ".png";
      a.href = canvas.toDataURL("image/png");
      a.click();
    } else {
      const img = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: canvas.width > canvas.height ? "l" : "p", unit: "px", format: [canvas.width, canvas.height] });
      pdf.addImage(img, "PNG", 0, 0, canvas.width, canvas.height);
      pdf.save(name + ".pdf");
    }
  } catch (e) {
    alert("导出失败：" + (e.message || e) + "（导出需联网加载一次截图库）");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = format === "png" ? "🖼 PNG" : "📄 PDF"; }
  }
}
window.exportImage = exportImage;

function exportBar(targetId) {
  return `<div class="exportbar">
    <span class="eb-label">导出谱面：</span>
    <button class="eb-btn" onclick="exportImage('${targetId}','png')">🖼 PNG</button>
    <button class="eb-btn" onclick="exportImage('${targetId}','pdf')">📄 PDF</button>
    <span class="hint">首次需联网加载截图库</span>
  </div>`;
}

// ---------- 音频转谱 ----------
async function doTranscribe() {
  const file = document.getElementById("audioFile").files[0];
  const box = document.getElementById("audioResult");
  if (!file) { box.innerHTML = '<div class="err">请先选择歌曲文件</div>'; return; }
  const instrument = document.getElementById("audioInstrument").value;
  const hp = document.getElementById("hpMode");
  const useHP = hp && hp.checked;
  const btn = document.getElementById("audioBtn");
  btn.disabled = true;
  box.innerHTML = `<div class="loading">⏳ 正在本地分析音频（约 10–30 秒，不会上传）…${useHP ? "<br>（高精度模式：联网加载 Basic Pitch 模型）" : ""}</div>`;
  try {
    const buf = await file.arrayBuffer();
    const data = useHP ? await transcribeBasicPitch(buf) : await transcribeFile(buf);
    lastMelody = data.melody;
    box.innerHTML = renderAudio(data, instrument);
  } catch (e) {
    box.innerHTML = `<div class="err">转谱失败：${esc(e.message || e)}<br>请确认文件是常见音频格式（mp3/wav/m4a）。</div>`;
  } finally { btn.disabled = false; }
}

function renderAudio(data, instrument) {
  const INSTR = { guitar: "吉他", ukulele: "尤克里里", piano: "钢琴", flute: "笛子 / 长笛" };
  let html = exportBar("audioResult");
  html += `<div class="meta">时长 <b>${data.duration}s</b> · 乐器 <b>${INSTR[instrument] || instrument}</b> · 识别 <b>${data.chords.length}</b> 和弦段 / <b>${data.melody.length}</b> 旋律音${data.advancedFallback ? " · <span class='hint'>（高精度模型不可用，已用离线算法）</span>" : ""}</div>`;
  const prog = data.chord_progression || data.chords.map((c) => ({ label: c.label, start: c.start }));
  html += `<div class="sec-title">和弦进行</div><div class="prog">${
    prog.map((c) => `<div class="chip"><b>${esc(c.label)}</b> <span class="hint">${c.start.toFixed(1)}s</span></div>`).join("")}</div>`;

  if (CHORD_INSTRS.includes(instrument)) {
    html += `<div class="sec-title">和弦图</div><div class="grid">${
      uniqueChords(prog.map((c) => c.label)).map((l) => `<div>${chordDiagramSVG(l, instrument)}</div>`).join("")}</div>`;
    html += `<div class="sec-title">旋律六线谱</div>${tabHTML(melodyToTabLines(data.melody, instrument))}`;
  } else if (instrument === "piano") {
    const uniq = uniqueChords(prog.map((c) => c.label));
    html += `<div class="sec-title">和弦键盘（${uniq.length} 个）</div><div class="grid">${
      uniq.map((l) => `<div class="piano-wrap">${pianoSVG(chordMidiSet(l))}</div>`).join("")}</div>`;
    html += `<div class="sec-title">旋律五线谱（高音谱表）</div><div class="staff-wrap">${staffSVG(data.melody)}</div>`;
    html += `<div class="sec-title">旋律键盘</div><div class="piano-wrap">${pianoSVG(new Set(data.melody.map((m) => m.midi)))}</div>`;
    html += `<div class="hint">旋律音名：${data.melody.map((m) => m.label).join(" ")}</div>`;
  } else if (instrument === "flute") {
    html += `<div class="sec-title">笛子指法图（筒音作 sol）</div>${fluteFingeringSetHTML(data.melody, 60)}`;
    html += `<div class="sec-title">笛子简谱（以 C 为宫）</div>${jianpuHTML(data.melody, 60)}`;
    html += `<div class="hint">笛子为旋律乐器，按指法图与简谱吹奏；上方和弦进行可作伴奏参考。</div>`;
  }
  return html;
}

// ---------- 歌名词库 ----------
function doSong() {
  const name = document.getElementById("songName").value.trim();
  const box = document.getElementById("songResult");
  if (!name) { box.innerHTML = '<div class="err">请输入歌名</div>'; return; }
  const song = SONGS[name];
  if (!song) { box.innerHTML = `<div class="err">曲库未收录《${esc(name)}》。请改用「音频转谱」（可直接从电脑上传歌曲翻译），或补充 data/songs.json。</div>`; return; }
  const instrument = document.getElementById("songInstrument").value;
  const transpose = parseInt(document.getElementById("transpose").value, 10) || 0;
  let capo = parseInt(document.getElementById("capo").value, 10);
  if (isNaN(capo) || capo < 0) capo = song.capo || 0;
  box.innerHTML = renderSong(song, instrument, transpose, capo);
}

function renderSong(song, instrument, transpose, capo) {
  let html = exportBar("songResult");
  const allChords = [];
  song.sections.forEach((sec) => sec.lines.forEach((ln) => ln.chords.forEach((c) => allChords.push(c))));
  const transposed = allChords.map((c) => T.transposeLabel(c, transpose));
  const uniq = uniqueChords(transposed);

  html += `<h3 style="margin:6px 0">${esc(song.title)} <span class="hint">— ${esc(song.artist || "")}</span></h3>`;
  html += `<div class="meta">原调 <b>${esc(song.original_key || "")}</b> · 选调 <b>${esc(song.play_key || "")}</b> · 变调夹 <b>${capo} 品</b> · 拍号 <b>${esc(song.time_sig || "")}</b> · 节奏 <b>${esc(song.strumming || "")}</b></div>`;
  if (song.note) html += `<div class="hint">${esc(song.note)}</div>`;

  if (CHORD_INSTRS.includes(instrument)) {
    html += `<div class="sec-title">和弦图例</div><div class="grid">${
      uniq.map((l) => `<div>${chordDiagramSVG(l, instrument)}</div>`).join("")}</div>`;
  } else if (instrument === "piano") {
    html += `<div class="sec-title">和弦键盘图例</div><div class="grid">${
      uniq.map((l) => `<div class="piano-wrap">${pianoSVG(chordMidiSet(l))}</div>`).join("")}</div>`;
  } else if (instrument === "flute") {
    const roots = transposed.map((l) => T.noteToMidi(l.split("/")[0]) % 12);
    const rootSet = new Set(roots.map((pc) => 60 + pc));
    html += `<div class="sec-title">和弦根音简谱（参考）</div><div class="piano-wrap">${pianoSVG(rootSet)}</div>`;
  }

  song.sections.forEach((sec) => {
    html += `<div class="sec-title">${esc(sec.name)}</div>`;
    sec.lines.forEach((ln) => {
      const chords = ln.chords.map((c) => `<span>${esc(T.transposeLabel(c, transpose))}</span>`).join("");
      html += `<div class="line"><div class="chords">${chords}</div><div class="lyric">${esc(ln.lyric || "")}</div></div>`;
    });
  });
  return html;
}

// 暴露给 HTML 内联事件
window.switchMode = switchMode;
window.doTranscribe = doTranscribe;
window.doSong = doSong;

loadSongs();
