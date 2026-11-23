# 5 Things You Can't Undo in GTA 6 (Do This First)

**Format:** The Warning. This was the top format among the GTA 6 Shorts outliers pulled on 2026-11-23
(median 11.7x each channel's own median, n=7). See `streaming/gta6/STREAMING.md`.
**Thumbnail:** your face mid-reaction + the moment from item 5. Text: **TOO LATE** (two words, not in the title).
**Title score:** 100 (`title.py`). A mobile feed shows "5 Things You Can't Undo in GTA 6 (Do...", so the subject survives the cut.

> **Before you record:** the five items come from **your own playthrough**. Each [FILL] is something you
> did or saw yourself on stream. If an item turns out not to be permanent, cut it. Don't stretch to five.
> If you end up with four, change the 5 in the title and hook to 4. No `voice.md` exists yet, so read
> every line out loud and rewrite anything you wouldn't say.

---

## The two hooks

**A. The Warning, 91 STRONG**
> "Before you play another hour of GTA 6, stop. There are 5 things you cannot undo, and almost nobody knows which."

```
SPECIFICITY   90   ADDRESS   96   STAKES   88   CURIOSITY   92   BREVITY   100
```

**B. The Question, 89 STRONG**
> "Why does nobody warn you before you play GTA 6? 5 things you cannot undo, and the last one almost cost me."

```
SPECIFICITY   84   ADDRESS  100   STAKES   88   CURIOSITY   92   BREVITY   100
```
Only use B if item 5 really did almost cost you something on stream. If it did, B is the stronger
hook, because it is your own story and you have the clip to prove it.

**Winner: A.** It uses *The Warning* formula, which fits because the whole video is a list of
warnings, and the "you cannot undo" stakes are what make someone pause and watch now instead of
saving it for later. (hookscore.py is a heuristic. Its calibration notes say it separates bad hooks
from real ones well, but separates a creator's hits from their misses barely at all.)

---

## The script

### 0:00 Hook
[ON SCREEN: you, close on camera, then a hard cut to the GTA 6 pause menu, frozen]

> Before you play another hour of GTA 6, stop. There are 5 things you cannot undo, and almost nobody knows which.

### 0:07 Proof the payoff exists
[ON SCREEN: fast 1-second flashes of all five moments from your VODs, numbered 1 to 5, no context]

> I found every one of these on stream, and I have the clips.

### 0:12 The turn
[ON SCREEN: a "1" card over gameplay]

> So here are all 5, in the order you will run into them. Number one is the first thing you hit.

*(No intro and no subscribe pitch here. Those are what cause the drop at 0:30.)*

### The five beats: use the same shape for each, about 45 to 60 seconds apiece

For each item:

1. **Name it in one line.** [ON SCREEN: number card + the thing itself, visible within a second]
   > "[FILL: item N, named in one line, the way you'd say it to a friend]"
2. **Show it happening.** [ON SCREEN: your VOD clip of the moment. Find the timestamp with `streaming/stream_clips.py`.]
   > "[FILL: what happened, 2-3 sentences, past tense, from your stream]"
3. **Why you can't undo it.** [ON SCREEN: the result: the menu, the empty slot, the locked choice]
   > "[FILL: the consequence. Only state what you checked yourself, with no made-up numbers.]"
4. **What to do instead.** [ON SCREEN: doing it the right way, or a text card if you can't re-record it]
   > "[FILL: the one thing to do instead, in one sentence]"

**Order the five like this:**
- **1:** the earliest in the game, so it confirms the title right away.
- **2-4:** the middle items. Put the most visual one at 3 to break up the middle.
- **5:** the most costly, and save your best clip for it. If you used hook B, this is the one that "almost cost" you.

Between items, use a single line, never a recap:
> "That's one. Number two is worse."  /  "Three is the one I see in chat the most."

Only use the chat line if it's true.

### Payoff
[ON SCREEN: all five numbered cards stacked on one screen, held for 3 seconds]

> That's all 5. Here they are on one screen. Screenshot it before your next session.

### Close: one ask
[ON SCREEN: you on camera, then an end screen pointing to the VOD of the stream where #5 happened]

> If you want to watch number five happen live, the full stream is right here.

*(One ask only. It sends them to your VOD, which helps your streaming channel more than a subscribe pitch.)*

---

## Runtime estimate (150 wpm)

| Part | Words | Time |
|---|---|---|
| Hook + proof + turn | 54 | 0:22 |
| 5 items × ~110 words (4 lines each, with your [FILL]s) | ~550 | ~3:40 |
| Transitions | ~30 | 0:12 |
| Payoff + close | 30 | 0:12 |
| **Total** | **~664** | **~4:25** |

That's about 4.5 minutes, short enough for a list video that people finish. If an item runs past
70 seconds, cut it down rather than slowing the pace.

## After you record
- Edit: `python3 .claude/skills/yt-edit/deadair.py take.srt` cuts dead air and retakes.
- Chapters: one per item. `python3 .claude/skills/yt-chapters/chapters.py final.srt`, then retitle each chapter to the item.
- Shorts: each item is a ready-made Short. Item 5 goes first.

---

```
TITLE:     5 Things You Can't Undo in GTA 6 (Do This First)
THUMBNAIL: your reaction + the item 5 moment, text: TOO LATE
HOOK:      Before you play another hour of GTA 6, stop. There are 5 things you
           cannot undo, and almost nobody knows which.
CLOSE:     If you want to watch number five happen live, the full stream is right here.
```

**Ship it, or change it?**
