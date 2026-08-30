# How the valuation works, and what it does not know

## 1. Score raw stats under Harvey Cup's rules, never someone else's totals

Harvey Cup differs from the Yahoo default in two ways that matter:

| Rule | Harvey Cup | Yahoo default | Effect |
|---|---|---|---|
| Receptions | **1.0** | 0.5 | +50 pts for a 100-catch WR |
| Passing TD | **6** | 4 | +~50 pts for a 25-TD QB |

Any published "projected points" column — Yahoo's, ESPN's, FantasyPros' — is
computed under *their* rules, so we never consume one. We pull **raw stat
projections** (ESPN's `kona_player_info`, 45 stat categories per player) and
apply `engine/league.py` ourselves. Josh Allen is 434 points here and 370 on
ESPN's own board; that 64-point gap is the whole reason to do this.

Stat-ID decoding was verified by cross-checking decoded lines against
FantasyPros' published projections for the same players. Kickers decode
exactly (FG buckets 74/77/80 sum to the published total). **Team defenses do
not**: ESPN's DST sack/turnover stat IDs are not reliably decodable from the
public payload, so DST falls back to ESPN's own total. DST is a last-round
pick and the error is small, but it is an approximation and is labelled as one.

## 2. Replacement level is simulated, not assumed

The single league-specific number in fantasy valuation is where a position
stops being scarce. Harvey Cup starts **3 WR plus a W/T and a W/R flex**, and
both flex slots are WR-eligible, so the usual "WR replacement = WR36"
shortcut is badly wrong.

`engine/vor.py` fills all 12 lineups greedily — base starters first, then each
flex slot to the best remaining eligible player — and reads replacement off
the last player actually started:

| Pos | Starters consumed league-wide | Replacement |
|---|---|---|
| QB | 12 | 346 pts |
| RB | 36 | 160 pts |
| **WR** | **47** | 157 pts |
| TE | 13 | 158 pts |

Forty-seven wide receivers are startable in this league. That is the fact the
whole board is built on.

## 3. Valuation and timing are kept separate

- **VOR** answers *how much is he worth* — projections only.
- **ADP** answers *when will he be gone* — market only.

Most public "value" boards blend the two into one number, which destroys the
only thing a live advisor needs: the gap between them. We keep them apart and
report the gap as `edge`.

Availability uses P(still on the board at pick *N*) ~ Normal(ADP, stdev),
with FFC's published per-player standard deviation (8,234 real drafts).

## 4. The negative result: positional "cliffs" are already priced in

The advisor originally scored candidates as

    VOR + w · (positional dropoff between now and your next pick)

which is the standard "positional scarcity" folklore. Sweeping `w` in
`engine/sim.py` against simulated projection error made performance degrade
**monotonically**:

| w | 0.0 | 0.2 | 0.35 | 0.5 | 1.0 |
|---|---|---|---|---|---|
| mean finish (of 12) | **3.13** | 3.43 | 3.53 | 3.70 | 3.82 |

The cause is structural, not statistical: **VOR already prices positional
scarcity**, because the replacement baseline *is* the last startable player at
that position. Adding a dropoff term double-counts it — at pick 10 it adds
~+89 to every RB and WR but +0.7 to a QB, a systematic thumb on a scale that
was already balanced.

So `DROPOFF_WEIGHT = 0.0`. The dropoff numbers are still computed and still
shown, because "an RB like this will be gone but a TE like this will not" is
exactly the judgement a human should make. We just refuse to let it silently
overrule the valuation. What *does* help is the roster-construction term
(+3 for filling an empty starting slot), which survives the same sweep.

## 5. What the simulator does and does not prove

`engine/sim.py` runs the real advisor against 11 bots drafting by noisy ADP.

Scored on its own projections, the advisor finishes 1.04/12. **That number is
close to meaningless** — it is graded by the same projections it drafts on.

The honest test injects hidden per-player error and scores lineups on *truth*:

| σ of projection error | ADP drafting | greedy VOR | advisor |
|---|---|---|---|
| 35% | 5.62 / 12 | 3.54 | **3.17** |

The edge over ADP is large and survives being wrong, because it comes from
*structure* (correct replacement levels for this lineup) rather than from
trusting any point estimate. The edge over greedy VOR is small and comes from
roster construction.

**None of this validates ESPN's forecasts.** If ESPN is wrong about a player,
this tool is confidently wrong about him too.

## 6. Known limitations

- **One projection source.** ESPN only. FantasyPros is registration-gated at
  10 rows; Yahoo's own raw projections are visible in the draft room and would
  make a good second source, but are not yet ingested.
- **No strength of schedule, stacking, or bye-week optimisation.** Byes are
  displayed, not optimised against.
- **DST is approximate** (see §1); kickers are exact but barely matter.
- **Injury handling is a blunt multiplier** on projected points
  (`QUESTIONABLE` 0.97 … `INJURY_RESERVE` 0.35), not a games-missed model.
- **The overlay sees only the ~100 rendered rows** of Yahoo's players table,
  not the full pool. Verified live: the footer reported "100 available
  matched". Sorted by ADP this is always a superset of the reasonable
  candidates, but filtering the table narrows what the advisor can consider.
- **Draft slot is unknown until draft day.** Team 7 in the league URL is a
  team ID, not a draft position; set the slot in the board before you start.
