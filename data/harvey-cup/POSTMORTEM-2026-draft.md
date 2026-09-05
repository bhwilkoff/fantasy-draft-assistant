# Harvey Cup 2026 draft — what happened, what it cost, what to do

Draft: Sat 2026-09-05 2:00pm MDT, 12 teams, 17 rounds, we drafted 12th (team id 7).
Picks: `data/harvey-cup/draft-2026-picks.json` (all 204, resolved to our board).
Replay and grading: `node tools/harvey_postmortem.js`.

## Our roster
RB Achane (12), RB C. Brown (13), WR Rice (36), WR G. Wilson (37), WR D. Adams (60),
WR Sutton (61), WR Pierce (84), **TE Kittle (85), TE Kelce (108), TE Andrews (109),
TE Ferguson (132), TE Strange (133)**, WR Jeudy (156), DEF Broncos (157), K Mevis (180),
QB Stroud (181), WR M. Washington (204).

## The damage
| graded by | our rank | our lineup | leader |
|---|---|---|---|
| our projections, Harvey Cup rules | **1st of 12** | 2450 | Armadillos 2425 |
| Yahoo's projections | 5th of 12 | 2286 | Armadillos 2340 |
| counterfactual (correct roster, same room) | 1st of 12 | **2510** | — |

The starting lineup is strong because the first seven picks were right and the
mistake fell almost entirely on the bench: four of the five tight ends never
start. The lineup cost is about **60 points**, nearly all of it the quarterback
(Prescott 381 was there at 85; Stroud 330 came at 181) plus Fannin over Kittle.
The bench cost is the real one: the corrected advisor spends 85, 109, 133 and
181 on Prescott, Dowdle, Samuel and Justice Hill -- a QB1, RB depth, a WR6 --
where the actual draft spent them on three tight ends and a fifth.

## Root cause
The autopilot built our roster from the picks of the seat named by the URL's
last number. In every mock room that number is the seat. In a league room it
is the team id: we were team 7 drafting 12th, so from pick 84 on the advisor
held Shrouxded's roster (two QBs, one TE, four RBs) and drafted to fill THAT
roster's holes. Five places in the code read the slot from the URL; four were
fixed in the half hour before the draft, the fifth -- the roster builder --
matched a two-number pattern the fix missed. Two aggravating defects: the
roster re-read left the room on the Results tab because the "Players" tab
locator matched a hidden duplicate (pool of two, both ours, picks 14-27); and
in forced-fill mode a kicker's positive VOR outranks a scarce quarterback's
negative one (fixed order should be: scarce hole first).

## Waiver wire, by our projection (undrafted)
- QB: **Daniel Jones 314**, Bryce Young 299, Geno Smith 292, Brissett 279
- RB: **Justice Hill 96**, Tyrone Tracy Jr. 88 (Q), Alvin Kamara 88 (Q), Perine 81, Ty Johnson 78 (Q)
- WR: Jauan Jennings 121, Vele 121, Bateman 118, Ridley 114
- TE (ours): Kittle 184 · Kelce 179 · Andrews 171 · Ferguson 166 · Strange 156
- K: Butker 154 (over Mevis 164? no -- keep Mevis) · DEF: Browns 104

## The plan
Keep Kittle and Kelce (the W/T flex makes a second TE a real starter over a
sixth WR). Drop Strange, Ferguson and Andrews; add Daniel Jones (QB2 -- Stroud
is QB18 on our board), Justice Hill and Tyrone Tracy Jr. for RB depth. Jeudy and
M. Washington are the next drops when better RBs surface on waivers.
