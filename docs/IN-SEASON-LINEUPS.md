# In-season lineups and waivers -- design note for the next scope

Status: **design only**, written 2026-09-02 before the draft. Nothing here
is built. The purpose is to say precisely what the draft assistant already
provides for the in-season job, what it is missing, and the smallest
pipeline that would answer the two weekly questions:

1. **Who do I start this week?**
2. **Who should I add, and who is the drop?**

## 1. What already exists and carries over unchanged

| need | have | where |
|---|---|---|
| the league's rules | `config/league.json`, `engine/league.py`, `web/league.js` | scoring, lineup, flex eligibility, bench |
| scoring a stat line under those rules | `engine/scoring.py`, `web/league.js` `scorePlayer` | season or week, same code |
| a consensus of sources | the ESPN + Sleeper blend in `build.py` | needs weekly inputs (§2) |
| name matching across providers and Yahoo | `engine/names.py`, `web/advisor.js` `lookup` | the Yahoo league pages render full names, which is easier than the draft room's initials |
| injuries with timestamps and body parts | `engine/sources/sleeper.py` | already the draft-morning feed; in season it is the Sunday-morning feed |
| a weekly scoring model | `engine/season.py` `draw_week` | lognormal weekly scores, position CVs, teammate correlation, byes |
| best legal lineup | `engine/season.py` `best_lineup_score`, `bridge/grade.js` `bestLineup` | given per-player expected points, fills base slots then flex |
| replacement level | `engine/vor.py` | the value of the best free agent at a position is exactly "replacement" |
| reading a Yahoo roster | `bridge/harvest.js` | reads the draft room's Results tab; the league's roster pages are a simpler table |
| the Claude-in-the-loop relay | `tools/draft_server.py`, `draft_watch.py` | state in, judgement out, unchanged |

## 2. What is missing

**Weekly projections.** Everything today is full-season. Both current
sources publish weekly lines, verified 2026-09-02:

* Sleeper: `https://api.sleeper.com/projections/nfl/2026/{week}?season_type=regular&position[]=QB...`
  returns one row per player with the same stat keys as the season
  endpoint (`pass_yd`, `pass_td`, `rec`, ...), plus the game `date`.
* ESPN: the `kona_player_info` payload `sources/espn.py` already fetches
  carries, per player, a `stats` entry for EVERY week of 2026
  (`statSourceId=1, statSplitTypeId=1, scoringPeriodId=N`) in the same
  stat-ID scheme -- and the 2025 weekly ACTUALS (`statSourceId=0`), which
  is the backtest data for §4. No new endpoint; `_season_projection()`
  just needs a weekly sibling.

A `sources/*_weekly.py` pair (or a `week=` argument to the existing
`normalize()`s), normalised to the same vocabulary, drops into the existing
blend and scorer. That is most of the work.

**My roster and the free-agent pool.** In season the source of truth is the
league site, not a draft room: `/f1/{league}/{team}` for a roster and
`/f1/{league}/players?status=A` for free agents, both plain tables with
full names, positions, teams, bye weeks, and Yahoo's own projection. A
reader for those two pages (a userscript or a logged-in fetch from the
browser, since they need the session) replaces `harvest.js` for this scope.
The official Yahoo Fantasy API can do the same with OAuth if you would
rather not scrape.

**Opponent-of-the-week.** `season.py` can already turn two rosters' weekly
distributions into a win probability; it needs the opponent's roster, which
the same league page reader supplies.

**Waiver value.** The draft's replacement level is "the best player nobody
starts"; the in-season version is "the best free agent at the position,
projected over the rest of the season, discounted by how likely he is to
still be there after waivers clear". `vor.replacement_levels` over the
free-agent pool, on rest-of-season projections, is the number.

## 3. The smallest pipeline that answers both questions

```
sources/sleeper_weekly.py + sources/espn_weekly.py
        -> blend per stat (existing) -> score (existing)   = expected points per player this week
league page reader (new)                                   = my roster, opponent's roster, free agents
season.draw_week + best_lineup_score (existing)           = my best lineup, opponent's, P(win)
vor.replacement_levels over free agents on ROS projections = who is worth adding, and what the drop costs
tools/lineup_server.py (relay, existing shape)             = the brief for a Claude session
```

Outputs, in the order a manager needs them on Sunday morning:

1. The lineup: each starting slot, the expected points, and the swing
   between the chosen starter and the best alternative (flag the close
   calls; that is where the human and Claude earn their keep).
2. Win probability this week and what changes it most.
3. Waiver targets ranked by rest-of-season value over the worst rostered
   player at the position, with the injury feed's timestamp beside each.

## 4. What to measure before trusting it

The draft assistant earned its rules by simulation, and the same discipline
applies. Two checks are cheap once weekly projections exist:

* **Backtest the lineup rule** over 2025: for each week, choose lineups from
  that week's projections, score them on actual results (ESPN's payload
  carries actuals for prior seasons, `statSourceId=0`), and compare against
  "start the higher season projection" and against Yahoo's own suggested
  lineup. If the consensus weekly line does not beat the season line, the
  weekly sources are not adding information.
* **Backtest waiver adds** the same way: value at the time of the add versus
  points delivered over the rest of the season.

## 5. Things that are the same trap as in the draft

* A provider's weekly point total is under the provider's rules; score the
  stat line (DECISIONS 001).
* One source's weekly enthusiasm is noise until a second source agrees
  (DECISIONS 016). Show the split; do not act on it.
* A page reader that silently returns a partial roster or a filtered
  free-agent list produces a confident wrong lineup. Range-check every count
  and show it on screen (DECISIONS 008).
* Byes: a player on bye scores zero and the model already knows it; the
  lineup code must never start him because his season projection is high.
