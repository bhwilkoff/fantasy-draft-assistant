# Mock draft results

Graded by best legal starting lineup under the ROOM's rules (Yahoo default:
half PPR, 4-pt passing TDs, QB/WR/WR/RB/RB/TE/W-R-T/K/DEF), using **Yahoo's
own projected points** harvested from the draft room — independent of the
ESPN-derived board we draft on. Grading with our own projections would be
circular; the grader refuses to mix the two scales and says so when it
degrades.

| # | Room | Teams | Slot | Armed from | Finish | Our pts | Winner | Spread |
|---|---|---|---|---|---|---|---|---|
| 1 | 10188821 | 14 | 14 | round 6 | **5 / 14** | 1534.1 | 1569.2 | 265.4 |
| 2 | 10189877 | 14 | 7 | pick 16 | **14 / 14** | 1404.8 | 1578.3 | 173.5 |
| 3 | 10191115 | 14 | 14 | **pick 7** | incomplete | — | — | — |
| 4 | 10276029 | **12** | 6 | pick 126 | **12 / 12** | 1235.7 | 1451.8 | 216.1 |
| 5 | 10426834 | 12 | 5 | pick 10 | **12 / 12** | 1257.5 | 1443.4 | 185.9 |
| 6 | 10427900 | 12 | 8 | pick 4 | **12 / 12** | 1482.2 | 1744.7 | 262.5 |
| 7 | 10429138 | 12 | 7 | pick 1 | **7 / 12** (our proj.) | 1749.2 | 1790.0 | 89.3 |
| 8 | 10430207 | 12 | 2 | pick 70 | **12 / 12** (our proj.) | 1637.3 | 1813.0 | 175.7 |
| 9 | 10430908 | 12 | 10 | pick 30 | **3 / 11** (our proj.) | 1774.1 | 1819.0 | 157.1 |

## Draft 1 — room 10188821, 2026-08-30

**Not a clean test.** Yahoo autodrafted rounds 1-5 before the harness was
armed, so this measures a hybrid roster, not the advisor.

Final roster: QB Williams · WR Egbuka, Sutton, Flournoy · RB Brown, Achane,
Etienne Jr., Jones Sr., Rodriguez Jr. · **TE Kraft, Andrews, Henry,
Hockenson** · K Bates · DEF Seahawks

Four tight ends and three receivers is broken roster construction, and the
cause was mechanical rather than strategic: `roster=0` for most of the draft,
because the pick log only observes picks that land after arming. With an
empty roster every position looked like an unfilled starting slot, so tight
end kept clearing the bar. Fixed by seeding the roster from the Results tab
at arm time (see DECISIONS 009).

**What this draft did prove:** entry and auth handshake, league detection
(14 teams, sane replacement levels), name matching at `unmatched=2/100`,
full-draft tracking through a MutationObserver, persistence across tab
teardowns, the queue→autodraft loop, harvest of all 14 rosters, and
non-circular grading at 100% projection coverage.


## Draft 2 — room 10189877, 2026-08-30

Armed at pick 16, so only one of fifteen picks (McCaffrey, pick 7) was
Yahoo's — much cleaner entry than draft 1. Finished **dead last of 14**.

Picks in order: `QB, WR, WR, RB, RB, TE, RB, RB, TE, TE, TE, QB, WR, WR, WR`

**No kicker and no defense** — two starting slots scoring zero, which is the
entire 173-point gap to the winner and then some. Not a strategy failure; a
units failure. `ROSTER_SIZE` was hardcoded to Harvey Cup's 17 while this room
had 15 slots, so `picksRemaining = 17 - roster.length` never reached the
`<= 2` threshold that finally permits K and DEF. Those picks went to a fourth
tight end instead. Compounding it, the draft client never prints "Roster
Positions" (only the waiting room does), so the league ran on a fallback
string with no bench and the wrong WR count.

Fixed: roster size now derives from the detected league, and the harvester
publishes the roster slots it reads off the Results tab.

**Bugs this draft surfaced**, all of which produced confident wrong output
rather than an error:

* `readStatus` matched the FIRST "Round R, Pick P" on the page; the phrase
  appears in several views, so the harness reported pick 22 while the room
  was at 28 — corrupting every survival probability downstream.
* The status parser was reading **our own overlay's text**, a feedback loop
  that would stale-lock the pick number the moment the panel disagreed.
* `tick()` bailed silently whenever the player table was not the visible view,
  doing nothing for ~50 picks while `__hcStatus` still reported `alive=yes`.
  It now reports `BLIND=<reason>`, carries `lastTick` age, and clicks back to
  the Players view to recover.
* Roster size hardcoded (above).

**Honest reading of the two results so far:** neither measures the advisor.
Draft 1 was hybrid (6 Yahoo picks) and drafted four tight ends because roster
tracking read zero. Draft 2 had a clean entry but no kicker or defense. Both
finishes are explained by mechanical defects that are now fixed, not by
valuation. A third run is the first that would actually test the board.


## Draft 3 — room 10191115, abandoned incomplete

The first run with **every parameter correct**: armed at pick 7 of round 1
(earliest of the three), `rosterSize=15` derived from the room rather than
Harvey Cup's 17, `teams=14`, `bench=6`, `detected=room`, `unmatched=1/100`,
and roster tracking correct after the case-insensitive dedupe fix.

Abandoned because the ROOM stalled, not the harness: roughly two picks per
fifteen minutes, with the draft client's renderer unresponsive to script
injection for ~45 minutes. That freezes the autopilot, which means the queue
stops being re-synced and the final-round auto-harvest never fires. Yahoo
continued autodrafting from a queue built around pick 64, so the late rounds
came off a five-round-stale board.

**The lesson is about the instrument, not the strategy.** Yahoo mock rooms
are an unreliable test environment: they fill on no schedule, drafters
routinely burn the full clock, and a heavy React client in a background tab
degrades until it stops answering. Three attempts produced zero drafts in
which the advisor operated correctly end to end. Nine real defects were found
along the way, which is what the exercise was actually worth.

If this is retried, the useful changes would be: target rooms that are
already nearly full (they start on schedule), keep the draft tab as the
active tab in a non-minimised window, and treat a rising `lastTick` age in
`__hcStatus()` as a signal to recover the tab rather than a cosmetic detail.


## Draft 4 — room 10276029 (12-team), 2026-08-31

First run on a **12-team** room, matching Harvey Cup's team count, and the
first that never froze: the harness tracked continuously from arming to the
final whistle, auto-harvested all 12 rosters during the last round, and
graded at 100% Yahoo-projection coverage. `lastTick` stayed at 1s throughout.

Finished **12 of 12**. Roster:
`QB,WR,WR,RB,RB,TE,WR,TE,QB,QB,WR,TE,TE,WR,WR` — three quarterbacks, four
tight ends, no kicker, no defense.

**And this exposed the flaw that invalidates every earlier draft.**

The autopilot only ever ADDED to Yahoo's queue; it never reordered it. Yahoo
drafts `queue[0]`, which is whatever was queued FIRST -- so by round 15 the
room was still drafting from a queue assembled in round 2. The advisor was
recommending a kicker (`rec=Harrison Mevis`) while Yahoo took a wide
receiver, because that receiver had been sitting at the top of the queue for
thirteen rounds.

Every roster in drafts 1-4 was therefore built from stale advice. The
recommendations were fine; the mechanism that turned them into picks was
not. That is why the rosters never resembled the board, and it is a much
better explanation than "the strategy is wrong".

Fixed: the queue is now maintained as exactly the current top four, in order
-- stale entries are un-starred before the new set is added, so `queue[0]` is
always the live recommendation.

**What draft 4 did prove:** no freezing (the layout fix), continuous
tracking, correct league detection on a 12-team room (`teams=12`,
`rosterSize=15`, `detected=room`), the K/DEF gate opening at the right time,
auto-harvest firing during the final round, and non-circular grading at 100%
coverage. Every piece of the pipeline now works. The picks themselves were
being fed from a stale queue, which is the one thing left to re-test.


## Draft 5 — room 10426834 (12-team), 2026-09-01

Armed at pick 10, so every pick but the first (J. Taylor, Yahoo's autodraft)
was ours to make. Finished **12 of 12** again, and again for mechanical
reasons -- but this is the first draft where each pick can be traced to its
cause, because the autopilot now audits *what the room took* against *what
it advised* (`__hcAuto.audit()`).

Roster: `QB Allen · WR Adams, Sutton, Worthy, Meyers, Jeudy, Boutte · RB
Taylor, J. Williams, Judkins, Spears · TE Kittle, Fannin · QB Dart, Stafford`
-- three quarterbacks, no kicker, no defense.

What the room took, pick by pick, against the live recommendation:

| pick | advised | taken | why |
|---|---|---|---|
| 20 | Josh Allen | Josh Allen | ok |
| 44 | Judkins | Judkins | ok |
| 53 | Adams | Adams | ok |
| 68 | Kittle | Kittle | ok |
| 77 | Sutton (advice changed as the turn opened) | Fannin | queue re-sync lost the race with autodraft |
| 92 | Sutton | **Dart** | stale queue: un-star never worked (defect 1) |
| 101 | Sutton | Sutton | ok |
| 116 | A. Jones | **Stafford** | stale queue (defect 1) |
| 125 | A. Jones | Worthy | queue order scrambled by parallel star clicks (defect 2) |
| 140 | Meyers | Meyers | ok |
| 149 | Spears | Spears | ok |
| 164 | Jeudy | Jeudy | ok |
| 173 | Mevis (K) | Boutte | stale alternative ahead in queue (defect 1); K/DEF gate also opened two picks late (defect 3) |

**Defect 1 -- un-starring never worked.** Once a player is queued, Yahoo
swaps his star's class from `.ys-addqueue` to `.ys-removequeue`. The
actuator looked for the former to remove him, found nothing, forgot him,
and Yahoo kept him. That is why Bo Nix and Matthew Stafford sat at the top
of the queue with Josh Allen already rostered. The offline queue test passed
because its fixture never swapped the class. Fixed: the actuator reads
Yahoo's queue panel every pass and reconciles against it; the test fixture
now behaves like Yahoo.

**Defect 2 -- parallel star clicks scramble the order.** Wanted
`Jones, Worthy, Meyers, White`; Yahoo held `Worthy, White, Jones, Meyers`
and drafted Worthy. Several clicks in one pass reach the server in arbitrary
order. Fixed: one addition per pass; passes run every ~1.5 s so the queue
still fills within seconds.

**Defect 3 -- pick attribution race.** `Last: <player>` and
`Round R, Pick P` are separate React updates, and a pass between them logged
the pick under the wrong number, then refused to record the real one. The
audit blamed us for Justin's Malik Willis. Worse, our roster count ran two
low all draft, so the "picks remaining <= 2" gate that permits K/DEF opened
two picks late. Fixed: picks are numbered from the drafter's name and snake
slot, and the roster is re-read from the Results tab after each of our
picks.

Also found and fixed this draft: the Results tab renders the flex slot as
`WRT` (slashes are decoration), which the parser dropped; the bridge's boot
reloaded advisor.js without a cache-buster and overwrote a freshly pushed
fix with a ten-minute-old cached copy; defenses are rendered by nickname
only on the Results tab and graded as unresolved for every team; and the
advisor valued a backup quarterback at his full VOR (Lamar Jackson
recommended at pick 53 with Allen rostered), now discounted.

**What worked, and is new:** the queue mechanism itself, when the queue was
correct -- eight of thirteen picks took exactly the live recommendation,
against zero in drafts 1-4. League detection (12 teams, 15 slots once the
flex was restored, mock lineup shape), name matching at `unmatched=0`,
continuous tracking through a Yahoo tab teardown, and grading at 100%
Yahoo-projection coverage.


## Draft 6 — room 10427900 (12-team), 2026-09-01

Armed at pick 4, before our first pick. **The mechanism worked**: 12 of 14
audited picks took exactly the live recommendation (Henry, Allen, Etienne,
Judkins, Adams, Kittle, Sutton, Pollard, Stafford, Worthy, Shakir, Ravens
D/ST), the roster was re-read from the Results tab after every one of our
picks, the opponent-aware availability model ran from pick 74 on, and the
draft survived one Yahoo tab teardown without losing a pick. The two misses
were mechanical and are fixed: pick 137 (a reseed toggled the Drafted filter
mid-pass, the pass purged the queue, and a burst of autodraft picks arrived
before it was rebuilt) and pick 161 (the K/DEF gate opened at two picks left,
one pass too late for an end-game moving a pick every two seconds).

Finished **12 of 12** anyway, at 1482 against 1745 -- and this time that is
a verdict on the valuation, not the hands.

**It is not projection disagreement.** Graded with our own projections
instead of Yahoo's, the same rosters put us 11th of 12 (1722 vs 1921). The
missing kicker is worth ~130 points on either scale and would lift us to
about 4th under our numbers and 11th under Yahoo's.

**It is single-source selection bias.** Player by player, every starter we
drafted is one ESPN projects well above Yahoo (Allen +48, Stafford +41,
Henry +35, Adams +34, Sutton +33, Judkins +31, Etienne +30, Pollard +24),
while the winner's starters are ones Yahoo rates at least as highly as ESPN
(Collins 214 vs 205, Burden 171 vs 164, Gibbs 311 vs 331). An engine that
values off one source will, by construction, keep choosing the players that
source is most bullish on relative to everyone else -- which is exactly
where that source is most likely to be wrong. This is the winner's curse,
and drafts 1-5 could not have shown it because their picks never came from
the board.

Fix in progress: a consensus projection (ESPN + Sleeper offline, Yahoo's raw
stat line from the room at runtime), blended at the stat level and then
re-scored under the league's rules as before. See DECISIONS 016.


## Draft 7 — room 10429138 (12-team), 2026-09-01

First draft on the ESPN+Sleeper consensus board, armed at pick 1. Roster:
`QB Allen · WR Evans, Sutton · RB Cook, J. Williams, Judkins · TE LaPorta ·
K Fairbairn · DEF Cowboys · bench Kittle, Purdy, Pittman, Worthy, Marks,
Shakir` -- the first mock roster with a legal lineup including K and DEF.

Finished **7 of 12 under our projections** (1749 vs 1790; the whole room
spans only 89 points, so this is a coin-flip room). Yahoo's projection
scrape does not run once a draft has ended, so there is no Yahoo-scale grade
for this one; the auto-harvest during the final round fired before the
projection pass could.

Audit: 7 of 8 picks through round 10 took the live recommendation (Cook,
Allen, J. Williams, Judkins, Evans at 55, Kittle at 79, Sutton at 90,
Pittman at 114); pick 103 took Purdy over Monangai in an end-game where
every remaining value was near zero. Picks 127-175 were made with the
autopilot FROZEN: a re-arm at pick 115 replaced the harvester under an
in-flight reseed, the "pause while reseeding" flag never cleared, and the
room -- all autodrafters by then, a pick every two seconds -- finished the
draft from a stale queue. Yahoo still took K and DEF from the queue because
they had been queued at three picks left.

Fixed: the reseed flag times out after 20 s; arm.js waits for the data
plane by time (90 s) rather than 400 yields, which had silently skipped the
autopilot when a freshly pushed players.json was not yet cached.

Also this draft: Autodraft was OFF after arming (the click landed before
React attached its handler) and would have let Yahoo pick from its own
rankings; the autopilot now reads the button's state every pass.


## Draft 8 — room 10430207 (12-team, slot 2), 2026-09-01

Not a valuation test; a harness test that found four more defects. Yahoo
made picks 2, 23, 26, 47, 50 and 74 for us: the tab was recreated on entry
(the zero-viewport case), the arm.js served to the fresh tab was a ten-
minute-old cached copy whose data wait gave up, and a busy-loop version of
the wait (pushed an hour earlier) starved the renderer so that every script
evaluation timed out. Armed properly at pick ~73, the first pass ran while
a harvest had left the players table on Team Defenses with Drafted on, so
the pool was 32 defenses and the advisor's next recommendation was Jahmyr
Gibbs in round nine. From pick 119 the mechanism was clean: Ferguson,
Murray, Steelers D/ST all as advised; picks 143 and 146 were lost to an
end-game moving a pick every two seconds (queue four deep, defense entering
the ranking on the very pick it was needed), and the last pick took a
second defense because no kicker had reached the queue.

Roster: `QB C. Williams · WR A. Brown, Nabers · RB B. Robinson, Skattebo ·
TE Fannin · flex McLaurin · DEF Steelers, Ravens · no K`. **12 of 12** on
our projections (1637 vs 1813); Yahoo coverage 86%, so no Yahoo-scale grade.

Fixed tonight, all deployed: arm.js loads the autopilot when the index
appears (a property hook, no polling); the arm one-liner carries a
cache-buster; the autopilot reads the Drafted toggle's state (check icon)
and puts the filter back, and re-selects All Positions when the table
shows one position; a reseed pauses passes and times out after 20 s; the
queue is eight deep with two adds per pass when thin; K/DEF enter the
ranking at four picks left; the harvester never mistakes the position
filter for the team list and waits for the Results tab to render.


## Draft 9 — room 10430908 (12-team, slot 10), 2026-09-01

Best result so far: **3 of 11** rosters harvested, on our projections (1774
vs 1819). Roster: `QB Hurts · WR Rice, Evans · RB Barkley, Achane · TE
Goedert · flex Etienne · K Smack · DEF Steelers · bench Daniels, Sutton,
Monangai, Worthy, Meyers, Ravens D/ST`. Kicker and defense both came from
the queue, in the last four picks, as designed.

Caveats, in order of size. Yahoo autodrafted picks 10 and 15 (Barkley,
Achane) before the harness was armed -- the tab was recreated on entry and
the first arm attempt starved the renderer (see draft 8). The harness
believed the room had 11 teams for the middle rounds, because two managers
are named "anthony" and the draft-order strip was deduplicated by name;
that shifted the pick numbers the audit and the picks-remaining gate use,
and it is why a second defense was taken at 159 (our own defense at 154
was filed under the wrong number, so the roster never showed one). The
harvest collapsed the two anthonys into one team, hence 11 rosters graded.
Yahoo-projection coverage came out at 6%, so no Yahoo-scale grade.

Fixed tonight: the strip reader detects the snake's mirrored round rather
than counting unique names; the team count comes from the Results tab's
team list once any harvest has run, and the pick recorder uses it; the
harvester keeps duplicate labels apart.

Of the picks the audit can vouch for after the team count was corrected:
Evans at 82, Sutton at 87, Worthy at 130, Steelers at 154 all matched the
live recommendation.
