"""音频转谱引擎：把音频文件转成 旋律音符序列 + 和弦进行。

完全离线、免费，基于 librosa：
- 旋律：pyin 基频跟踪 -> 量化成音符
- 和弦：chroma 色度特征 -> 和弦模板匹配（大/小/属七/大七/小七/减/挂四）
输入：音频文件路径；输出：{ 'melody': [...], 'chords': [...], 'duration': float }
"""
from __future__ import annotations

import numpy as np
import librosa


# 和弦模板（12 个根音 × 若干品质），用于 chroma 匹配
_CHORD_QUALITIES = {
    "maj": [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0],
    "min": [1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0],
    "7":   [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
    "maj7":[1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1],
    "min7":[1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0],
    "dim": [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0],
    "sus4":[1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0],
}
_QUAL_ORDER = list(_CHORD_QUALITIES.keys())


def _match_chord(chroma_vec: np.ndarray):
    """返回 (label, score)，label 形如 'C', 'Am7'。"""
    chroma_vec = chroma_vec / (np.linalg.norm(chroma_vec) + 1e-9)
    best = None
    for root in range(12):
        for qual in _QUAL_ORDER:
            tmpl = np.roll(np.array(_CHORD_QUALITIES[qual], dtype=float), root)
            tmpl = tmpl / (np.linalg.norm(tmpl) + 1e-9)
            s = float(np.dot(chroma_vec, tmpl))
            label = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][root]
            if qual != "maj":
                label += "m" if qual == "min" else qual
            if best is None or s > best[0]:
                best = (s, label)
    return best  # (score, label)


def transcribe(path: str, max_seconds: int = 90):
    y, sr = librosa.load(path, sr=22050, mono=True)
    if len(y) > sr * max_seconds:
        y = y[: sr * max_seconds]
    duration = float(len(y) / sr)

    # ---- 旋律：pyin 基频 ----
    fmin = librosa.note_to_hz("C2")
    fmax = librosa.note_to_hz("C6")
    f0, voiced_flag, voiced_prob = librosa.pyin(
        y, fmin=fmin, fmax=fmax, sr=sr, frame_length=2048, hop_length=512
    )
    times = librosa.times_like(f0, sr=sr, hop_length=512)

    # 按 onset 分段，取段内中值音高
    onset_frames = librosa.onset.onset_detect(y=y, sr=sr, hop_length=512, units="frames")
    onset_set = set(np.atleast_1d(onset_frames).tolist())
    onset_strength = librosa.onset.onset_strength(y=y, sr=sr, hop_length=512)
    str_max = float(onset_strength.max()) if len(onset_strength) else 0.0
    boundaries = np.concatenate(([0], np.sort(onset_frames), [len(f0) - 1]))
    boundaries = np.clip(boundaries, 0, len(f0) - 1)
    melody = []
    for i in range(len(boundaries) - 1):
        a, b = boundaries[i], boundaries[i + 1]
        if b - a < 2:
            continue
        # 只保留“有明确起音(attack)且不是超长持续音”的段，过滤和弦垫音/低八度误判
        strong = (a < len(onset_strength)) and (onset_strength[a] >= 0.3 * str_max)
        is_onset = (a in onset_set) and (strong or a == 0)
        seg_f0 = f0[a:b]
        seg_v = voiced_flag[a:b]
        if seg_f0 is None or np.sum(seg_v) < 1:
            continue
        voiced_vals = seg_f0[seg_v]
        med = np.median(voiced_vals)
        if med <= 0 or not np.isfinite(med):
            continue
        midi = int(round(float(librosa.hz_to_midi(med))))
        # 八度校正：把旋律限制在人声/主旋律常见音域 E3–C6，规避 pyin 低八度误判
        while midi < 52:
            midi += 12
        while midi > 84:
            midi -= 12
        start_t, end_t = float(times[a]), float(times[b])
        dur = end_t - start_t
        if not is_onset and dur > 0.6:
            continue
        if dur > 2.0:
            continue
        melody.append({
            "midi": midi,
            "start": start_t,
            "end": end_t,
            "label": _midi_name(midi),
        })
    # 过滤过短/过密
    melody = [m for m in melody if (m["end"] - m["start"]) >= 0.12]

    # ---- 和弦：chroma 模板匹配 ----
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=512)
    chords = []
    for i in range(len(boundaries) - 1):
        a, b = boundaries[i], boundaries[i + 1]
        if b - a < 2:
            continue
        seg = chroma[:, a:b]
        if seg.shape[1] == 0:
            continue
        mean_chroma = seg.mean(axis=1)
        score, label = _match_chord(mean_chroma)
        chords.append({
            "label": label,
            "start": float(times[a]),
            "end": float(times[b]),
            "score": round(score, 3),
        })
    # 合并连续相同和弦
    merged = []
    for c in chords:
        if merged and merged[-1]["label"] == c["label"] and (c["start"] - merged[-1]["end"]) < 0.4:
            merged[-1]["end"] = c["end"]
        else:
            merged.append(dict(c))
    chords = [c for c in merged if (c["end"] - c["start"]) >= 0.3]

    return {"melody": melody, "chords": chords, "duration": round(duration, 2)}


def _midi_name(midi: int) -> str:
    names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    return f"{names[midi % 12]}{midi // 12 - 1}"


if __name__ == "__main__":
    import sys, json
    if len(sys.argv) > 1:
        res = transcribe(sys.argv[1])
        print(json.dumps(res, ensure_ascii=False, indent=2))
    else:
        print("usage: python3.11 transcriber.py <audio_file>")
