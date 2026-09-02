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
3. **Do not wait for "Draft has Started".** The waiting-room countdown
   freezes in a background tab, and a mock room starts drafting the second
   it opens, so entering on the button costs the first pick (or, if the
   tab was frozen for a while, the first several rounds: mock 10501714).
   About a minute before the countdown ends, go straight to
   `/draftclient/f1/{mlid}/{slot}` (both numbers are on the waiting-room
   URL and page) and arm there; the client shows "Downloading player data"
   until the room opens, and an armed overlay is ready for pick one. With
   `bridge/loader.user.js` installed this arming is automatic.
4. In the draft room console, arm in two steps (the overlay first; loading
   the whole chain into a client that is still booting has starved the
   renderer):

```js
// step 1: overlay + data
window.__hcNoAutopilot = true;
document.head.appendChild(Object.assign(document.createElement('script'),
  {src:'https://bhwilkoff.github.io/fantasy-draft-assistant/bridge/arm.js?v='+Date.now()}));
// step 2, ~10 s later: the autopilot
document.head.appendChild(Object.assign(document.createElement('script'),
  {src:'https://bhwilkoff.github.io/fantasy-draft-assistant/bridge/autopilot.js?v='+Date.now()}));
```

If `bridge/loader.user.js` is installed, step 1 has already happened by the
time the player table renders; only step 2 is needed -- or, for mocks, run
`localStorage.setItem('hcMockAutopilot','1')` once and the loader does step
2 as well (remove the flag before the real draft). Always use a
cache-buster: GitHub Pages serves a ten-minute cache. The
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

## Autodraft stays off (2026-09-02)

Yahoo drafts the top of your queue when your clock expires whether or not
Autodraft is on. With it off, the actuator has the full clock to settle the
queue and a burst of instant picks cannot outrun it; with it on, Yahoo
picks the instant the turn opens. The autopilot therefore leaves Autodraft
alone. For a fast unattended mock, `localStorage.setItem('hcMockAutodraft','1')`
makes it switch Autodraft on once the draft has started.

## Two things only a human at the keyboard can fix (2026-09-02)

**A native dialog.** Yahoo raises a blocking `alert` when it moves an
inactive team into auto-pick mode ("you have been put into auto pick mode
due to inactivity"). While it is up, the page's event loop is stopped:
every pass, the overlay, and any script evaluation from outside hang, and
the tab title stops advancing. The room looks frozen for minutes and then
resumes when someone clicks OK. The mock autopilot now overrides
`alert`/`confirm`/`prompt` to be non-blocking (`__hcDialogs` keeps what
was said), but that only helps once it is loaded; a dialog raised before
arming still needs a click.

**Memory Saver.** Chrome discards a background tab under memory pressure
and restores it on the next access; the restored tab has a NEW tab id, a
freshly reloaded page (every injected script gone), and spends its first
minute in "Downloading player data" with the renderer pegged. That is the
"tab recreated on entry" pattern. Fix it once: `chrome://settings/performance`
-> Memory Saver -> "Always keep these sites active" -> add
`football.fantasysports.yahoo.com`. Keeping the draft tab as the active
tab of a visible window also prevents it. With `bridge/loader.user.js`
installed the overlay re-arms itself after every restore regardless.

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
