# Running Yahoo mock drafts against the advisor

## What mocks are and are not good for

Worth being precise, because it changes how many you need.

**Mocks validate the harness.** Does the overlay read the room correctly, does
name matching resolve "T. Higgins", does roster tracking attribute the right
picks, does the league detector notice the room's rules? These are yes/no
questions and a handful of drafts answers them.

**Mocks do not validate the strategy for Harvey Cup.** Yahoo mock rooms run
**default settings** — `QB, WR, WR, RB, RB, TE, W/R/T, K, DEF`, half PPR,
4-point passing TDs. Under those rules only 29 WRs start and the board is
RB-heavy; under Harvey Cup's 47 WRs it is not. A strategy conclusion drawn
from mocks is a conclusion about a different game.

That is why the overlay detects the room's own rulebook (so mock advice is at
least *correct for the mock*), and why strategy questions are answered in
`engine/sim.py` + `engine/season.py`, where thousands of Harvey Cup drafts can
run in minutes instead of thirty minutes apiece.

## Running one

1. Open the mock lobby: `football.fantasysports.yahoo.com/f1/mock_lobby`
2. Click **12 Team** — this auto-joins the next 12-team room (matching Harvey
   Cup's size) rather than the 14-team default.
3. When "Draft has Started" appears, click **Enter Draft**.
4. In the draft room console, arm the stack:

```js
var s=document.createElement('script');
s.src='https://bhwilkoff.github.io/fantasy-draft-assistant/bridge/arm.js?v='+Date.now();
document.head.appendChild(s);
```

That loads `league.js` → `advisor.js` → the overlay → `autopilot.js`. The
autopilot keeps Yahoo's **queue** synced to current advice and switches
**Autodraft** on, so the room drafts your board for you. It deliberately does
not click a "Draft Player" button: that button exists only during your own 60
second window, and a missed click is a lost pick.

Check it took:

```js
JSON.stringify(window.__hcAuto.last)
```

5. Optional — capture the draft. Start `python3 tools/draft_server.py` first
   and the autopilot posts every state to it; the log lands in
   `data/draft_log.jsonl`.

## Known instability (budget for this)

The Yahoo draft client is heavy and, driven through browser automation, it
misbehaves in four repeatable ways:

| Symptom | Cause | Recovery |
|---|---|---|
| Countdown appears frozen | **Chrome throttles background-tab timers.** The clock is real; the page just is not ticking. | Keep the Chrome window **focused and visible**, or reload for a true value |
| "Renderer may be frozen", script injection timeouts | same throttling, plus a heavy SPA | focus the window; wait; reload |
| Tab ID changes mid-draft | Yahoo tears down and recreates the draft tab | re-resolve the tab, re-arm |
| "Extension must request permission" | permission drops with the recreated tab | re-navigate to the URL |

**The single most effective mitigation is keeping the Chrome window in the
foreground and un-minimised.** Most of the above is Chrome's background-tab
throttling rather than anything specific to Yahoo.

Budget roughly **30 minutes per mock** (10 waiting for the room to fill, 20
drafting). Twenty mocks is therefore a ten-hour exercise, which is why the
statistical work lives in the offline simulator and mocks are reserved for
harness validation.

## Recovery, in the order it actually happens (2026-09-01)

Yahoo recreates the draft tab a few minutes in. The symptoms, in order:
the tab ID changes, a script evaluation hangs for its full 45 s timeout,
and a screenshot fails with "extension must request permission". All three
are the same event. The room keeps drafting the whole time -- a mock room
moves a full round every 2-4 minutes, so one stuck evaluation costs picks.

```js
// 1. do NOT reuse the recreated tab: it lives in a zero-size window and can
//    never be screenshotted again (docs/HIDDEN-TAB-CONSTRAINTS.md). Create a
//    fresh tab, navigate it to the SAME draftclient URL, close the zombie.
// 2. arm with the one-liner (the multi-line var s=... form is rejected by
//    the browser tool as "query string data")
document.head.appendChild(Object.assign(document.createElement('script'),
  {src:'https://bhwilkoff.github.io/fantasy-draft-assistant/bridge/arm.js'}));
// 3. picks landed while blind, so rebuild the roster from the Results tab
await window.__hcAuto.seedRosterFromResults();
// 4. confirm every pick since arming took the queue top
window.__hcAuto.audit();
```

`__hcStatus()` after a re-arm should show `restored=N` (the pick log came
back from localStorage) and `seed=N` (the roster came from the Results
tab). If `rosterSize` is not 15 in a mock, the flex slot was dropped: set
`window.__hcRosterText='QB,WR,WR,RB,RB,TE,W/R/T,K,DEF,BN,BN,BN,BN,BN,BN'`.

## What to check after each mock

```js
window.__hcAuto.log        // one entry per pick we advised on
window.__hcAuto.last       // poolSize, unmatched, recommendation
```

* `unmatched` should stay near zero. If it climbs, the name matcher has hit
  players outside the projection set — usually deep bench players, harmless,
  but a spike means the data plane failed to load.
* `poolSize` should be ~100 (Yahoo renders about that many rows). Much lower
  means the players table is filtered.
* The footer should read the room's detected rulebook, not the fallback.
