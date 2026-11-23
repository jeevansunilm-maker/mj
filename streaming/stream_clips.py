#!/usr/bin/env python3
"""stream_clips.py - find the Shorts hiding inside a stream VOD.

    python3 stream_clips.py vod.srt                          # transcript only
    python3 stream_clips.py vod.srt --chat vod.live_chat.json  # + YouTube live chat replay
    python3 stream_clips.py vod.srt --chat chat.csv --top 10 --json
    python3 stream_clips.py vod.srt --chat chat.csv --cut vod.mp4   # also writes 9:16 clips

Transcript: .srt, .vtt or whisper .json (the same parser as yt-edit/deadair.py).
Chat: YouTube's replay file from `yt-dlp --skip-download --write-subs --sub-langs live_chat URL`,
or any CSV whose first column is seconds into the stream and second column is the message.

On a stream, chat is the honest signal: a moment people reacted to live is a moment strangers
react to in a feed. Each candidate window (20-55s) is scored on:

  CHAT     messages per second in the window vs. the stream's own median (when chat is given)
  REACT    reaction words in your speech ("no way", "bro", "what", laughing) and in chat ("LUL", "KEKW")
  CLEAN    starts on a new sentence after a pause and ends on a finished line, so it survives
           without the minutes around it

It prints timecodes and the first line of each. It does not upload, and --cut only writes local
files. A high score means "watch this one first", not "this will go viral".
"""
import csv, json, os, re, statistics, subprocess, sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".claude", "skills", "yt-edit"))
from deadair import load  # noqa: E402

REACT_SPEECH = re.compile(r"\b(no way|bro|what+|oh my god|omg|holy|let'?s go+|nah+|yo+|wait|crazy|insane|"
                          r"how did|did you see|ha(ha)+|lol|lmao|run|go go)\b", re.I)
REACT_CHAT = re.compile(r"(LUL|KEKW|OMEGALUL|LMAO+|LOL+|W+\b|💀|😂|🤣|HOLY|NO WAY|CLIP IT|clip that|\?\?\?)", re.I)
MIN_LEN, MAX_LEN = 20.0, 55.0

def load_chat(path):
    """Return a sorted list of (seconds, message)."""
    out = []
    if path.endswith(".csv"):
        for row in csv.reader(open(path, encoding="utf-8", errors="replace")):
            try: out.append((float(row[0]), row[1] if len(row) > 1 else ""))
            except (ValueError, IndexError): continue
    else:  # YouTube live_chat.json: one JSON object per line
        for line in open(path, encoding="utf-8", errors="replace"):
            try: o = json.loads(line)
            except ValueError: continue
            r = o.get("replayChatItemAction", {})
            t = r.get("videoOffsetTimeMsec")
            if t is None: continue
            text = ""
            for a in r.get("actions", []):
                item = a.get("addChatItemAction", {}).get("item", {})
                for v in item.values():
                    for run in v.get("message", {}).get("runs", []):
                        text += run.get("text", "") or run.get("emoji", {}).get("shortcuts", [""])[0]
            out.append((int(t) / 1000.0, text))
    return sorted(out)

def mmss(t):
    t = int(t); h, m, s = t // 3600, (t % 3600) // 60, t % 60
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"

def candidates(cues):
    """Windows that start on a cue after a pause (or a capitalised sentence) and end on a finished line."""
    starts = [i for i, c in enumerate(cues)
              if i == 0 or cues[i][0] - cues[i - 1][1] > 0.6 or re.search(r"[.!?]\s*$", cues[i - 1][2])]
    for i in starts:
        for j in range(i, len(cues)):
            dur = cues[j][1] - cues[i][0]
            if dur > MAX_LEN: break
            if dur >= MIN_LEN and (re.search(r"[.!?]\s*$", cues[j][2]) or
                                   (j + 1 < len(cues) and cues[j + 1][0] - cues[j][1] > 0.8)):
                yield i, j

def score(cues, chat):
    if chat:
        dur = max(cues[-1][1], chat[-1][0])
        per_min = [0] * (int(dur // 60) + 1)
        for t, _ in chat: per_min[int(t // 60)] += 1
        base = max(0.05, statistics.median(per_min) / 60.0)
    rows = []
    for i, j in candidates(cues):
        s, e = cues[i][0], cues[j][1]
        text = " ".join(c[2] for c in cues[i:j + 1])
        react = len(REACT_SPEECH.findall(text))
        chat_x = chat_react = 0
        if chat:
            msgs = [m for t, m in chat if s + 2 <= t <= e + 8]   # chat lags the stream by a few seconds
            chat_x = (len(msgs) / (e - s + 6)) / base
            chat_react = sum(1 for m in msgs if REACT_CHAT.search(m))
        clean = (12 if re.match(r"^[A-Z\"']", cues[i][2].strip()) else 0) + (12 if re.search(r"[.!?]\s*$", cues[j][2]) else 0)
        # density, not totals: a longer window must not win just by containing more of the same moment
        per30 = 30.0 / (e - s)
        sc = (min(chat_x, 12) * 12 if chat else 0) + min(react * per30, 8) * 6 \
             + min(chat_react * per30, 40) * 1.5 + clean
        rows.append({"start": round(s, 2), "end": round(e, 2), "seconds": round(e - s, 1),
                     "label": f"{mmss(s)}-{mmss(e)}", "score": round(sc, 1),
                     "chat_x": round(chat_x, 2), "react": react, "chat_react": chat_react,
                     "first_line": cues[i][2][:120], "last_line": cues[j][2][:120]})
    rows.sort(key=lambda r: -r["score"])
    picked = []
    for r in rows:   # no overlapping picks
        if all(r["end"] <= p["start"] or r["start"] >= p["end"] for p in picked): picked.append(r)
    return picked

def cut(video, r, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, f"clip_{int(r['start']):06d}.mp4")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", str(r["start"]), "-to", str(r["end"]), "-i", video,
                    "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1",
                    "-c:v", "libx264", "-crf", "20", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", out],
                   check=True)
    return out

def main():
    a = sys.argv[1:]
    opt = lambda k, d=None: a[a.index(k) + 1] if k in a else d
    as_json = "--json" in a
    chat_path, top, video = opt("--chat"), int(opt("--top", 5)), opt("--cut")
    pos = [x for x in a if not x.startswith("--") and x not in (chat_path, video, str(top))]
    if not pos or not os.path.exists(pos[0]): print(__doc__); sys.exit(1)
    cues = load(pos[0])
    if len(cues) < 10: print("too few cues - is this a full stream transcript?"); sys.exit(1)
    chat = load_chat(chat_path) if chat_path else []
    picks = score(cues, chat)[:top]
    if video:
        for r in picks: r["file"] = cut(video, r, os.path.join(os.path.dirname(video) or ".", "clips"))
    if as_json: print(json.dumps(picks, indent=1)); return
    print(f"\n  {pos[0]}   {mmss(cues[-1][1])} of speech, {len(chat)} chat messages\n")
    for n, r in enumerate(picks, 1):
        sig = f"chat {r['chat_x']}x normal, {r['chat_react']} reactions, " if chat else ""
        print(f"  {n}. {r['label']}  ({r['seconds']}s)  score {r['score']}   [{sig}{r['react']} reaction words]")
        print(f"     opens: \"{r['first_line']}\"")
        print(f"     ends:  \"{r['last_line']}\"")
        if r.get("file"): print(f"     clip:  {r['file']}")
    print("\n  Watch these before you post. Then write each one a NEW first line (the stream's line\n"
          "  assumes context a stranger does not have) and score it with yt-script/hookscore.py.\n")

if __name__ == "__main__":
    main()
