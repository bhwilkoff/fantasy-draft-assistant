# Live draft playbook — Harvey Cup, Sat Sep 5 2026, 2:00pm MDT

The whole point of this setup is that you do **not** walk in with a frozen
plan. The engine handles valuation; Claude handles judgement; you make the
pick. This is the runbook.

---

## T-minus 1 day

```bash
cd ~/Documents/GitHub/fantasy-draft-assistant
tools/draftday.sh              # pull, rebuild, test, publish, wait for Pages
```

That one script does everything the old four-line ritual did and then
confirms GitHub Pages is serving the new build before it says "ready".

Open `https://bhwilkoff.github.io/fantasy-draft-assistant/web/` and confirm the
header reads `12 teams · 1 PPR · 6pt pass TD` and the footer shows today's
build date. If it doesn't, the overlay will be wrong too.

**Install the userscript** (once). Install Tampermonkey from the Chrome
Web Store, open its dashboard, click "+" to create a new script, replace
the template with the contents of `bridge/loader.user.js`, save. Open any
draft room (a mock will do): the "Harvey Cup Advisor" panel appears top-right
within a few seconds of the player table rendering. That is the whole test. It is ten lines that pull the current bridge from
GitHub Pages every time a draft room opens, so nothing needs reinstalling
when something is fixed. It arms the advisory overlay only; the autopilot
never loads from it. If you'd rather not install anything, see "Arming by
hand" below.

## T-minus 2 hours — the last data refresh that matters

```bash
tools/draftday.sh
```

ADP moves hard in the final 48 hours and injury news moves harder. The build
pulls Sleeper's feed, which carries a `news_updated` timestamp per player and
tracks to within the hour — this is the single highest-value thing you can do
on draft day.

Then check what actually changed:

```bash
python3 tools/injury_report.py        # who moved, and how recently
```

## T-minus 30 minutes — be in the room

Enter the Harvey Cup draft room as soon as Yahoo lets you (the "Enter
Draft" link on the league page opens well before the clock starts). The
overlay arms itself when the player table renders, before pick one. Leave
**Autodraft off** -- the queue is for you to read, and you make every pick.

## T-minus 15 minutes — start the relay

```bash
python3 tools/draft_server.py         # leave running
```

Then in a **separate terminal**, start a Claude Code session in the repo and
tell it:

> Watch the draft. Poll `http://127.0.0.1:8830/state` every 20 seconds. When
> the pick number changes and I'm within 3 picks, read the state, think about
> it, and POST a short verdict to `/note`. Keep it under 40 words. Tell me
> when you disagree with the engine and why.

That session is the judgement layer. It sees the same board you do and writes
into the overlay.

## During the draft

The panel sits top-right of the Yahoo draft room and shows:

| Line | What it means |
|---|---|
| **Take** | highest VOR available that fills a slot you can use |
| **Then** | next best, with `% back` = probability he survives to your next pick |
| **Cost of waiting** | per position: what you lose by not taking it now, and who is likely to still be there |
| **Roster** | counts, with `need N` on any unfilled starting slot |
| **Claude** | the live note from your Claude session |

**The one rule:** the engine is a valuation machine, not an oracle. It cannot
read a beat writer. When Claude's note and the engine disagree, that
disagreement is the most valuable thing on the screen — read both, then pick.

### Arming by hand (what nine mocks taught, 2026-09-01)

If the userscript is not installed, or Yahoo tears the tab down, arm from
the console in two steps rather than one. Loading the whole chain into a
draft client that is still booting starved the renderer twice; the overlay
first, then the autopilot (mock rooms only), never froze:

```js
// step 1: overlay + data (always with a cache-buster; Pages caches 10 min)
window.__hcNoAutopilot = true;
document.head.appendChild(Object.assign(document.createElement('script'),
  {src:'https://bhwilkoff.github.io/fantasy-draft-assistant/bridge/arm.js?v='+Date.now()}));
// step 2 (MOCKS ONLY -- never in Harvey Cup): the autopilot, ~10 s later
document.head.appendChild(Object.assign(document.createElement('script'),
  {src:'https://bhwilkoff.github.io/fantasy-draft-assistant/bridge/autopilot.js?v='+Date.now()}));
```

Yahoo recreates the draft tab a few minutes into most rooms. The recreated
tab has no viewport (screenshots fail, scripts hang): open a NEW tab, go to
the same `/draftclient/f1/{league}/{slot}` URL, close the old one, re-arm.
Harvey Cup's team names are all distinct, so the strip reader will count
12; if the footer ever says otherwise, the Results tab's team list is
authoritative and a harvest fixes it.

### If the overlay breaks

Yahoo periodically tears down and recreates the draft tab, which kills the
injection. Re-arm from the browser console with one paste:

```js
var s=document.createElement('script');
s.src='https://bhwilkoff.github.io/fantasy-draft-assistant/bridge/arm.js?v='+Date.now();
document.head.appendChild(s);
```

Set `window.__hcNoAutopilot = true` first — **autopilot is for mock rooms
only**, it queues picks automatically and you do not want that in a real
draft.

### If the overlay breaks and you can't fix it

Open the standalone board on your phone or a second window:
`https://bhwilkoff.github.io/fantasy-draft-assistant/web/`. Set your draft
slot, click each player as he comes off the board, shift-click your own picks.
Same engine, same advice, no dependency on Yahoo's DOM. Keep this tab open
from the start so you are never scrambling.

## The known failure modes, and what they look like

| Symptom | Cause | Fix |
|---|---|---|
| "Only N players visible" warning | you filtered the Yahoo players table | clear the filter; the overlay only sees rendered rows |
| Panel shows a stale pick number | Yahoo re-rendered and the observer detached | re-arm (above) |
| `N unmatched` climbing in the footer | a name we can't resolve | harmless if small; if large, the data plane failed to load |
| Roster shows 0 of everything | team name not set | click **team**, enter it exactly as the room shows it |
| Advice looks RB-heavy and wrong | league detection fell back to mock defaults | check the footer says `Harvey Cup rules (room)` |

## After

The overlay harvests every roster during the final round and writes the
league-wide report by itself: a grade and summary for each team, the
values and reaches, the near misses, and a round-by-round story of the
draft. In the room's console:

```js
window.__hcReportShow()     // the report as plain text over the page; select all, copy
window.__hcReportHide()
```

It is also in `localStorage.hcReport`, and the harvest it was built from
in `localStorage.hcFinalHarvest`. Paste the report into
`data/harvey-cup-2026-report.md`; it is what "who am I up against" looks
like for the season, and the input for next year's calibration.

```bash
curl -s localhost:8830/log > data/harvey-cup-2026-draft.json
```

Every state the overlay pushed is in `data/draft_log.jsonl`, which is the
input for next year's calibration.
