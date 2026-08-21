"""吉他与通用乐器的乐谱生成核心模块（修订版：和弦图渲染修正）。"""
from __future__ import annotations

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

TUNINGS = {
    "guitar": {"name": "吉他 (Guitar)", "strings": [40, 45, 50, 55, 59, 64], "open": ["E", "A", "D", "G", "B", "E"]},
    "ukulele": {"name": "尤克里里 (Ukulele)", "strings": [55, 60, 64, 67], "open": ["G", "C", "E", "A"]},
}

CHORD_SHAPES = {
    "maj": [0, 4, 7], "min": [0, 3, 7], "dim": [0, 3, 6], "aug": [0, 4, 8],
    "sus2": [0, 2, 7], "sus4": [0, 5, 7], "7": [0, 4, 7, 10], "maj7": [0, 4, 7, 11],
    "min7": [0, 3, 7, 10], "min7b5": [0, 3, 6, 10], "dim7": [0, 3, 6, 9],
    "add9": [0, 4, 7, 14], "6": [0, 4, 7, 9], "m6": [0, 3, 7, 9], "9": [0, 4, 7, 10, 14],
}


def midi_to_note(midi: int) -> str:
    midi = int(round(midi))
    return f"{NOTE_NAMES[midi % 12]}{midi // 12 - 1}"


def note_to_midi(note: str) -> int:
    note = note.strip().capitalize()
    i, name = 0, ""
    while i < len(note) and note[i].isalpha():
        name += note[i]; i += 1
    if i < len(note) and note[i] in "#b":
        name += note[i]; i += 1
    octave = int(note[i:]) if note[i:] else 4
    base = NOTE_NAMES.index(name[0])
    if len(name) == 2:
        base += 1 if name[1] == "#" else -1
    return base + (octave + 1) * 12


def midi_class(midi: int) -> int:
    return int(round(midi)) % 12


def parse_chord(label: str):
    label = label.strip()
    bass = None
    if "/" in label:
        head, bass_part = label.split("/", 1)
        bass = note_to_midi(bass_part.strip()) % 12
        label = head.strip()
    root_char = label[0]; idx = 1
    if idx < len(label) and label[idx] in "#b":
        root_char += label[idx]; idx += 1
    root = NOTE_NAMES.index(root_char[0]) + (1 if root_char[-1] == "#" else (-1 if root_char[-1] == "b" else 0))
    root %= 12
    quality = label[idx:].strip() if idx < len(label) else ""
    qmap = {"": "maj", "m": "min", "M7": "maj7", "maj": "maj", "min": "min", "dim": "dim",
            "aug": "aug", "sus2": "sus2", "sus4": "sus4", "7": "7", "maj7": "maj7",
            "min7": "m7", "m7": "min7", "min7b5": "min7b5", "dim7": "dim7",
            "add9": "add9", "6": "6", "m6": "m6", "9": "9"}
    quality = qmap.get(quality, "maj")
    return root, quality, bass


def build_chord(root: int, quality: str, bass=None) -> str:
    name = NOTE_NAMES[root % 12]
    suffix = {"maj": "", "min": "m", "dim": "dim", "aug": "aug", "sus2": "sus2", "sus4": "sus4",
              "7": "7", "maj7": "maj7", "min7": "m7", "min7b5": "m7b5", "dim7": "dim7",
              "add9": "add9", "6": "6", "m6": "m6", "9": "9"}.get(quality, "")
    out = name + suffix
    if bass is not None:
        out += "/" + NOTE_NAMES[bass % 12]
    return out


def transpose_label(label: str, semitones: int) -> str:
    root, qual, bass = parse_chord(label)
    return build_chord((root + semitones) % 12, qual, (bass + semitones) % 12 if bass is not None else None)


def chord_notes(label: str) -> list[int]:
    root, quality, bass = parse_chord(label)
    intervals = CHORD_SHAPES.get(quality, CHORD_SHAPES["maj"])
    notes = [(root + iv) % 12 for iv in intervals]
    if bass is not None:
        notes = [bass] + notes
    return sorted(set(notes))


def voicing(label: str, instrument: str = "guitar", max_fret: int = 12):
    tuning = TUNINGS[instrument]
    strings = tuning["strings"]
    target = set(chord_notes(label))
    _, _, bass = parse_chord(label)
    best = None
    for base in range(0, max_fret - 3):
        frets, ok = [], 0
        for s in strings:
            found = None
            for f in range(base, base + 5):
                if (s + f) % 12 in target:
                    found = f; break
            if found is None and base == 0 and (s % 12) in target:
                found = 0
            frets.append(found)
            if found is not None:
                ok += 1
        if ok < 3:
            continue
        voiced = [f for f in frets if f is not None]
        span = (max(voiced) - min(voiced)) if voiced else 99
        # 优先低把位（开放把位），其次小跨度，再次低把位起点
        score = base * 1000 + span * 10 + min(voiced)
        if best is None or score < best[0]:
            best = (score, base, frets[:])
    if best is None:
        frets = []
        for s in strings:
            cand = [f for f in range(0, max_fret + 1) if (s + f) % 12 in target]
            frets.append(cand[0] if cand else None)
        return {"frets": frets, "base": 0, "notes": target}
    frets = best[2]
    # 斜杠和弦：若低音能在当前把位窗口内按到，则落到最低弦，使低音更明确
    if bass is not None:
        low = strings[0]
        base = best[1]
        cand = [f for f in range(base, base + 5) if (low + f) % 12 == bass]
        if cand:
            frets[0] = cand[0]
    return {"frets": frets, "base": best[1], "notes": target}


def chord_diagram(label: str, instrument: str = "guitar") -> str:
    tuning = TUNINGS[instrument]
    v = voicing(label, instrument)
    frets, base, n = v["frets"], v["base"], len(v["frets"])
    W = 3
    out = [label.center(n * W - 1), "-" * (n * W - 1)]
    for row in range(base, base + 5):
        line = ""
        for f in frets:
            if f is None:
                line += " x "
            elif f == 0:
                line += " O " if row == 0 else " | "
            else:
                line += " ● " if f == row else " | "
        out.append(line.rstrip())
    out.append("-" * (n * W - 1))
    out.append(" ".join(tuning["open"]))
    return "\n".join(out)


def melody_to_tab(notes: list[dict], instrument: str = "guitar", max_fret: int = 19) -> str:
    tuning = TUNINGS[instrument]
    strings = tuning["strings"]; n = len(strings)
    if not notes:
        return "(无旋律识别结果)"
    duration = max(note["end"] for note in notes)
    step = 0.25
    cols = int(duration / step) + 1
    grid = [["-"] * cols for _ in range(n)]
    for note in notes:
        if note.get("midi") is None:
            continue
        pos = max(0, min(cols - 1, int(note["start"] / step)))
        best_sf = None
        for si, s in enumerate(strings):
            f = note["midi"] - s
            if 0 <= f <= max_fret:
                if best_sf is None or f < best_sf[1] or (f == best_sf[1] and si > best_sf[0]):
                    best_sf = (si, f)
        if best_sf is None:
            continue
        si, f = best_sf
        grid[n - 1 - si][pos] = str(f)
    out = []
    for row in range(n):
        out.append(tuning["open"][n - 1 - row] + "|" + "".join(grid[row]))
    header = "  " + "".join(str(int(i * step)) if i % 4 == 0 else " " for i in range(cols))
    return "\n".join([header] + out)


def render_chord_chart(chords: list[dict], instrument: str = "guitar") -> str:
    if not chords:
        return "(未识别和弦)"
    lines = []
    for c in chords:
        lines.append(chord_diagram(c["label"], instrument))
        lines.append("")
    return "\n".join(lines).rstrip()


if __name__ == "__main__":
    for ch in ["C", "Am", "G", "F", "Bm", "Dsus4", "Em"]:
        print(chord_diagram(ch, "guitar")); print()
    print(melody_to_tab([{"midi": 64, "start": 0, "end": 0.5},
                         {"midi": 60, "start": 0.5, "end": 1.0},
                         {"midi": 67, "start": 1.0, "end": 1.5}], "guitar"))
