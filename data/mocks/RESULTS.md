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
