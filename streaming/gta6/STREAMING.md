# GTA 6 streaming kit: packaging, and the Shorts inside your streams

There are three parts: (1) what is going viral in GTA 6 Shorts right now, (2) how to package each
stream, and (3) how to pull Shorts out of your VODs.

---

## 1. What is going viral in GTA 6 Shorts (pulled 2026-11-23)

**Method:** I collected 4,091 Shorts from 124 channels that show up for GTA 6 searches, using the
last 40 Shorts from each channel. Each Short was scored as a **multiple of its own channel's median
views**, so a small channel's breakout counts as much as a big channel's normal day. 127 GTA 6
Shorts did 3x or better on channels with a median of at least 2,000 views. The full list is in
[`viral_outliers.csv`](viral_outliers.csv).

**Caveats:** this comes from public channel listings only, with no logged-in data. Listings don't
include upload dates, so some outliers are from the pre-launch trailer period. The buckets below
come from title keywords, which says what the title promised, not why the video worked. Small
buckets (n=7) are a signal to try something, not proof.

| What the Short promised | Count | Median multiple | Best examples |
|---|---|---|---|
| **A warning: do this first / you can't undo it** | 7 | **11.7x** | "IMPORTANT: Do This Before You Play GTA 6" (32.7x), IGN "one criminal profile you can't go back from" (11.7x), "THREE TIPS Before You Get Started" (14.3x) |
| **Mundane realism: NPCs, groceries, traffic** | 10 | **7.3x** | "You Can Buy Groceries In GTA 6" (57.4x on a 3.5k-median channel), "Funny NPC interaction in GTA 6" (14.9x) |
| Funny / chaos / "unplayable" | 7 | 6.0x | "GTA 6 is literally unplayable🥀" (33.9x) |
| Hidden detail / easter egg | 11 | 5.6x | "GTA 6 Just Brought THIS Back" (15.9x), "MICHAEL RETURNS IN GTA 6 EASTER EGG" (13.5x) |
| Real-world comparison | 7 | 5.4x | "GTA 6's Entire Map on REAL Florida" (30.7x), "Looks like Miami, right...?" (23.4x) |
| Everything else (news, trailers, showcases) | 85 | 4.9x | First-person driving gameplay (71.5x), and Rockstar's own uploads |

**What they share:** the top outliers promise **one specific thing you can see in under a
second**: groceries, a single warning, one NPC. Nobody is cutting a "best moments" montage.
The title names the thing, and the clip proves it immediately.

**What this means for your streams.** These are the moments to watch for live and clip later:
1. **Anything you can't undo**: a choice, a lost item, a mistake. Say "don't do what I just did"
   on stream, then clip it. This is the highest-multiple format above, and your 05 Short already uses it.
2. **Everyday-life moments**: an NPC reacting, shopping, small details that make the world feel
   real. They're cheap to get and they keep showing up as outliers.
3. **Chaos with chat reacting**: this is where a streamer has the advantage. `stream_clips.py`
   finds these from chat spikes.

---

## 2. Stream packaging

### Live title
Format: **`GTA 6 Day {N}: {the one thing this stream does} | LIVE`**. GTA 6 launched on
Nov 19, so today (Nov 23) is **Day 5**. Every option below scored 98-100 in `title.py`:

- `GTA 6 Day 5: Story Mode Blind Playthrough | LIVE`
- `GTA 6 Day 5 - Chat Picks Every Choice | LIVE` (works best with the "can't undo" format above)
- `GTA 6 Day 5 - First Playthrough, No Spoilers (PS5)` (change PS5 to whatever you play on)
- `Playing GTA 6 Until I Finish the Story - Day 5`

Put the number and the one-line promise inside the first 40 characters, because mobile cuts the rest.

### When the stream ends, retitle the VOD
A live title sells "now". A VOD title has to sell what happened. Retitle it after the biggest
moment `stream_clips.py` finds, e.g. `GTA 6 Day 5: {the moment}`. Run it through
`python3 .claude/skills/yt-package/title.py --title "..."` first.

### Description (first two lines are all anyone reads)
```
GTA 6 Day {N}: {what happened, in the words someone would search}.
{Chapters go here, from: python3 .claude/skills/yt-chapters/chapters.py vod.srt}

{Your schedule: when you go live}
#GTA6 #GTA6Live #GTAVI
```

### Tags (fewer is fine; they barely matter)
`gta 6, gta 6 live, gta 6 gameplay, gta 6 playthrough, gta vi, grand theft auto 6, gta 6 day {N}`

### Thumbnail
Three words maximum, and none of them can repeat the title. One face reacting, plus the one thing
from the moment. `DAY 5` alone is not a thumbnail.

---

## 3. Shorts from your streams

```bash
# 1. get the VOD's transcript and the live-chat replay (run this on your own computer)
yt-dlp --skip-download --write-subs --write-auto-subs --sub-langs en --convert-subs srt \
       -o vod "https://www.youtube.com/watch?v=YOUR_VOD"            # -> vod.en.srt
yt-dlp --skip-download --write-subs --sub-langs live_chat \
       -o vod "https://www.youtube.com/watch?v=YOUR_VOD"            # -> vod.live_chat.json
yt-dlp -f "bv*[height<=1080]+ba/b" --merge-output-format mp4 -o vod.mp4 "https://www.youtube.com/watch?v=YOUR_VOD"
#    (no captions? whisper vod.mp4 --output_format srt)

# 2. find the moments: chat spikes + reactions + clean start/end
python3 streaming/stream_clips.py vod.en.srt --chat vod.live_chat.json --top 10

# 3. cut the best ones to 9:16
python3 streaming/stream_clips.py vod.en.srt --chat vod.live_chat.json --top 5 --cut vod.mp4
```

Then, for each clip:
- Write a **new first line**. The stream line assumes context a stranger doesn't have. Score it
  with `python3 .claude/skills/yt-script/hookscore.py --hook "..."`.
- Title it after the one thing it shows (see section 1), and check it with `title.py`.
- Post it within a day or two of the stream while the moment is fresh, and link the VOD in the description.

I tested `stream_clips.py` on a synthetic 10-minute stream with a planted chat spike. It picked
exactly that 20-second moment, both with chat and from the transcript alone. It hasn't been run
on a real VOD yet, so send me one and I'll check the picks with you.

**Ship it, or change it?**
