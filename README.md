# Harvey Cup Draft Assistant

A projection engine, a draft simulator, and a live draft advisor that runs
inside the Yahoo draft room. Built for one league -- **Harvey Cup**
(`football.fantasysports.yahoo.com/f1/539156`, 12 teams, snake, full PPR,
6-point passing TDs, drafting **Sat Sep 5 2026, 2:00pm MDT**) -- and
configured entirely from one file, so it points at another league by
editing `config/league.json`.

Everything it recommends comes from its own valuation: ESPN's and Sleeper's
raw stat projections blended per stat, scored under the league's exact
rules, valued against a replacement level simulated from the league's real
lineup, and timed against the specific opponents in the room. Yahoo's own
rankings are used for one thing only: predicting what an *autodrafting*
opponent will take.

## Start here

| If you want to... | Read / run |
|---|---|
| get the board current and publish it, in one command | `tools/draftday.sh` |
| run the draft on Saturday | [docs/LIVE-DRAFT-PLAYBOOK.md](docs/LIVE-DRAFT-PLAYBOOK.md) |
| understand why it values players the way it does | [docs/METHOD.md](docs/METHOD.md) |
| see what was measured to work and what loses | [docs/STRATEGY.md](docs/STRATEGY.md) |
| understand how the code fits together | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| point it at a different league, or build on it | [docs/ADAPTING.md](docs/ADAPTING.md) |
| plan the in-season (lineup, waiver) scope | [docs/IN-SEASON-LINEUPS.md](docs/IN-SEASON-LINEUPS.md) |
| know why each design choice was made | [DECISIONS.md](DECISIONS.md) |
| see every mock draft and what it found | [data/mocks/RESULTS.md](data/mocks/RESULTS.md) |

## Quick start

```bash
git clone https://github.com/bhwilkoff/fantasy-draft-assistant && cd fantasy-draft-assistant
npm install                      # jsdom, for the DOM tests only
python3 engine/build.py          # fetch projections, injuries, ADP -> data/players.json
./run_tests.sh                   # must print ALL TESTS PASS
python3 -m http.server 8777      # then open http://localhost:8777/web/
```

Python 3.9+ and Node 18+; no other dependencies. The build talks to four
public, unauthenticated endpoints (ESPN, Sleeper x2, FantasyFootballCalculator).

## The three ways to use it

**1. Overlay in the Yahoo draft room (the real draft).** Install
`bridge/loader.user.js` in Tampermonkey once. It pulls the current bridge
from GitHub Pages every time a draft room opens, so a fix pushed to `main`
is live in the next room without reinstalling. The overlay reads the room's
DOM, matches the ~100 rendered players to the projection set, and shows the
recommendation, alternatives with survival odds, cost of waiting by
position, roster needs, and each source's projection for the pick. You make
the pick. Without the userscript, arm it from the console with the line
`tools/draftday.sh` prints.

**2. The standalone board** (`web/`, also at
`https://bhwilkoff.github.io/fantasy-draft-assistant/web/`). The same
advisor against the same data with no dependency on Yahoo's DOM: set your
slot, click a player as he goes, shift-click your own picks. It is the
pre-draft study tool and the fallback if Yahoo redeploys.

**3. Mock-draft autopilot** (mock rooms only). `bridge/autopilot.js` keeps
Yahoo's queue equal to the advisor's current ranking and turns Autodraft on,
so a mock room drafts the board by itself; it audits every pick the room
takes against the advice, harvests all rosters, and grades the draft. Nine
mocks so far; see `data/mocks/RESULTS.md`.

## How it is built

```
config/league.json      the league: teams, rounds, lineup, bench, scoring
        |
engine/build.py         ESPN + Sleeper stat lines -> blend -> score under the
        |               league's rules -> replacement level -> VOR, tiers,
        |               ADP, injuries, byes, uncertainty  ->  data/players.json
        v
data/players.json  ---> web/  (board)   ---> bridge/ (overlay + autopilot)
        |                 advisor.js  <----------  shared, one algorithm
        v
engine/sim.py + season.py    thousands of drafts and seasons, scored on
                             TITLE ODDS, to decide what the advisor does
```

The valuation is deliberately boring and was arrived at by measurement:
take the most valuable player you can still use, with a small nudge toward
an empty starting slot and a discount for anyone who would sit on the
bench. Every cleverer rule that was tried (positional cliffs, lookahead,
availability tie-breaks, ceiling chasing, bye-week spreading, QB/WR
stacking, receivers-early) was implemented, simulated, and found to lose or
to be noise. `docs/STRATEGY.md` has the numbers.

## Repository map

```
config/league.json         the one file that describes the league
engine/                    Python
  league.py                  loads the config; every league number lives here
  build.py                   the pipeline -> data/players.json, data/meta.json
  sources/espn.py            ESPN raw stat projections + ESPN ADP
  sources/sleeper_proj.py    Sleeper raw stat projections (second source)
  sources/sleeper.py         Sleeper player feed: injuries, depth chart, age
  sources/ffc.py             FantasyFootballCalculator ADP + stdev + byes
  names.py                   name/team normalisation across sources and the room
  scoring.py                 raw stat line -> points under the league's rules
  vor.py                     simulated replacement level, VOR, tiers, survival
  upside.py                  per-player uncertainty -> ceiling / floor
  opponents.py               roster-aware availability (who picks before you)
  advisor.py                 the recommendation (mirrored in web/advisor.js)
  sim.py                     draft simulator, strategy comparisons
  season.py                  14-week H2H season + playoffs, byes, teammate
                             correlation; scores strategies by title odds
web/                       browser, no build step
  league.js                  parse a lineup, score a stat line, replacement level
  advisor.js                 the recommendation (mirrored in engine/advisor.py)
  app.js, index.html         the standalone board
bridge/                    inside the Yahoo draft room
  loader.user.js             install this: pulls arm.js fresh every room
  arm.js                     loads the stack in order; event-driven autopilot arm
  yahoo-draft-bridge.user.js the overlay: DOM readers, league detection, panel
  opponents.js               port of engine/opponents.py + autodrafter detection
  autopilot.js               mock rooms: queue actuator, pick log, audit, reseed
  harvest.js                 read every roster (and Yahoo's projections) from the room
  grade.js                   grade a harvested draft under the room's rules
  supervise.js               one call: inspect the room, fix what it can
tools/
  draftday.sh                pull, build, test, publish, wait for Pages
  draft_server.py            localhost relay so a Claude session can annotate picks
  draft_watch.py             turns relay state into a brief worth reasoning over
  injury_report.py           who moved on the injury wire, ranked by ADP
  score_mock.py              offline grader for a harvested mock
  consensus_test.py          single source vs consensus, out of sample
tests/                     run_tests.sh runs all of them
data/                      players.json + meta.json (built), mocks/RESULTS.md
docs/                      method, strategy, playbook, architecture, adapting,
                           in-season plan, room recon, hidden-tab constraints
```

## Status (2026-09-02)

The harness has run nine live mock drafts. It survives Yahoo's tab
teardowns, detects the room's rules and team count, matches names at
`unmatched <= 1/100`, keeps the queue equal to the live advice, re-reads its
roster from the Results tab after every pick, and grades the result. The
first mechanism-clean draft on a single projection source finished last;
the consensus board finished 7th and then 3rd. Every defect found on the way
is in `DECISIONS.md` (sixteen decisions), and every one of them produced a
confident wrong answer rather than an error, which is why the thing is run
live at all.

Known limits: kicker and defense projections are ESPN-only; the relay to a
Claude session needs the userscript to reach localhost from an https page;
Yahoo mock rooms play Yahoo's default rules, so a mock finish measures the
mechanism far better than it measures the valuation.

## Data

ESPN and Sleeper (projections), Sleeper (injuries), FantasyFootballCalculator
(ADP). None is affiliated with this project. Refresh the morning of the
draft: ADP moves in the last 48 hours and injury statuses move more.
