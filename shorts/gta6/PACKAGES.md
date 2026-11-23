# GTA 6 Shorts: five packages

GTA 6 launched on **November 19, 2026** on PS5 and Xbox Series X|S. Every factual line below is
tied to a source at the bottom. Nothing here is a sales figure or a claim about the game's content
that has not been checked. Where a Short needs something only your own playthrough can give, the
script says **[FILL]**. In the preview it shows up in red.

`renders/*.mp4` are 1080x1920 previews. Each placeholder card is the shot to capture, so the
preview also works as your shot list. To build the real Short from your own footage and voiceover:

```bash
python3 shorts/make_short.py shorts/gta6/01-pc-date.json out.mp4 --clip my_gameplay.mp4 --audio my_vo.m4a
```

**Footage rule:** capture your own gameplay. Re-uploading Rockstar's trailers or other creators'
clips is how a GTA channel collects copyright strikes in launch week.

Hooks were scored with `hookscore.py` (a heuristic, not a predictor). Titles were linted with
`title.py`.

| # | Short | Type | Hook score | Title score | Length |
|---|---|---|---|---|---|
| 1 | PC release date | news, ready now | 67 | 98 | 37s |
| 2 | PS5 crash CE-108255-1 | news + your fix | 70 | 80 | 36s |
| 3 | Where is Online? | news, ready now | 56 | 100 | 34s |
| 4 | Detail you missed | gameplay find | 69 | 100 | 26s |
| 5 | Your first 10 minutes | gameplay tip | 67 | 98 | 28s |

**Post order:** 1 and 3 first. They need no [FILL], and the questions behind them are being
searched right now. Post 2 only once you have a fix you've tested yourself. 4 and 5 are the
long-tail ones and depend on what you find in-game.

---

## 1. PC release date
- **Title:** GTA 6 PC Release Date: What's Real (2027?)
- **On-screen hook (first 2.5s):** PC PLAYERS: READ THIS FIRST
- **Spoken hook:** "If you are waiting for GTA 6 on PC, stop refreshing. Here is what is actually known." (The Mistake, 67)
- **Loop:** it ends on "stop refreshing" and loops back into the hook, which opens on the same idea.
- **Description:** GTA 6 is out on PS5 and Xbox Series X|S. PC has no official date. The report saying early 2027 is a report, not Rockstar. #GTA6 #Shorts #GTA6PC
- **Facts used:** console launch on Nov 19 [1]. No official PC date, and GamesBeat reports Q1 2027 [2]. GTA 5 came to consoles in Sept 2013 and PC in April 2015.

## 2. PS5 crash CE-108255-1
- **Title:** GTA 6 PS5 Crash CE-108255-1: Check This First (the "shouting" flag is the error code. Keep it, because it's the search term.)
- **On-screen hook:** DON'T REINSTALL YET
- **Spoken hook:** "Why is your PS5 crashing in GTA 6? Before you reinstall, check this one error code." (The Question, 70)
- **[FILL] beat 4:** the exact fix that worked for you. **Do not post this Short with a fix you haven't tested.** If you don't have one, drop this Short.
- **Description:** Getting CE-108255-1 in GTA 6 on PS5? Here's what fixed it for me. #GTA6 #PS5 #Shorts
- **Facts used:** crashes with this code reported on some PS5s [1].

## 3. Where is GTA 6 Online?
- **Title:** Where Is GTA 6 Online? (2027 Report)
- **On-screen hook:** NOTHING IS BROKEN
- **Spoken hook:** "Why can you not find GTA Online in GTA 6? You did not miss a menu. It is not out yet." (The Question, 56. This is the weakest hook of the five, but the search demand is the strongest.)
- **Description:** GTA 6 launched without the new Online mode. No official date yet. Bloomberg's Jason Schreier reports 2027. #GTA6 #GTAOnline #Shorts
- **Facts used:** no confirmed Online date, and expected in 2027 per Jason Schreier [3].

## 4. The detail you drove past
- **Title:** You Missed This on GTA 6's First Street
- **On-screen hook:** LOOK LEFT
- **Spoken hook:** "Why did nobody notice this in GTA 6? You drove past it before you even left the first street." (The Question, 69)
- **[FILL] beats 2 and 3:** something **you** found. Run your own first line through `hookscore.py` once it's written.
- **Format:** a normal-speed drive-by, then the same shot slowed down with the detail circled. The slow-mo is the reason people rewatch.

## 5. Your first 10 minutes
- **Title:** Don't Do This in Your First Hour of GTA 6
- **On-screen hook:** DO THIS BEFORE YOU LEAVE
- **Spoken hook:** "You missed this in GTA 6 in your first 10 minutes. Stop and look left before you leave." (The Warning, 67)
- **[FILL] beats 2 and 3:** the early action and what it gets you later. Check "10 minutes" against your own run, and change the number if it isn't true.

---

### Before you post any of them
- A `voice.md` doesn't exist yet, so these scripts are in a neutral voice. Read each one out loud and change any word you wouldn't actually say.
- Nothing here publishes. You record, you render, you upload.

### Sources
1. [GameSpot GTA 6 Launch Center](https://www.gamespot.com/gta-vi-countdown/): Nov 19, 2026 launch on PS5 and Xbox Series X|S, and the CE-108255-1 PS5 crash reports.
2. [ScreenRant on the PC release report](https://screenrant.com/gta-6-pc-release-date-update-november-2026/): GamesBeat report of a PC release in Q1 2027, which Rockstar has not confirmed.
3. [Covers: GTA 6 Online release date](https://www.covers.com/entertainment/gta-6-online-release-date): no confirmed date, and the Jason Schreier report of 2027.

**Ship it, or change it?**
