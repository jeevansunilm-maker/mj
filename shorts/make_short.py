#!/usr/bin/env python3
"""make_short.py - render a vertical YouTube Short (1080x1920, 30fps) from a script spec.

    python3 make_short.py spec.json out.mp4                       # preview with placeholder shots
    python3 make_short.py spec.json out.mp4 --clip gameplay.mp4   # your footage, cropped to 9:16
    python3 make_short.py spec.json out.mp4 --clip gameplay.mp4 --audio voiceover.m4a

The spec is a JSON file:

    {"id": "...", "title": "...", "hook_text": "on-screen words for the first 2.5s",
     "beats": [{"say": "spoken line", "screen": "what is on screen"}, ...]}

Each beat gets the time it takes to say it at 150 words per minute. Spoken lines are burned in as
big captions, three words at a time, and any number in a line is drawn in yellow. A line that
contains [FILL] is drawn in red, because you have to write that part from your own playthrough.

With no --clip, each beat gets a coloured placeholder showing the shot to capture, so the preview
doubles as a shot list. With --clip, the clip is centre-cropped to 9:16 and looped to length. With
--audio, your voiceover is muxed in and the video is cut to whichever of the two is shorter.

Needs ffmpeg and Pillow. It never uploads anything.
"""
import json, os, re, shutil, subprocess, sys, tempfile, textwrap
from PIL import Image, ImageDraw, ImageFont

W, H, FPS, WPS = 1080, 1920, 30, 2.5          # 2.5 words per second = 150 wpm
FONT_DIR = "/usr/share/fonts/opentype/inter"
BLACK = os.path.join(FONT_DIR, "InterDisplay-Black.otf")
BOLD = os.path.join(FONT_DIR, "InterDisplay-Bold.otf")
HOOK_SECS = 2.5
PALETTE = ["#1b1033", "#0f2a3d", "#33140f", "#0f3324", "#2d0f33", "#33300f"]

def font(path, size):
    try: return ImageFont.truetype(path, size)
    except OSError: return ImageFont.load_default()

def chunks(line, n=3):
    w = line.split()
    return [" ".join(w[i:i + n]) for i in range(0, len(w), n)]

def outlined(d, xy, text, fnt, fill, stroke=9, anchor="mm"):
    d.text(xy, text, font=fnt, fill=fill, anchor=anchor, stroke_width=stroke, stroke_fill="black")

def frame(spec, beat, caption, t0, placeholder, beat_index):
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if placeholder:
        # the shot to capture, as a dashed card in the upper-middle of the frame
        x0, y0, x1, y1 = 90, 470, W - 90, 1010
        for x in range(x0, x1, 40): d.line([(x, y0), (min(x + 20, x1), y0)], fill="#ffffff66", width=4); d.line([(x, y1), (min(x + 20, x1), y1)], fill="#ffffff66", width=4)
        for y in range(y0, y1, 40): d.line([(x0, y), (x0, min(y + 20, y1))], fill="#ffffff66", width=4); d.line([(x1, y), (x1, min(y + 20, y1))], fill="#ffffff66", width=4)
        d.text((W // 2, y0 + 60), f"SHOT {beat_index + 1}", font=font(BOLD, 44), fill="#ffffffaa", anchor="mm")
        body = textwrap.fill(beat.get("screen", ""), 30)
        d.multiline_text((W // 2, (y0 + y1) // 2 + 30), body, font=font(BOLD, 50), fill="#ffffffdd",
                         anchor="mm", align="center", spacing=14)
    if t0 < HOOK_SECS and spec.get("hook_text"):
        # on-screen hook: different words from the spoken line, top of frame, first 2.5 seconds
        f = font(BLACK, 76)
        lines = textwrap.wrap(spec["hook_text"].upper(), 18)
        lh, pad, y = 92, 34, 150
        box_h = lh * len(lines) + pad * 2
        d.rounded_rectangle([70, y, W - 70, y + box_h], radius=28, fill="#ffd400")
        for i, ln in enumerate(lines):
            d.text((W // 2, y + pad + lh * i + lh // 2), ln, font=f, fill="black", anchor="mm")
    if caption:
        fill_mode = "[FILL" in beat["say"]
        f = font(BLACK, 96 if not fill_mode else 64)
        if fill_mode:
            text = textwrap.fill(caption, 26)
            outlined(d, (W // 2, 1300), text, f, "#ff4d4d")
        else:
            # draw word by word so numbers can be yellow
            words = caption.upper().split()
            size = 96
            while True:  # shrink until the line fits inside a 60px margin on each side
                f = font(BLACK, size)
                widths = [d.textlength(w + " ", font=f) for w in words]
                if sum(widths) - d.textlength(" ", font=f) <= W - 120 or size <= 56: break
                size -= 4
            x = W // 2 - sum(widths) // 2
            for w, wd in zip(words, widths):
                col = "#ffd400" if re.search(r"\d", w) else "white"
                outlined(d, (x, 1300), w, f, col, anchor="lm")
                x += wd
    return img

def timeline(spec):
    """Yield (start, duration, beat_index, caption) for every caption chunk."""
    t = 0.0
    for bi, beat in enumerate(spec["beats"]):
        say = beat["say"]
        if "[FILL" in say:
            dur = max(3.0, len(say.split()) / WPS)
            yield t, dur, bi, say; t += dur; continue
        parts = chunks(say)
        total = max(1.2, len(say.split()) / WPS)
        n = sum(len(p.split()) for p in parts)
        for p in parts:
            dur = total * len(p.split()) / n
            yield t, dur, bi, p; t += dur

def render(spec_path, out, clip=None, audio=None):
    spec = json.load(open(spec_path))
    tl = list(timeline(spec))
    # split any chunk that straddles the end of the hook card so the card disappears on time
    fixed = []
    for s, dur, bi, cap in tl:
        if s < HOOK_SECS < s + dur:
            fixed += [(s, HOOK_SECS - s, bi, cap), (HOOK_SECS, s + dur - HOOK_SECS, bi, cap)]
        else:
            fixed.append((s, dur, bi, cap))
    total = sum(x[1] for x in fixed)
    tmp = tempfile.mkdtemp(prefix="short_")
    try:
        lst = ["ffconcat version 1.0"]
        for i, (s, dur, bi, cap) in enumerate(fixed):
            p = os.path.join(tmp, f"o{i:04d}.png")
            frame(spec, spec["beats"][bi], cap, s, clip is None, bi).save(p)
            lst += [f"file '{p}'", f"duration {dur:.3f}"]
        lst.append(f"file '{p}'")
        open(os.path.join(tmp, "overlay.txt"), "w").write("\n".join(lst) + "\n")

        cmd = ["ffmpeg", "-y", "-loglevel", "error"]
        if clip:
            cmd += ["-stream_loop", "-1", "-i", clip]
            bg = (f"[0:v]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},"
                  f"fps={FPS},setsar=1,trim=duration={total:.3f}[bg]")
        else:
            # one colour per beat, switched at beat boundaries
            starts = {}
            for s, dur, bi, _ in fixed: starts.setdefault(bi, s)
            cmd += ["-f", "lavfi", "-i", f"color=c={PALETTE[0]}:s={W}x{H}:r={FPS}:d={total:.3f}"]
            draws = []
            for bi, s in starts.items():
                e = starts.get(bi + 1, total)
                draws.append(f"drawbox=x=0:y=0:w={W}:h={H}:color={PALETTE[bi % len(PALETTE)]}:t=fill:"
                             f"enable='between(t,{s:.3f},{e:.3f})'")
            bg = "[0:v]" + ",".join(draws) + "[bg]"
        cmd += ["-f", "concat", "-safe", "0", "-i", os.path.join(tmp, "overlay.txt")]
        if audio: cmd += ["-i", audio]
        fc = bg + f";[1:v]fps={FPS},format=rgba[ov];[bg][ov]overlay=0:0:format=auto,format=yuv420p[v]"
        cmd += ["-filter_complex", fc, "-map", "[v]"]
        if audio: cmd += ["-map", "2:a", "-c:a", "aac", "-b:a", "192k", "-shortest"]
        cmd += ["-t", f"{total:.3f}", "-c:v", "libx264", "-preset", "medium", "-crf", "20",
                "-movflags", "+faststart", out]
        subprocess.run(cmd, check=True)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    words = sum(len(b["say"].split()) for b in spec["beats"])
    print(f"{out}  {total:.1f}s  {words} words  {len(spec['beats'])} beats")

def main():
    a = sys.argv[1:]
    clip = a[a.index("--clip") + 1] if "--clip" in a else None
    audio = a[a.index("--audio") + 1] if "--audio" in a else None
    pos = [x for x in a if not x.startswith("--") and x not in (clip, audio)]
    if len(pos) != 2: print(__doc__); sys.exit(1)
    render(pos[0], pos[1], clip, audio)

if __name__ == "__main__":
    main()
