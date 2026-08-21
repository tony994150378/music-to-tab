# 音乐转乐器谱 · 纯静态版

把音乐（歌曲音频 / 歌名）转成对应乐器的乐谱。**全部在浏览器本地完成，音频不上传任何服务器，完全免费。** 可部署到 GitHub Pages（个人免费、无限流量）。

## 功能

- **音频转谱**：从电脑上传任意歌曲（mp3 / wav / m4a），浏览器本地分析，输出「和弦进行 + 和弦图 + 旋律谱」。
- **歌名词库**：内置 9 首（见下），输入歌名即取谱，支持移调（±6 半音）与变调夹。
- **多乐器**：
  - 吉他 / 尤克里里：和弦图 + 六线谱
  - 钢琴：键盘图 **+ 高音五线谱**
  - 笛子 / 长笛：简谱 + 唱名 **+ 六孔指法图**（筒音作 sol）
- **一键导出**：生成谱面后点「🖼 PNG / 📄 PDF」导出（首次需联网加载截图库 html2canvas + jsPDF）。
- **高精度模式（实验）**：可选接入 Spotify Basic Pitch（TF.js）提升识别；详见下文。

## 本地预览

```bash
cd 项目目录
python3 -m http.server 8080
# 浏览器打开 http://localhost:8080
```

## 部署到 GitHub Pages

1. 在 GitHub 新建一个空仓库（如 `music-to-tab`）。
2. 推送本仓库：
   ```bash
   git remote add origin https://github.com/你的用户名/仓库名.git
   git branch -M main
   git push -u origin main
   ```
3. 仓库 → **Settings → Pages** → Source 选 `main` 分支 / 根目录 → Save。
4. 几分钟后访问 `https://你的用户名.github.io/仓库名/`。

> 纯静态站点，不需要任何服务器或付费资源。

## 曲库（`data/songs.json`）

内置 9 首：《青花瓷》《月亮代表我的心》《童年》《小星星》《平凡之路》《稻香》《成都》《后来》《晴天》。

**增删歌曲**：直接编辑 `data/songs.json`，每首结构如下：

```json
"歌名": {
  "title": "歌名", "artist": "歌手",
  "original_key": "A", "play_key": "G", "capo": 2,
  "time_sig": "4/4", "strumming": "下 下下上 下 下下上",
  "note": "补充说明",
  "sections": [
    { "name": "主歌", "lines": [
      { "chords": ["G", "Em7"], "lyric": "歌词……" }
    ]}
  ]
}
```

和弦标签支持 `C / Cm / C7 / Cmaj7 / Cm7 / Csus4 / Cadd9 / C6 / C9 / C/G(斜杠和弦)` 等。

## 高精度模式接入（Basic Pitch）

默认转谱算法（YIN 基频 + FFT 色度）已做离线精度增强（八度连续校正、和弦精炼），手机也流畅。若想进一步提升（尤其复音/钢琴），可用浏览器端 [Basic Pitch](https://github.com/spotify/basic-pitch)（Spotify 开源，TF.js）。

接入方式：打开 `js/transcribe.js`，把 `transcribeBasicPitch()` 函数体替换为真正的模型推理（其余代码无需改动，`app.js` 已通过「高精度模式」开关调用它）：

```js
import * as tf from "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/+esm";
import * as basicPitch from "https://cdn.jsdelivr.net/npm/@spotify/basic-pitch@1.1.3/+esm";

export async function transcribeBasicPitch(arrayBuffer) {
  await tf.ready();
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const buf = await ctx.decodeAudioData(arrayBuffer.slice(0));
  const audio = buf.getChannelData(0).subarray(0, buf.sampleRate * 90);
  const { pitches, onsets } = await basicPitch.predict(tf, audio, buf.sampleRate);
  // 将帧级输出 (pitches/onsets) 聚合成 { melody, chords, duration }
  // 旋律：取每帧基频众数并按 onset 分段量化；和弦：对帧级 chroma 做模板匹配
  // 返回结构需与 analyze() 一致：{ melody:[{midi,start,end,label}], chords:[{label,start,end,score}], duration }
  // 注意：浏览器端模型加载需联网，且不同设备 TF.js 后端表现有差异，建议在桌面端测试
}
```

> 当前 `transcribeBasicPitch` 默认回退到增强版离线算法（并在结果区标注），待你填好模型推理后即生效。

## 项目结构

```
index.html            界面
css/style.css         样式
js/theory.js          乐理核心（和弦/指法/简谱）
js/transcribe.js      音频转谱引擎（YIN+FFT，含 Basic Pitch 接入点）
js/instruments.js     多乐器谱面渲染（和弦图/六线谱/钢琴/五线谱/笛子指法/简谱）
js/app.js             交互逻辑（音频/歌名两种模式、导出）
data/songs.json       曲库
backend/              旧版 Python 高精度后端（可选本地使用，不参与静态部署）
```

## 已知局限

- 纯音频方案无法还原原曲段落/歌词对齐（这是歌名词库模式的优势）。
- 旋律跟踪对强和声偶有低八度，已用音域+八度连续性校正缓解。
- 导出功能首次需联网加载一次截图库。
- 高精度（Basic Pitch）需联网加载模型，手机体验一般，建议桌面端。
