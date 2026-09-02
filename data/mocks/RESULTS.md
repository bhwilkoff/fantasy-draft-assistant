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
