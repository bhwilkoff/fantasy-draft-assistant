# Competing in Harvey Cup: what the simulator actually says

Everything here was measured, not asserted. The instrument is
`engine/season.py`: each candidate strategy drafts against eleven ADP-driven
opponents, and the resulting twelve rosters then play the **real competition**
— a 14-week head-to-head schedule, six playoff teams, and a three-week
bracket in weeks 15-17. Strategies are scored on **title odds**, because that
is the thing you are buying. Baseline for a 12-team league is 8.3%.

---

## 1. Why title odds and not projected points

Two rosters with identical season totals can have very different playoff
odds, because head-to-head pays for weekly distributions, not annual sums.
And a three-week bracket is short enough that variance behaves differently
than it does over a season.

An early version of the season simulator chose each week's lineup using
**that week's realised scores**. That is hindsight-optimal and it silently
inflated every high-variance strategy — it handed boom/bust players a perfect
start/sit record. Fixing it (lineups chosen ex ante, scored ex post) moved
plain VOR drafting from 17.1% to 22.7% title odds and knocked "draft for
ceiling" down. **Any tool that tells you upside is free is probably making
this mistake.**

## 2. The headline: the engine roughly doubles-to-triples your title odds

48 drafts x 200 simulated seasons each, realistic in-season learning:

| strategy | title odds | playoff odds |
|---|---|---|
| draft by ADP (what most of the room does) | 8.2% | 63% |
| plain VOR, best-available | **21.8%** | 73% |
| the advisor (VOR + roster construction) | **20.8%** | 73% |

Nearly all of the edge is in *valuation*: scoring raw stats under Harvey Cup's
actual rules (full PPR, 6-point passing TDs) and deriving replacement level
from a lineup that starts 3 WR plus two WR-eligible flexes. The room is
drafting a half-PPR, 4-point-TD board. You are not.

**The variants are indistinguishable; only the valuation edge is real.** An
earlier 20-draft run had the advisor at 23.0% and plain VOR at 22.5%, and a
bench-upside variant at 22.8%. At 48 drafts they converge to 20-22% and the
ordering reshuffles. That spread is noise, and it is worth saying plainly:
past this point, tinkering with the pick rule is not where wins come from.

## 3. Three things that sound clever and lose

Each of these was implemented, tested, and removed. They are documented
because they are what everyone tries.

**Positional cliffs / dropoff weighting.** Scoring candidates as
`VOR + w × (dropoff to your next pick)` degraded results monotonically as `w`
rose (mean finish 3.13 → 3.90 across w = 0 → 1). VOR *already* prices
scarcity: the replacement baseline is the last startable player at that
position. Adding dropoff double-counts it.

**Two-pick lookahead.** The formulation `argmax over (p,q) of
now[p] + later[q]` is **separable**, so it always picks `p = argmax now[p]`
regardless of `later` — mathematically vacuous. The correct version reduces
to "take the position with the larger dropoff", which is the rule above, which
loses.

**Availability as a tie-break.** Preferring the least-likely-to-survive
player among near-equals also lost, and worse as the band widened
(3.15 → 3.65 → 4.85 finish for bands of 5, 8, 15 VOR).

The pattern is consistent across three independent tests: **once projections
are uncertain, taking the most valuable player available is very hard to
beat.** Timing information should inform *you*; it should not move the pick.

## 4. Upside: only on the bench, and only sometimes

`engine/upside.py` estimates a per-player season-level spread from
experience, depth-chart role, and how far the projection departs from last
year — it does not claim to know who breaks out, only who is *uncertain*.

At 20 drafts x 150 seasons:

| strategy | can't spot breakouts in-season | realistic | always knows |
|---|---|---|---|
| advisor | 19.8% | 23.0% | 23.6% |
| ceiling on bench picks only (last third) | 22.8% | 21.2% | 22.1% |
| chase ceiling all draft | 10.9% | 13.1% | 13.9% |
| chase floor all draft | — | 7.2% | — |

Re-run at 48 drafts x 200 seasons, the bench-upside edge **did not replicate**:

| strategy | can't spot breakouts | realistic |
|---|---|---|
| plain VOR | 20.1% | 21.8% |
| advisor | 19.8% | 20.8% |
| ceiling on bench picks only | 20.4% | 20.6% |

Reading:

* **Chasing ceiling early is badly negative** — a 10-point swing. You pay real
  starting-lineup points for a lottery ticket you have to start anyway.
* **Chasing floor is worse still**, below the ADP baseline.
* **Swinging on genuine bench picks is a wash.** The apparent edge at 20
  drafts was noise. Do it if you enjoy it; it neither helps nor hurts
  measurably, and it is strictly better than the two strategies above.

The honest summary of upside: *where* you take variance matters enormously
(early is bad), but *whether* you take it on the bench barely matters at all.

## 5. What opponent modelling is actually for

`engine/opponents.py` simulates the intervening picks using each opponent's
*current roster*, which produces genuinely better availability numbers than a
Normal-around-ADP model. With the teams in front of you already full at RB,
Breece Hall's survival to your next pick goes from **27% to 100%**; Josh
Allen's collapses from 37% to 0%.

That information did **not** improve automated picks (§3). It is surfaced
anyway, because it is the number you want when you are deciding between two
players you rate similarly, and it is what Claude reasons over.

## 6. Round-by-round, for this league

Derived from what the advisor actually does across simulated drafts, not from
draft-guide folklore.

* **Rounds 1-4 — take the best player, full stop.** Do not reach for need,
  do not reach for a cliff. The simulator punishes both.
* **Rounds 5-8 — value with one eye on the lineup.** The `+3` starter-gap
  bonus is deliberately small; it breaks ties toward filling a hole, it does
  not justify a real drop in value. WR runs deep here: 47 WRs start in this
  league, so WR scarcity arrives much later than the room expects.
* **Rounds 9-12 — this is where 3WR+2flex pays.** You need genuine WR depth,
  and the market (drafting a 2WR board) will have left it.
* **Rounds 13-17 — swing.** Bench picks are the only place upside is free.
  Prefer young, high-variance, unclear-role players over the safe veteran who
  is already priced correctly.
* **K and DEF: the last four picks, never earlier.** Twelve of each for
  twelve teams; replacement is a waiver claim away. The advisor refuses to
  consider them until four picks remain (it was two, then three; an end-game of
  autodrafters moves a pick every two seconds and the queue is fed one
  entry per pass, so the defense missed pick 161 in mock 10427900).

## 7. QB in a 6-point-passing-TD league

The scoring boost is real (Josh Allen 434 points here vs 370 on a default
board) but it lifts *every* quarterback, so VOR barely moves: QB replacement
is ~346 points, which makes even Allen's edge over a streamer around 85
points across a whole season — roughly 5 points a week. **Wait on QB.** The
6-point rule changes the ranking *within* quarterbacks (volume passers gain
most), not the priority of the position.

## 8. Where the edge actually comes from, ranked

1. **Scoring the right rulebook** — biggest single factor by a distance, and
   free. This is the ~13-point gap between 8% and 21% title odds.
2. **Replacement level from the real lineup** (47 startable WRs, not 36).
3. **Draft-morning injury refresh** — Sleeper's feed is timestamped to the
   hour; a status that moved at 11am should change a 2pm pick. Untested in
   the simulator because it has no news model, but it is the only input that
   changes between building the board and using it.
4. **Not chasing ceiling early** — worth ~8 points of title odds in avoided
   damage, which makes it as valuable as anything on this list.
5. **Everything else measured here — pick-rule tinkering, dropoff weighting,
   lookahead, availability tie-breaks, bench upside — is zero or negative.**

## 9. What this does not model

Waiver-wire activity, trades, strength of schedule, bye-week stacking, QB/WR
correlation, and handcuffing are all absent. Handcuffing in particular is
plausible but untested here — it protects a concentrated investment, which
the season simulator would need injury dynamics to evaluate honestly, and it
does not have them. Treat §6's late-round guidance as the tested part and
handcuffing as a judgement call.


## 10. One source is an opinion; a consensus is a projection (added 2026-09-01)

The first mock draft in which the room took our advice pick for pick
(data/mocks/RESULTS.md, draft 6) finished last under Yahoo's projections
and 11th under our own. Every starter we drafted was a player ESPN rated
well above everyone else. That is not bad luck; it is what maximising over a
single noisy forecast does -- it selects that forecast's errors.

Measured with `tools/consensus_test.py` (24 drafts against ADP bots, each
roster scored by a source the drafting board did NOT use):

| draft on | scored by | avg finish | wins |
|---|---|---|---|
| ESPN only | Sleeper | 3.25 / 12 | 6 / 24 |
| Sleeper only | ESPN | 5.21 / 12 | 3 / 24 |
| ESPN + Sleeper blend | ESPN | 1.29 / 12 | 20 / 24 |
| ESPN + Sleeper blend | Sleeper | 1.04 / 12 | 23 / 24 |

The blend rows are flattered (the blend contains half of whichever source
scores it), so read the table as: a single source still beats the ADP room
out of sample, and it is measurably worse than the consensus. The data plane
now blends ESPN and Sleeper per stat before scoring; the overlay shows both
totals for the recommendation and flags a split of 25+ points. When one
source loves a player and the other does not, that is a reason to trust the
consensus, not to draft him.


## 11. Bye weeks: model them, do not draft around them (added 2026-09-01)

Until tonight the season simulator had no bye weeks at all. It now zeroes a
player in his bye week (byes come from the team; 526 of 531 players carry
one). With that in place, three drafting rules with identical valuation, 36
drafts x 150 seasons:

| rule | title odds | playoff odds |
|---|---|---|
| ignore byes (the advisor as is) | **14.2%** | 70.8% |
| among near-equals, prefer a bye NOT shared with a starter | 11.3% | 60.4% |
| among near-equals, prefer a SHARED bye (concentrate the damage) | 11.5% | 65.9% |

Either bye rule costs about three points of title odds. The reason is the
same one that killed every other tie-break (Section 3): a "near-equal" band
wide enough to ever change a pick is wide enough to give away real value,
and a bye week costs every roster one week of one player regardless of how
the byes line up. The overlay shows the bye next to every recommendation so
a human can break a genuine coin-flip with it; the engine does not.


## 12. The public 3-WR advice, measured (added 2026-09-01)

The 2026 consensus guides for 3-WR / two-flex leagues say "two receivers and
a tight end in the first four rounds" and, more mildly, "one anchor running
back then receivers" (Hero RB). Measured against the advisor's plain
best-available, same consensus board, byes modelled, 36 drafts x 150 seasons:

| rule for rounds 1-4 | title odds | playoff odds |
|---|---|---|
| best available (the advisor) | 14.2% | 70.8% |
| force 2 WR (or TE) before round 5 | 13.1% | 62.4% |
| Hero RB: one RB, then WR/TE until round 5 | 15.1% | 69.7% |

Forcing receivers early loses. Hero RB is within noise of best-available,
which makes sense: with 47 startable receivers the engine's replacement
math already leans it toward receivers after the first back, so the
constraint rarely changes a pick. Nothing here justifies overriding value.


## 13. Stacking a QB with his receivers, measured (added 2026-09-01)

The season model now correlates teammates week to week: every QB, WR and TE
on an NFL team (and, half as strongly, its RB and K) shares a weekly
offensive factor with a 25% spread, which reproduces the published 0.3-0.4
QB-to-WR1 weekly correlation. With that in place, same valuation, 36 drafts
x 150 seasons:

| rule among near-equals (6 VOR) | title odds | playoff odds |
|---|---|---|
| ignore stacks (the advisor as is) | 14.4% | 69.3% |
| prefer a receiver on my QB's team, or a QB feeding my receivers | **10.9%** | 67.3% |
| prefer the opposite (spread across teams) | 15.2% | 69.4% |

Stacking loses three and a half points of title odds. The playoff argument
for correlation (variance wins a three-week bracket) is real but small; the
regular-season cost (a correlated lineup loses more of its fourteen
head-to-head games when its team has an off week) is larger, and you have to
survive the regular season to reach the bracket. Anti-stacking is within
noise of doing nothing, so the advisor does nothing. Stack for fun, not for
points.
