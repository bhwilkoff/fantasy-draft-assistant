# Architecture reference

This is the map of the code: what each module owns, the shape of the data
that flows between them, the contract the browser side has with Yahoo's
draft room, and what each test guards. Read `METHOD.md` first for *why* the
valuation works the way it does; this document is about *where*.

## 1. The three layers

```
 offline (Python)            static data              live (browser JS)
 ----------------            -----------              -----------------
 config/league.json  ---->  data/meta.json   ---->   web/league.js applies the
 engine/build.py     ---->  data/players.json ---->  same rules; web/advisor.js
 engine/sim.py, season.py                            recommends; bridge/* reads
 (strategy decisions)                                the room and (mocks) acts
```

* **Offline** builds the projection set and decides strategy by simulation.
  It runs on your machine, minutes before the draft or weeks before.
* **Static data** is two JSON files committed to the repo and served by
  GitHub Pages. Everything the browser needs is in them; the browser never
  calls an API.
* **Live** is vanilla JavaScript loaded into the Yahoo draft room (or the
  standalone board). It re-derives points, replacement level and VOR for
  whatever rulebook the room turns out to be using, then advises.

The advisor exists twice, in Python and JavaScript, on purpose (DECISIONS
007): the room must answer inside a 60-second pick clock with no network
hop, and the simulator needs Python. `tests/parity_test.py` runs both on
shared fixtures and diffs the numbers.

## 2. Offline: `engine/`

### `league.py` -- the league, from `config/league.json`

Loads the config at import and exposes the same names every consumer has
always used: `NUM_TEAMS`, `ROUNDS`, `ROSTER_SIZE`, `STARTERS` (Yahoo-style
slot dict, e.g. `{"QB":1,"WR":3,"RB":2,"TE":1,"W/T":1,"W/R":1,"K":1,"DEF":1}`),
`BENCH`, `FLEX_ELIGIBILITY`, `OFFENSE`, `KICKER`, `DST`, `DST_POINTS_ALLOWED`,
`REGULAR_SEASON_WEEKS`, `PLAYOFF_WEEKS`, `PLAYOFF_TEAMS`. `roster_text()` and
`scoring_preset()` render the parts the browser needs. `HC_LEAGUE_CONFIG`
(env) overrides the path, so a second league can be built without editing
the file.

### `sources/` -- one module per provider, one shape out

Each `normalize()` returns a list of dicts with `name`, `pos`, `team` and a
`stats` dict in the canonical vocabulary (`pass_yd`, `pass_td`, `pass_int`,
`rush_att`, `rush_yd`, `rush_td`, `rec`, `rec_yd`, `rec_td`, `fum_lost`,
`*_2pt`, kicker buckets `fg_made_u40`/`fg_made_40_49`/`fg_made_50p`/`pat_made`,
`games`). Providers never contribute point totals (DECISIONS 001).

| module | provides | notes |
|---|---|---|
| `espn.py` | full-season raw stats, ESPN ADP, last season's points | stat IDs verified against FantasyPros; DST totals are ESPN's own |
| `sleeper_proj.py` | full-season raw stats | QB/RB/WR/TE only; K and DST lines are partial |
| `sleeper.py` | injury status + body part + `news_updated`, depth chart, age, years | the live injury feed |
| `ffc.py` | ADP, ADP stdev, times drafted, bye | PPR 12-team; byes are filled per team in build |

### `names.py` -- matching across providers and the room

`key(name, pos, team)` = full first name + surname + position; used to merge
providers. `surname_key` + team is the fallback, and an ambiguous surname
match is refused rather than guessed (a wrong ADP is worse than a missing
one). The browser uses a first-initial key because that is all the room
renders (DECISIONS 006).

### `scoring.py` -- stat line -> points

`score_player(rec)` dispatches on position. Offense is a dot product with
`OFFENSE`; kickers use distance buckets; DST starts from ESPN's total because
the public payload's DST stat IDs do not decode reliably (METHOD §1).
`explain(rec)` returns per-category contributions for the "why" panel.

### `vor.py` -- replacement level and value

`replacement_levels(players)` fills all `NUM_TEAMS` lineups greedily (base
starters, then each flex slot to the best remaining eligible player) and
reads replacement off the last player started at each position. `apply_vor`
sets `replacement`, `vor`, `vor_rank`; `assign_tiers` finds gap-based tiers;
`survival_probability(adp, stdev, pick)` is the closed-form Normal model.

### `upside.py` -- uncertainty, not prediction

`annotate(players)` sets `sigma_frac` (season-level coefficient of
variation from position, experience, depth-chart role, and how far the
projection moved from last year), then `ceiling`/`floor` (~85th/15th
percentile). It claims to know who is uncertain, never who breaks out.

### `opponents.py` -- who picks before you, and what they need

`infer_opponent_rosters(pick_log, num_teams, current_pick, target_pick)`
maps each upcoming pick to its owner's position counts.
`simulate_availability(pool, current, target, rosters, ...)` drafts the
intervening picks a few hundred times (noisy ADP, refusing filled positions,
no K/DEF before 85% of the draft) and returns P(available at target) per
player. This is the number the advisor's `% back` and "cost of waiting" use.

### `advisor.py` -- the recommendation

`advise(available, roster, current_pick, next_pick, recent=None, top_n=6,
availability=None, mode="value", picks_remaining=None)` returns the
recommendation, alternatives, a per-position view (best now, expected best
later, dropoff, likely survivor), roster needs and picks remaining. The
score is `VOR (x BENCH_DISCOUNT if he would not start) + STARTER_BONUS if he
fills an empty starting slot`; `DROPOFF_WEIGHT` is zero by measurement
(DECISIONS 004). The lineup shape comes from `set_lineup()` (default: the
config); K and DEF are excluded until four picks remain.

### `build.py` -- the pipeline

fetch ESPN -> fetch Sleeper injuries -> fetch Sleeper projections -> fetch
FFC ADP -> match by name -> blend ESPN and Sleeper stat lines per stat
(DECISIONS 016) -> score under the league -> injury haircut -> fill byes by
team -> VOR, tiers, upside, edge -> write `data/players.json` and
`data/meta.json`. Prints match counts; refuses ambiguous surname matches.

### `sim.py` and `season.py` -- how strategy is decided

`sim.run_one(players, slot, rng, strategy)` drafts one league (eleven
noisy-ADP bots with positional caps against the chosen strategy).
`season.title_odds(rosters, lineup, ...)` plays a full season per draft:
weekly lognormal scores with position-level variance, a shared weekly
factor per NFL team (teammate correlation), zero in the bye week, lineups
chosen from expectations and scored on outcomes, a round-robin schedule,
seeding, and a bracket. `sim.title_odds_compare(strategies, drafts,
seasons)` is the instrument every strategy claim in `STRATEGY.md` was
measured with. `tools/consensus_test.py` scores a draft on a source the
board did not use.

## 3. The data plane: `data/players.json`

`{"meta": {...}, "players": [...]}`. Per player:

| field | meaning |
|---|---|
| `name`, `pos`, `team`, `key`, `espn_id` | identity; `team` is the canonical 2-3 letter code |
| `stats` | the blended stat line the points were scored from; `stats_espn` is kept when a blend happened |
| `points_raw`, `points` | scored under the configured league; `points` includes the injury factor |
| `points_espn`, `points_sleeper`, `sources` | each source's own scored total (for the overlay's split warning) and how many sources |
| `espn_points`, `prior_points` | ESPN's own total and last season's, for reference |
| `replacement`, `vor`, `vor_rank`, `tier` | valuation |
| `adp`, `adp_stdev`, `adp_rank`, `adp_source`, `times_drafted`, `edge` | timing; `edge` = adp_rank - vor_rank (positive = market is late on him) |
| `bye` | filled per team |
| `injury`, `injury_factor`, `injury_source`, `injury_body_part`, `injury_news_updated` | Sleeper first, ESPN fallback |
| `depth_chart_order`, `age`, `years_exp` | inputs to upside |
| `sigma_frac`, `ceiling`, `floor`, `ceiling_vor`, `floor_vor` | uncertainty |
| `breakdown` | per-category point contributions |

`meta.league` carries `teams`, `rounds`, `roster_size`, `starters`, `bench`,
`roster_text`, `scoring` (the browser preset), `flex_eligibility`; `meta`
also records `replacement_points`, `starters_consumed`, `sources` and
`generated_at`. The browser re-derives everything under whatever rules the
room actually has (`web/league.js`), so the shipped `points` are only the
default.

## 4. Live: `web/` and `bridge/`

### `web/league.js`

`parseRoster(text)` turns `"QB,WR,WR,RB,RB,TE,W/R/T,K,DEF,BN,..."` (or the
Results tab's bare `WRT`) into `{base, flex:[{slot, eligible}], bench}`.
`scorePlayer(p, scoring)`, `replacementLevels`, `assignTiers`, and
`applyLeague(players, {roster, scoring, numTeams})`, which re-derives
`points`, `replacement`, `vor`, tiers, ceiling/floor and `edge` in place.

### `web/advisor.js`

The JavaScript twin of `engine/advisor.py`, plus the room-side name matcher:
`roomKey(name, pos, team)` (first initial + surname + position; defenses by
nickname), `buildIndex`, `lookup(index, name, pos, team, adpHint)` -- the ADP
column is the tie-breaker for teammates who share an initial and surname.
`setLineup`, `setRosterSize` make the lineup a runtime parameter.

### `bridge/yahoo-draft-bridge.user.js` -- the overlay

Runs as a userscript or is loaded by `arm.js`. Readers (exposed as
`window.__hcReaders` for the fixture test): `readStatus` (round, pick,
up-in, clock, on-the-clock team), `readAvailable` (the players table:
name, position, team, injury tag, ADP, Yahoo player id), `readDraftOrder`
(the strip, with snake-mirror period detection), `readMyRoster`.
`applyDetectedLeague` decides the rulebook: a mock room gets Yahoo defaults;
a real room gets `meta.league` from the data plane. `render` draws the
panel and pushes state to the relay. Boot loads `league.js` and `advisor.js`
only if `arm.js` has not already, always with a cache-buster.

### `bridge/arm.js`

One script that loads the stack in dependency order (`league.js`,
`advisor.js`, the bridge, `harvest.js`, `grade.js`, `supervise.js`,
`opponents.js`) and, unless `window.__hcNoAutopilot` is set, loads
`autopilot.js` the moment the bridge publishes `window.__hcIndex` (a
property hook, never a polling loop -- HIDDEN-TAB-CONSTRAINTS.md).

### `bridge/autopilot.js` -- mock rooms only

Every pass (rate-limited, driven by a MutationObserver): read the status
header and record the last pick under the drafter's snake number; read the
players table (and put the Drafted / position filters back if a harvest
left them on); match rows to the index; build the roster from the pick log
merged with the last Results-tab seed; compute opponent-aware availability;
call `advise` with the exact picks-remaining from the snake; reconcile
Yahoo's queue panel to the top eight (evict the unwanted or out-of-order,
add one or two per pass); verify Autodraft is on from the button's own
state; reseed the roster from the Results tab when the counter crosses one
of our picks; harvest everything (Yahoo projections first) during the final
round. `__hcStatus()` is the one-line health probe; `__hcAuto.audit()`
compares what the room took with what was advised, pick by pick.

### `bridge/opponents.js`, `harvest.js`, `grade.js`, `supervise.js`

`opponents.js` is the browser port of `engine/opponents.py` with
`inferAutodraftSlots` (a slot whose picks all land within four seconds is
Yahoo's autodraft and is simulated on XRank, no noise). `harvest.js` reads
every team's roster from the Results tab (`__hcHarvest`) and Yahoo's own
projected points from the position-paged players table (`__hcYahooProj`).
`grade.js` scores every harvested roster's best legal lineup under the
room's rules, on Yahoo's projections when coverage is 95%+ and on ours
otherwise, never mixing the two. `supervise.js` is `__hcSupervise()`: says
what state the room is in and re-arms, recovers the view, or harvests.

### Runtime globals in the room

| global | set by | meaning |
|---|---|---|
| `__hcIndex` | bridge | matcher index over the data plane |
| `__hcLeague`, `__hcLeagueSummary` | bridge | the applied rulebook and where it came from |
| `__hcRosterText` | harvester / you | the room's lineup string, if the client did not print one |
| `__hcReaders` | bridge | the DOM readers, for tests and the autopilot |
| `__hcAuto` | autopilot | state, `tick`, `audit`, `seedRosterFromResults`, `stop` |
| `__hcStatus()` | autopilot | one-line health |
| `__hcSupervise()` | supervise | inspect and repair |
| `__hcHarvest()`, `__hcYahooProj()`, `__hcHarvested` | harvest | rosters and projections |
| `__hcGrade(harvest, source)` | grade | the grade table |
| `__hcOpp` | opponents | availability model |
| `__hcArmed`, `__hcNoAutopilot`, `__hcArmError` | arm | arming state |

## 5. The room's DOM contract

Bind only to Yahoo's semantic hooks, never to hashed CSS-in-JS classes
(DECISIONS 005): `.ys-player[data-id]` (a player; the id is the join key),
`.ys-draftorder-current`, `.ys-addqueue` / `.ys-removequeue` (the star, whose
class flips when queued -- DECISIONS 012), the status line text
`"<team>'s Pick • You're up in N Picks • Round R, Pick P"`, the `Last:`
header, the players table with columns `Queue | Player | XRank | ADP | Bye |
Proj Pts | ...`, and toggles (`Autodraft`, `Drafted`) that render a check
icon inside the button when on. `tests/fixtures/draftroom.html` holds the
observed structure; `tests/dom_test.js` breaks loudly if a reader stops
matching it. `YAHOO-DRAFT-ROOM-RECON.md` has the full findings.

## 6. Tests (`./run_tests.sh`)

| test | guards |
|---|---|
| `tests/parity_test.py` | Python and JS advisors agree on recommendation, alternatives, and position view over shared fixtures |
| `tests/match_test.js` | room-style names resolve to the right players; collisions (A. Brown x2, B. Robinson x2 on one team, V./J. Jefferson) and defenses by nickname; a round trip over every draftable player |
| `tests/queue_test.js` | the queue actuator against a fixture that behaves like Yahoo (star class flips, panel in insertion order): order, reorder, stale-entry eviction |
| `tests/opponents_test.js` | availability responds to opponent rosters, kicker timing, autodrafter detection and XRank behaviour, reproducibility |
| `tests/roster_test.js` | a full draft under each rulebook yields a legal lineup, the right roster size, and no position over its cap; bare flex tokens parse |
| `tests/dom_test.js` | every DOM reader against the captured fixture, including the snake strip with duplicate names |
| syntax | `node --check` and `ast.parse` over every shipped file |

## 7. Invariants worth knowing before changing anything

1. Never consume a provider's point total; score stat lines (DECISIONS 001).
2. Never hardcode a league number; read it from the config or the room,
   range-check it, and show it on screen (DECISIONS 008, 010).
3. Valuation and timing stay separate: VOR from projections, availability
   from the market and the room, reported as `edge` (DECISIONS 003).
4. An actuator reads the actuated system's state every pass (DECISIONS 012);
   an event is attributed by identity, not by a counter read at the same
   instant (DECISIONS 013).
5. Any new pick rule is measured in `sim.title_odds_compare` under
   projection error before it ships; the default answer is "no"
   (STRATEGY.md §3, §11-13).
6. Nothing in a hidden tab may depend on `setTimeout` for draft-paced work
   (HIDDEN-TAB-CONSTRAINTS.md).
