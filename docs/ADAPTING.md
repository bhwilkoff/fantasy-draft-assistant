# Adapting the assistant

Three things people actually want to change: the league, the projection
sources, and the pick rule. Each has one place to do it and one way to check
it.

## 1. A different league

Edit `config/league.json` (or point `HC_LEAGUE_CONFIG` at another file):

```json
{
  "league_id": 539156, "league_name": "Harvey Cup", "team_key": 7,
  "num_teams": 12, "rounds": 17, "seconds_per_pick": 60,
  "starters": {"QB":1,"WR":3,"RB":2,"TE":1,"W/T":1,"W/R":1,"K":1,"DEF":1},
  "bench": 6,
  "flex_eligibility": {"W/T":["WR","TE"], "W/R":["WR","RB"]},
  "scoring": { "offense": {...}, "kicker": {...}, "dst": {...}, "dst_points_allowed": [...] },
  "season": {"regular_season_weeks": 14, "playoff_weeks": [15,16,17], "playoff_teams": 6}
}
```

Where the numbers come from: the Yahoo league's `/f1/{id}/settings` page
lists roster positions and every scoring category. Slot names follow
Yahoo's spelling (`W/R/T`, `Q/W/R/T` for superflex, `BN`, `IR`); a slash
slot is a flex and its letters name the eligible positions.

Then:

```bash
python3 engine/build.py      # rebuild under the new rules
./run_tests.sh               # parity and roster tests run against the new data
```

What changes automatically: replacement levels and VOR (the lineup drives
them), the K/DEF gate (roster size drives it), the season simulator's
schedule and bracket, the standalone board's slot picker and snake maths,
and -- because `build.py` writes `roster_text` and the scoring preset into
`data/meta.json` -- the overlay's rulebook in a real draft room. A Yahoo
mock room still runs Yahoo's defaults, which the overlay detects.

What does not: the parity fixtures in `tests/parity_test.py` name Harvey Cup
players; if you change leagues and the test complains that a fixture player
is missing, swap the names. `BENCH_TARGET` and `BENCH_DISCOUNT` in the two
advisors are position-level constants that were tuned for a 17-round,
6-bench roster; a 14-round league with 4 bench spots may want smaller
bench targets. Measure it (section 3) rather than guessing.

A non-Yahoo platform is a different project: everything in `bridge/` is
bound to Yahoo's draft room. The engine, the data plane, and the standalone
board are platform-independent.

## 2. A projection source

Add `engine/sources/<provider>.py` with `fetch()` and `normalize()` returning
`{"name","pos","team","stats":{...}}` in the canonical stat vocabulary
(`ARCHITECTURE.md` §2). Raw stats only -- never a point total. Then in
`build.py`, match it the way Sleeper is matched (exact `names.key`, then
surname + team with first-name compatibility, refusing ambiguity) and fold
its stat line into the blend. Keep the per-source scored total on the
player (`points_<provider>`) so the overlay can show disagreement.

Check it with `tools/consensus_test.py`: draft on each board, score with a
source the board did not use. A source that lowers the out-of-sample finish
is noise; a source that only agrees with the others adds nothing. Two
sources beat one by a wide margin (STRATEGY.md §10); the third has to earn
its place.

Yahoo's own stat line is available inside the draft room (the players table
has every category per player) and would make a third, in-room source;
`bridge/harvest.js` already pages through it for projected points.

## 3. A strategy or pick rule

The advisor's pick rule is deliberately plain because every cleverer rule
tried so far lost or was noise once projections were uncertain. If you want
to try one:

1. Implement it as a `mode` in `engine/advisor.py` (see `tiebreak` and
   `lookahead` for the shape) or as a wrapper around `advise` (see the
   scratch pattern in `STRATEGY.md` §11-13: intercept the ranked list and
   re-order within a band).
2. Measure title odds with `sim.title_odds_compare(["advisor", ...],
   drafts=36, seasons=150)`. Anything under about one and a half points of
   title odds is noise at that size; run more drafts before believing a
   small edge.
3. If it wins, port it to `web/advisor.js` and extend the parity fixtures.
   If it loses, write it up in `STRATEGY.md` anyway -- the negative results
   are what stop the next person re-trying them.

The simulator's opponents are noisy-ADP bots with positional caps. To model
a specific room, `sim.run_one` accepts any strategy function; a bot that
follows Yahoo's rank exactly (an autodrafter) is a one-line variant.

## 4. The in-room bridge

Yahoo redeploys and hashed class names churn; the semantic hooks
(`.ys-*`) have been stable. If a reader breaks, first update
`tests/fixtures/draftroom.html` from the live DOM so `tests/dom_test.js`
fails, then fix the reader. `__hcSupervise()` in the room and `__hcStatus()`
tell you what is stale. `HIDDEN-TAB-CONSTRAINTS.md` lists the code patterns
that survive a background tab; anything with `setTimeout` on the draft's
critical path will not.

## 5. Beyond the draft

The pieces that carry over to the in-season scope -- scoring, the projection
blend, the season model, name matching, the Yahoo roster harvester -- and
what has to be built are laid out in `IN-SEASON-LINEUPS.md`.
