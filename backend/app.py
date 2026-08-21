"""音乐转乐器谱 Web 服务（FastAPI）。

功能：
- 音频上传 -> 离线转谱（旋律 + 和弦）-> 渲染成指定乐器的谱面
- 歌名词库检索 -> 返回和弦图谱（含和弦图、移调、变调夹）
完全免费、可离线运行，依赖仅 librosa + fastapi。
"""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

import uvicorn
from fastapi import FastAPI, File, UploadFile, Form
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

import guitartab as gt
import transcriber as tr

BASE = Path(__file__).resolve().parent
SONGS_PATH = BASE / "songs.json"

app = FastAPI(title="音乐转乐器谱", version="1.0.0")


def load_songs() -> dict:
    with open(SONGS_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


# ---------------- 页面 ----------------
@app.get("/", response_class=HTMLResponse)
def index():
    return (BASE / "index.html").read_text(encoding="utf-8")


# ---------------- 音频转谱 ----------------
@app.post("/api/transcribe")
async def api_transcribe(file: UploadFile = File(...), instrument: str = Form("guitar")):
    if instrument not in gt.TUNINGS:
        instrument = "guitar"
    suffix = Path(file.filename or "audio").suffix or ".wav"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name
    try:
        result = tr.transcribe(tmp_path)
    except Exception as e:  # noqa
        os.unlink(tmp_path)
        return JSONResponse({"error": f"转谱失败：{e}"}, status_code=500)
    os.unlink(tmp_path)

    chord_diagrams = []
    seen = set()
    for c in result["chords"]:
        if c["label"] not in seen:
            seen.add(c["label"])
            chord_diagrams.append({
                "label": c["label"],
                "ascii": gt.chord_diagram(c["label"], instrument),
            })
    melody_tab = gt.melody_to_tab(result["melody"], instrument)
    return {
        "instrument": instrument,
        "duration": result["duration"],
        "melody": result["melody"],
        "chords": result["chords"],
        "chord_diagrams": chord_diagrams,
        "melody_tab": melody_tab,
        "chord_progression": [{"label": c["label"], "start": c["start"], "end": c["end"]} for c in result["chords"]],
    }


# ---------------- 歌名词库 ----------------
@app.get("/api/songs")
def api_songs():
    songs = load_songs()
    return [{"title": k, "artist": v.get("artist", ""), "capo": v.get("capo", 0),
             "key": v.get("play_key", "")} for k, v in songs.items()]


@app.post("/api/song")
def api_song(name: str = Form(...), instrument: str = Form("guitar"),
             transpose: int = Form(0), capo: int = Form(-1)):
    songs = load_songs()
    song = songs.get(name)
    if not song:
        return JSONResponse({"error": f"曲库未收录《{name}》。可改用音频上传，或在 songs.json 中补充。"}, status_code=404)
    if instrument not in gt.TUNINGS:
        instrument = "guitar"
    if capo < 0:
        capo = int(song.get("capo", 0))

    sections = []
    all_chords = set()
    for sec in song["sections"]:
        lines = []
        for ln in sec["lines"]:
            chords = [gt.transpose_label(ch, transpose) for ch in ln["chords"]]
            for ch in chords:
                all_chords.add(ch)
            lines.append({"chords": chords, "lyric": ln.get("lyric", "")})
        sections.append({"name": sec["name"], "lines": lines})

    diagrams = []
    for ch in sorted(all_chords, key=lambda x: (len(x), x)):
        diagrams.append({"label": ch, "ascii": gt.chord_diagram(ch, instrument)})

    return {
        "title": song["title"],
        "artist": song.get("artist", ""),
        "original_key": song.get("original_key", ""),
        "play_key": gt.transpose_label("C", transpose)[:1] or song.get("play_key", ""),
        "capo": capo,
        "time_sig": song.get("time_sig", ""),
        "strumming": song.get("strumming", ""),
        "note": song.get("note", ""),
        "instrument": instrument,
        "transpose": transpose,
        "sections": sections,
        "diagrams": diagrams,
    }


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
