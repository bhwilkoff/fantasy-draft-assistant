# Harvey Cup Draft Assistant

A projection + VOR engine and a live draft advisor for a specific Yahoo
league: **Harvey Cup** (`football.fantasysports.yahoo.com/f1/539156`), 12
teams, snake, drafting **Sat Sep 5 2026, 2:00pm MDT**.

It is built around this league's actual rules rather than a generic board,
because two of them are non-default and both change who you should draft:

* **Full PPR** (1.0 per reception, Yahoo default is 0.5)
* **6-point passing TDs** (Yahoo default is 4)
* Starters: **QB · WR · WR · WR · RB · RB · TE · W/T · W/R · K · DEF** + 6 bench

Three WR starters plus two WR-eligible flex spots mean **47 wide receivers are
startable league-wide**. That single number reshapes the whole board, and it
is computed, not assumed — see [docs/METHOD.md](docs/METHOD.md).

## What's here

```
engine/          Python: fetch -> score -> VOR -> data/players.json
  league.py        Harvey Cup rules, scraped from the league settings page
  scoring.py       raw stat line -> Harvey Cup points
  vor.py           simulated replacement levels, tiers, survival probability
  advisor.py       the live recommendation
  sim.py           offline draft simulator + projection-error test
  build.py         the pipeline
web/             Vanilla JS board (no build step)
  advisor.js       port of advisor.py, shared with the bridge
  index.html       standalone board / manual draft tracker
bridge/          Userscript that overlays advice inside the Yahoo draft room
tests/           Python<->JS parity, name matching, DOM readers
docs/            METHOD.md, YAHOO-DRAFT-ROOM-RECON.md
```

## Quick start

```bash
python3 engine/build.py          # fetch projections + ADP, write data/players.json
python3 -m http.server 8777      # then open http://localhost:8777/web/
```

Run the tests:

```bash
./run_tests.sh
```

## Using it on draft day

**Option A — overlay inside the Yahoo draft room (preferred).** Install
`bridge/yahoo-draft-bridge.user.js` in Tampermonkey/Violentmonkey. It matches
`/draftclient/*`, reads the live room, and floats a panel with the
recommendation. It needs `data/players.json` served over **https** (GitHub
Pages is set up for this); a page on `https://` cannot fetch `http://localhost`.

Click **team** in the panel once and enter your team name exactly as the draft
room shows it, so roster needs are tracked. In a mock room that name is
literally `You`; in a real league it is your team name.

**Keep the players table sorted by rank/ADP and unfiltered.** Yahoo only
renders about 100 rows at a time, and the bridge can only see what is
rendered — the footer shows how many it matched. The top ~100 by ADP always
contains every player worth considering, but if you filter the table to one
position, the overlay's view of the board narrows with it.

**Option B — the standalone board.** Open `web/index.html`, set your draft
slot, click a player to mark him drafted, shift-click to mark him yours. This
is the fallback if Yahoo redeploys and the overlay's selectors break, and it
is also the pre-draft study tool.

Refresh the data the morning of the draft — ADP moves a lot in the last 48
hours, and injury statuses move more:

```bash
python3 engine/build.py && git commit -am "refresh projections" && git push
```

## How it reads the draft room

The draft client is a React SPA that receives picks over a **single
long-lived WebSocket opened during page load** — hooking it after load
captures nothing, and there is no XHR polling to read instead. So the bridge
reads the **DOM**, binding only to Yahoo's stable semantic hooks
(`.ys-player[data-id]`, `.ys-draftorder-current`) and never to the hashed
CSS-in-JS class names, which churn on every deploy. Full findings, including
the URL patterns and the exact table schema, are in
[docs/YAHOO-DRAFT-ROOM-RECON.md](docs/YAHOO-DRAFT-ROOM-RECON.md).

## Honest limits

The engine is only as good as ESPN's projections, which are its single
forecast source. The simulator shows the *method* beats ADP drafting by a wide
margin even when projections are badly wrong (finish 3.17/12 vs 5.62/12 at 35%
error), but it cannot tell you ESPN is right about any particular player.
Full list of known gaps: [docs/METHOD.md](docs/METHOD.md) §6.

Data: ESPN (projections), FantasyFootballCalculator (ADP, 8,234 drafts).
Neither is affiliated with this project.
