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
| 10 | 10501714 | 12 | 2 | pick ~75 | **4 / 12** (our proj.) | 1745.2 | 1798.2 | 313.9 |
| 11 | 10504003 | 12 | 4 | before pick 1 | **12 / 12** | 1566.7 | 1728.7 | 162.0 |
| 12 | 10504882 | 12 | 7 | before pick 1 | **3 / 12** | 1715.0 | 1719.6 | 73.0 |
| 13 | 10510897 | 12 | 10 | Tampermonkey, before pick 1 | **3 / 12** | 1736.3 | 1743.1 | 96.6 |
| 14 | 10511947 | 12 | 12 | Tampermonkey, before pick 1 | **1 / 12** | 1709.1 | 1642.8 (2nd) | 236.4 |
| 15 | 10513354 | 12 | 2 | Tampermonkey, pick 10 (room started early) | **3 / 12** | 1859.1 | 2026.4 | 632.4 |
| 16 | 10515116 | 12 | 5 | Tampermonkey, before pick 1 | **7 / 12** | 1686.5 | 1739.6 | 204.5 |
| 17 | 10672228 (Harvey Cup instant mock, 3 rounds) | 12 | 7 | Tampermonkey, before pick 1 | 3 of 3 exact | — | — | — |
| 18 | 10526391 | 12 | 12 | Tampermonkey, before pick 1; real-room flags on | **9 / 12** (drafted on Harvey Cup rules, graded on Yahoo's) | 1670.3 | 1765.5 | 116.8 |

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


## Draft 10 — room 10501714 (12-team, slot 2, human drafters), 2026-09-02

A daytime room with twelve human names, watched live by the user. Not a
valid test of anything but the entry procedure, which it failed: the
waiting-room countdown was frozen in a background tab, the draft had been
running for six rounds by the time "Draft has Started" was read, and Yahoo
autodrafted rounds 1-6 for us ("you have been put into auto pick mode due
to inactivity"). Armed at pick ~75, without the roster string and before
the Results-tab seed had run, so the roster read empty, every position
looked unfilled, and the queue filled with three quarterbacks in a row --
which a snake's back-to-back picks then took. The overlay also told the
human to "clear filters" while the harness's own harvest had the Results
tab open. The tab went unresponsive under the per-pass load.

Roster: `QB L. Jackson, Murray · WR Pickens, Olave, McLaurin, Coker · RB B.
Robinson, Dowdle, Marks, Allgeier · TE LaPorta, Kelce, Andrews · K Reichard ·
DEF Jaguars`. Still **4 of 12** on our projections (1745 vs 1798), which
says more about Yahoo's autodraft picks in rounds 1-6 than about us.

Fixed, all deployed the same hour:

* **The queue is built sequentially.** Entry k is what the advisor says
  after entries 1..k-1 are on the roster and off the board, so a second
  quarterback can never sit behind the first (tests/queue_test.js tick 5).
* **Seed at load.** The autopilot reads our roster from the Results tab
  the moment the room is readable, not only after the next pick.
* **Our team only.** A reseed harvests one roster, not twelve; the
  opponent simulation runs once per pick number, not once per pass.
* **Enter early.** The harness doc now says to go to the draft-client URL
  a minute before the countdown ends; with the loader userscript installed
  the overlay arms itself when the table renders.
* The overlay says "Reading rosters…" during its own harvest instead of
  warning about filters.

Open question raised by the user and worth its own decision: whether to
run mocks with Autodraft OFF and have the autopilot click Draft itself once
the clock is under fifteen seconds, giving the queue the full clock to
settle. The sequential queue removes the failure that prompted it; the
click path needs the Draft button's DOM, to be captured in the next room.


## Draft 11 — room 10504003 (12-team, slot 4, human drafters), 2026-09-02

Armed before pick one for the first time (entered through the waiting
room's link, the loader injected on arrival). Picks 4 and 21 took the
recommendation (Taylor, Allen). Then the tab was replaced twice and, in
between, the page was starved for minutes at a time while the room -- most
of it on auto-pick by then -- moved a pick every four seconds. Yahoo made
picks 28-100 from queue leftovers and its own list, and the final picks
came from a stale queue again (no kicker). **12 of 12** on Yahoo's
projections at 100% coverage.

**The starvation was ours, and the profiler proved it**: one pass took
52 seconds, 6.9 of them in `readDraftOrder`. The snake-period reader added
this morning cloned every strip cell on every pass, and the strip holds
one cell per PICK -- 180 late in a room. The order never changes, so it is
now read once (a text-node walker, no cloning) and cached by strip size.
Opponent simulation trials were cut from 150 to 60, and the sequential
queue is timed separately.

The profiler also showed what every click costs: a queue star or the
Autodraft button is a synchronous re-render of the room (~180-400 ms), so
the actuator now spends one click per pass and never toggles Autodraft
before the draft has started (DECISIONS 018).

What only a human can fix, seen again in this room: a tab replaced by
Chrome (a fresh page, injections gone) and a page blocked by a native
dialog. `bridge/loader.user.js` in Tampermonkey re-arms on every page
load; excluding the site from Memory Saver stops the replacement.


## Draft 12 — room 10504882 (12-team, slot 7, human drafters), 2026-09-02

The first end-to-end run of the whole chain: armed before pick one, no
mid-draft re-arm, the queue held the live advice through all fifteen
rounds, and the room drafted **10 of 15** picks straight from it --
including the defense (Broncos, pick 138) and the kicker (Aubrey, pick 151)
at the four-picks-left gate, then a receiver at 162. Passes averaged 0.46 s
(worst 2.0 s), no native dialogs, no starvation.

Graded on Yahoo's own projections at 100% coverage: **3 of 12**, 1715.0
points, 4.6 behind the winner in a 73-point spread. On our projections the
same roster grades first (1842.8 vs 1767.1); the two scales disagree mostly
on Allen (334 vs 372) and Aubrey (133 vs 176).

Roster: `QB Allen, Dart · RB McCaffrey, Hall, Judkins, Gainwell · WR Watson,
Sutton, Worthy, Boston, Tucker · TE Warren, Kelce · K Aubrey · DEF Broncos`.

The five misses, honestly:

* **Pick 7 (McCaffrey) had no advice on record.** The seed-at-load harvest
  was still reading the Results tab when our first turn came, so the pass
  that would have queued was skipped and Yahoo took its own top player.
  Not a bad pick, but not ours. The seed harvest must finish before the
  first pick or yield to it; see below.
* **Pick 18: Henry advised, Allen taken.** Henry was queue[0]; Yahoo drafted
  the QB. The queue read `Henry > Allen` on the pass before the pick, so
  either Henry went one pick earlier than the log shows or Yahoo drafted
  from the second entry. Unresolved; the audit only logs the advice, not
  the queue as Yahoo saw it at the instant of the pick.
* **Picks 42 and 79** (Rice/Judkins, Kittle/Sutton): the same shape, the
  advised player was gone or the queue had not caught up in a round that
  moved a pick every four seconds. One click per pass is the price of not
  starving the tab; near our pick the pass rate is already 1 s.
* **Pick 175 had no advice** because the final-round harvest occupied the
  Results view (by design) and the last pick fell before it restored.

**Defect found by the grade, fixed the same hour.** The autopilot's own
final harvest produced a projection map covering 0% of drafted players.
The scrape pages the Players table through the Drafted toggle and the
position filter -- and the autopilot's filter self-heal, added after draft
10, saw exactly that and put the filters back mid-scrape (`filterfix=2`).
Harvesters now raise `__hcHarvestBusy` and the autopilot skips its pass
while it is up (90 s ceiling); tests/queue_test.js tick 6 covers it. The
grade above is from a manual re-scrape after the room closed, which worked
because this room, unlike draft 7's, still rendered the table.


## Draft 13 — room 10510897 (12-team, slot 10, Tampermonkey-armed), 2026-09-02

The first room armed by the userscript alone: Tampermonkey ran
`bridge/loader.user.js` when the draft client rendered, the overlay and
the autopilot were up with a four-deep queue forty seconds before pick
one, and nothing was injected by hand. **14 of 15** picks were the
recommendation (the audit prints 13/15 because a post-draft pass
overwrote round one's advice; fixed). Graded on Yahoo's own projections
at 100% coverage: **3 of 12**, 1736.3 points, 6.8 behind the winner in a
96.6-point spread.

Roster: `QB Hurts, Dart · RB McCaffrey, Henry, Williams, Monangai · WR
Adams, Wilson, Golden, Shakir, Boston · TE Kittle, Kelce · K Mevis · DEF
Broncos`.

**The room changed how a mock drafts.** Picks 10 and 15 were taken by
Yahoo's clock from queue[0] -- and after the first one Yahoo moved the
seat into auto-pick mode. The user's requirement is that the exact
recommendation is drafted every time, so from pick 34 the autopilot
clicked the room's own **Draft** button (DECISIONS 020): picks 34, 58,
63, 82, 87, 106, 111, 130, 154, 159 and 178 were drafted that way,
including the back-to-back snake turn at 82/87 and the kicker at 154.
Two lessons from the first version of that click, both now in the code
and in `tests/queue_test.js`:

* **Wait for the header.** The title flips to "YOUR TURN" a beat before
  the header's pick number advances; a click at that instant drafted the
  previous pass's advice (Garrett Wilson at pick 39, when the advice for
  pick 39 was Lamar Jackson). The click now waits until the header's
  pick is one of ours.
* **Never let the clock expire.** The in-room patch matched by
  abbreviated name and could not find "Broncos D/ST" at pick 135; the
  clock ran out, Yahoo drafted the (correct) queue top and put the seat
  back into auto-pick. The committed click matches by Yahoo's player id,
  falls through the plan to any entry with a button, and under twenty
  seconds takes any Draft button on screen. Autodraft is switched back
  off whenever Yahoo turns it on.

**Panel and queue disagreed, and the user saw it three ways.** The
"Then" list was a flat ranking while the queue is sequential; a new
recommendation landed at the *end* of Yahoo's queue (Yahoo appends) and
the two-click budget took several passes to evict the entries ahead of
him; and the panel read the roster itself, got nothing, and recommended
a tight end for an empty roster while the autopilot, with 14 of 15
rostered, queued a receiver for the last bench slot. All three are
fixed: the panel now renders the autopilot's own roster, advice and
queue plan and re-renders on every pass, and the actuator evicts
everything ahead of a missing recommendation in one pass. This room ran
the code it loaded at pick one, so the next mock is the one that
validates those fixes end to end.

Also new: `bridge/loader.user.js` 2.1.0 never arms the autopilot in the
Harvey Cup room (league 539156) whatever the mock flag says, and carries
an update URL so Tampermonkey pulls new versions itself.


## Draft 14 — room 10511947 (12-team, slot 12, Tampermonkey-armed), 2026-09-02

The validation run for everything that shipped during draft 13, on the
code Tampermonkey pulled at pick one. Yahoo carried the tab from the
waiting room into the client by itself; the overlay and the autopilot
armed with no injection; the panel's list and Yahoo's queue read
identically, eight for eight in the same order, all draft; "Off the
board / Plan adjusted" showed each opponent's pick and its effect.

**Every one of our fifteen picks was drafted by our own click**, including
the back-to-back snake turns at 12/13, 36/37, 60/61, 84/85, 108/109,
132/133 and 156/157, the defense at 156 and the kicker at 157. Autodraft
never came on. **14 of 15** were the exact recommendation. Graded on
Yahoo's projections at 100% coverage -- from the autopilot's own final
harvest, so the busy flag from DECISIONS 019 did its job -- **1 of 12**,
1709.1 points, 66 clear of second in a 236-point spread. (The two-
quarterback, two-tight-end shape is Yahoo's half-PPR mock rules and a
room that let Allen fall to 36; Harvey Cup is scored differently.)

Roster: `QB Allen, Purdy · RB Henry, Achane, Etienne, Monangai · WR Adams,
Sutton, Worthy, Meyers, Boutte · TE LaPorta, Kittle · K Aubrey · DEF Broncos`.

The one miss, pick 133: the instant after our own click at 132 the table
re-rendered, the next recommendation's row was not there for one pass,
and the fallback ladder took plan entry 3 (Meyers for the Broncos) with
seventy seconds on the clock. Also found: the status reader's clock is
null on our own turn, so a clock gate would have waited forever. Both
fixed (commit 40a9915): the clock is read from the room header, the
click waits while there is time, walks the plan under twenty seconds,
takes any button under ten, and treats an unknown clock as low. A
second locator walks up from the player's cell, and a miss now records
what it saw. The Broncos were then drafted by the click at 156, so
defense rows are not special.

The pick-log attribution artifact from the "Last:" header (a back-to-back
turn filed our first pick's player under the second as well) showed up
in this room's audit as 7/12; the click record is now authoritative for
our picks (commit ff6009e), also not in this room's code.


## Draft 15 — room 10513354 (12-team, slot 2, Tampermonkey-armed), 2026-09-02

The run for the league-wide report, on the code that shipped during
draft 14. The room started before its own countdown said it would, so
pick 2 (Bijan Robinson) was Yahoo's before the stack armed; the seed read
the roster from the Results tab and every pick from 23 on was ours:
**13 clicks, 14 of 15 the exact recommendation**, including the
back-to-back turns at 23/26, 47/50, 71/74, 95/98, 119/122 and 143/146,
the defense at 143 and the kicker at 146. Graded on Yahoo's projections
at 99% coverage: **3 of 12**, 1859.1 to Mary's 2026.4; on our own
projections the same roster grades first (1904.4).

Roster: `QB Allen, Purdy · RB B. Robinson, Jeanty, Judkins, Gainwell · WR
G. Wilson, Odunze, Golden, Shakir, Samuel · TE LaPorta, Kelce · K Dicker ·
DEF Broncos`.

**The report exists.** `data/mocks/reports/10513354.yahoo.md` is what the
room produced at the end (Yahoo's scale); `data/mocks/reports/10513354.md`
is the same draft regenerated offline by `tools/draft_report.js` from the
saved bundle in `data/mocks/harvests/`, on our projections, with the
first version's defects fixed. Every team has a grade, positional ranks,
its best values and worst reaches, bye stacks, and whether it was
autodrafting; the draft is narrated round by round.

Three defects, all fixed the same hour:

* **The roster doubled after each reseed.** The click records "Josh
  Allen", the Results tab says "J. Allen", and the union was by name
  text: three picks became a roster of five, then 21 of 15 at the end,
  and the last pick had no recommendation. The merge now keys by pick
  number, then by the matched player.
* **The recommendation's row had no Draft button** at pick 170 (Denzel
  Boston), the same shape as pick 133 in draft 14: rows far down the
  table render without the button. The click now scrolls the row into
  view and looks again next pass. Yahoo's clock took Deebo Samuel from
  the queue.
* **In the report**: Brian Robinson Jr. at 142 resolved to Bijan (the
  Results tab has no ADP to split them); our own back-to-back picks were
  listed as near misses against ourselves; zero-projection bench players
  filled the one-pick-late list. Fixed in `bridge/report.js` and pinned
  by `tests/report_test.js`.

Chrome replaced the tab a minute after the draft ended, so the complete
harvest lived only in localStorage's final-round copy; the saved bundle
has 169 of 180 picks. Lesson for Saturday: run `__hcReportShow()` and
copy the report out before leaving the room.


## Draft 16 — room 10515116 (12-team, slot 5, Tampermonkey-armed), 2026-09-02

The top-to-bottom run. In the room twenty seconds before the start
(through the waiting room's "Enter Draft" link; the direct client URL is
refused until Yahoo offers that link -- loader 2.2.1 now clicks it the
instant it appears), armed before pick one, and **every one of our fifteen
picks was the exact recommendation, drafted by our own click**: 5, 20, 29,
44, 53, 68, 77, 92, 101, 116, 125, 140 (Broncos), 149 (Myers), 164, 173.
No auto-pick, no missed clock, no re-arm, the roster count right all the
way (the merge is now keyed by resolved player OR pick number, tests
tick 10, after the seed's missing pick number doubled it once more at
pick 6 and was hot-patched in the room). The final-round harvest ran with
the busy flag and graded at 100% Yahoo coverage; the report was written
in the room and regenerated after the last pick with all 180.

Graded on Yahoo's projections: **7 of 12**, 1686.5 to Jared Anable's
1739.6 in a 204-point spread. The mechanism was perfect; the valuation
landed mid-pack in this room, which is the honest measurement of a
board that disagrees with Yahoo's in the same places every time (see the
user's question about Kelce and Judkins in the session notes).

Roster: `QB Allen, Purdy · RB Taylor, J. Williams, Judkins, Gainwell · WR
Evans, Sutton, Worthy, Samuel, Boston · TE LaPorta, Kelce · K Myers · DEF
Broncos`. Report: `data/mocks/reports/10515116.md`; bundle:
`data/mocks/harvests/10515116.json`.


## Draft 17 — Yahoo's instant mock of Harvey Cup (room 10672228, slot 7, 3 rounds free), 2026-09-02

The dress rehearsal on our own league's settings: snake, one-minute
clock, 12 teams, 17 rounds, simulated opponents, and Yahoo put us in
slot 7. Run with the real-room flags forced on (`hcDraftDelay` 20,
`hcAssumeAutodraft` 1). All three picks were the recommendation, each
clicked by the autopilot after the 20-second override window ran down
(Taylor 7, Pickens 18, Nabers 31); every opponent seat was modelled as
autodraft until seat 6 burned clock and was re-classified. The new
per-source line showed on every pick (ESPN / Sleeper / CBS / Sharks and
the Yahoo delta). The preview ends after three rounds and the offer was
one-time.

**What it found:** the room runs under a fresh mock id, so the overlay
treated it as a Yahoo mock and used Yahoo's default scoring -- the
roster size did self-correct to 17 from the Results tab, the scoring did
not. The room header says "Harvey Cup - Mock Draft", so the overlay now
recognises the configured league by name in any room, and
`localStorage.hcLeagueOverride` ('config' | 'mock') forces it either way.
Not yet seen in a room; mock 18 runs with the override on.


## Draft 18 — room 10526391 (12-team, slot 12), real-room flags on, 2026-09-02

Run with `hcDraftDelay` 20, `hcAssumeAutodraft` 1 and `hcLeagueOverride`
'config', so the room drafted on Harvey Cup's rules (full PPR, 6-point
passing TDs; the footer read "Harvey Cup rules (override)", then "(room)"
once the Results tab supplied the 15-slot lineup) while being graded on
Yahoo's defaults -- so the 9th of 12 (1670 to 1766) is not comparable
to the other mocks and was not the point. Armed before pick one, 12 of
15 exact, and three misses that each found a defect:

* **Picks 60 and 61 were Yahoo's clock.** The 20-second override window
  ran full autopilot passes underneath Yahoo's own on-the-clock
  rendering; the renderer froze for 19 seconds and the click never ran.
  The window is now quiet time: no pass while it is open, and the panel
  reuses the autopilot's result instead of computing its own
  (DECISIONS 023). The delay was set to zero in the room for the rest of
  the draft.
* **Picks 133 and 157 fell to the plan ladder** on the second pick of a
  back-to-back turn with a defense, then a kicker, on top. The
  recommendation's Yahoo id in the name-to-id map was one that was on no
  row (a row at another position had overwritten it), and the clock read
  as unknown. Fixed three ways: one id per player and only from a
  same-position row, the clock found as the small element reading mm:ss,
  and a second locator by the room's short name before the ladder.

Everything else held: entry twenty seconds before the start, the
autodraft prior re-classifying seats as they burned clock, the
per-source line and Yahoo delta on every pick, the in-room report.
Report: `data/mocks/reports/10526391.md`; bundle in `data/mocks/harvests/`.


## Draft 19 — room 10601647 (12-team, slot 10), joined mid-draft, 2026-09-03

Not a clean run and not graded. The room had been joined from another
tab at 9:52 MDT (the log shows the autopilot armed at pick 1 and queuing
from Gibbs on); that tab died around pick 50, Yahoo drafted picks 58-106
for the seat from the queue and its own rank, and the session found the
registration in the lobby ("Launch Draft App") at round 10 and entered.
Real-room flags were on (`hcDraftDelay` 20, `hcAssumeAutodraft` 1).

What it measured:

* **Every one of our turns froze the renderer, for 70 to 180 seconds.**
  Pick 111: the turn opened at +0 s, the click is recorded at +66 s (after
  Yahoo's clock had already taken Goedert from the queue). Pick 130: the
  click landed at +21.7 s, 1.7 s after the 20 s window closed -- the
  mechanism working exactly as designed. Pick 135: the turn opened, the
  next log entry is 177 s later, and the draft finished (picks 136-180)
  while the page was frozen; the tab's title never left "YOUR TURN, DRAFT
  NOW" and a fresh tab had to be opened.
* **Every freeze coincided with a tool call into the draft tab** from the
  monitoring session (a JavaScript eval or a screenshot issued during or
  just before our turn); the page came back within seconds of the last
  call timing out at 45 s, and the extension itself reported "not
  connected" at the same moment. Pick 130, the one turn with no call
  issued, was clean. The lobby page -- no draft, no autopilot -- also hung
  a 45 s eval once. The quiet window (DECISIONS 023) held: `windowSkips`
  counted the quiet passes and no pass ran inside the window.
* The autopilot now records its own stalls (a 250 ms heartbeat, gaps over
  1.5 s with the tab's visibility) and the browser's long tasks with
  attribution, persisted with the log, so the next room can tell a frozen
  renderer from a frozen debugger session. Draft 20 runs with the 20 s
  window and no tool call into the draft tab at all.
* `clock` is null in every log entry, including on our turn (the status
  reader's regex looks for mm:ss in the body text; the room renders the
  opponents' clock as bare seconds and ours inside the header). The click
  path finds the clock itself when it needs it; the audit does not.

Roster (Yahoo's picks 1-9 for the seat from our queue, then ours): `RB
Achane, C. Brown, Pollard · WR Rice, G. Wilson, McLaurin, Sutton · TE
Fannin, Goedert, Ferguson · QB Prescott · DEF Broncos · K Myers`. The
saved log is in localStorage on the Yahoo origin as `hcSavedLog_10601647`.


## Draft 20 — room 10603061 (12-team, slot 4, twelve humans), real-room flags, 2026-09-03

**2nd of 12 on Yahoo's projections, 1707.4 to Cj's 1739.0**, graded at 100%
coverage; every one of the fourteen picks after we entered was the exact
recommendation, drafted by our own click (Yahoo took J. Chase at 4 before
we were in: slot 7 was taken in the last seconds of the lobby and the
waiting room's countdown had frozen in a background tab). Run with
`hcDraftDelay` 20 and `hcAssumeAutodraft` 1 against a room of twelve
humans (two seats were later re-classified as autodrafting from their
2-3 s medians). No tool call was sent into the draft tab during any of
our turns; the page's own stall recorder saw nothing over 3 s while the
tab was visible.

Roster: `QB Allen, Dart · RB Skattebo, Judkins, Monangai, A. Jones · WR
Chase, Evans, Sutton, Samuel, Shakir · TE McBride, Fannin · K Myers · DEF
Broncos`. QB, TE and K graded 1st; RB 12th. Report:
`data/mocks/reports/10603061.yahoo.md`; bundle and both autopilot logs in
`data/mocks/harvests/`.

What it found, by click time after the previous pick landed:

| picks | code | click landed at |
|---|---|---|
| 21, 28, 45, 52, 69, 76 | before the reload | 23.3, 20.7, 23.6, **29.7**, 26.8, 22.6 s |
| 93, 100, 117, 124, 141, 148, 165, 172 | deadline timer (DECISIONS 024) | 20.6, 21.1, 21.6, 20.1, 20.1, 21.1, 21.8, 21.7 s |

* **The room's clock is 30 seconds, not 60.** The slowest of 97 opponent
  picks took 32 s. A 20 s window on a 30 s clock put the click at 21-30 s;
  the user watched it land with five seconds left, and at pick 52 Yahoo
  answered "the pick you are trying to make is not the current pick"
  while its clock drafted Judkins from our queue. Harvey Cup's clock is
  60 s (`config/league.json`), so the real room keeps 40 s of margin --
  but the window is now capped at the room's clock minus 15 s, read from
  the header timer on the first pass of our turn (`clockAtTurn=` in the
  status line), so no room can be left with less.
* **After the window closed, nothing woke the click.** A pass ran only on
  a DOM change or the 15 s backstop, and a hidden tab throttles the
  backstop to once a minute. The window's end is now a deadline: a blob
  Worker timer forces a pass at the exact end and every second after until
  the click is recorded (DECISIONS 024). Armed 8, fired 8.
* The reload mid-draft (with 15 picks to spare) re-armed through
  Tampermonkey and restored all six clicked picks from the persisted log.
* Long tasks attributed to the page itself: 0.5-1.1 s around each click,
  which is Yahoo's re-render plus our pass; nothing else.

Open: the clock capture in the audit log still read null at pick 93 (the
re-arm may have fetched the previous bridge from the Pages cache); and
Jaxson Dart at 100 as a second quarterback with RB graded 12th is worth a
look at `BENCH_DISCOUNT.QB` under Yahoo-default scoring.


## Draft 21 — room 10604470 (12-team, slot 11), real-room flags, 2026-09-03

**First of twelve, 1711.3 to David's 1678.4, grade A**, graded at 100%
Yahoo coverage, and the first genuinely hands-off run: armed by
Tampermonkey before pick one, **all fifteen picks the exact recommendation
drafted by our own click**, no tool call sent into the draft tab from the
first pick to the last, no re-arm, no missed clock. Four seats were
autodrafting (medians of 1-3 s), which is the closest a lobby mock has
come to the Harvey Cup room.

Roster: `QB Daniels, Dart · RB Achane, Henry, Etienne · WR Rice, J.
Williams, Sutton, Worthy, Samuel · TE Kittle, Goedert · K Aubrey · DEF
Broncos`. Report: `data/mocks/reports/10604470.yahoo.md`.

**The clock-capped window (DECISIONS 024) is confirmed in a room.** The
room's clock was 30 s, the configured window 20 s, and the cap held it to
15 s; every click landed between 13.1 and 16.3 seconds after the previous
pick:

| pick | 11 | 14 | 35 | 38 | 59 | 62 | 83 | 86 | 107 | 110 | 131 | 134 | 155 | 158 | 179 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| click at | 13.1 | 15.8 | 15.0 | 16.3 | 15.1 | 14.1 | 15.7 | 15.7 | 16.2 | 16.0 | 13.1 | 15.9 | 15.1 | 15.6 | 13.1 |

Also confirmed: the audit log now carries the clock on every pass
("00:29", "00:26", "00:19" and so on, where every earlier mock logged
null), and **the deadline timer works in a hidden tab** -- the stall
heartbeat recorded 60-second gaps for the whole draft, which is Chrome
throttling `setInterval` in a background tab, while the Worker timer kept
firing and every click still landed on time. That is the case the real
draft has to survive if the user switches tabs.

One thing did not run: `hcFinalGrade` was never written for this room, so
a reader found the stale grade from an older mock. The grade was only
written by `__hcSupervise()`, which a Claude session calls by hand; the
final-round harvest now writes it itself.


## Draft 22 — room 10708782 (12-team, slot 3), real-room flags, 2026-09-04

**3rd of 12, 1725.0 against a winning 1729.2** -- the top four inside seven
points -- with QB and TE graded 1st and WR 3rd. Fourteen of fifteen picks
were the exact recommendation drafted by our own click, no tool call was
sent into the draft tab during the draft, no dialogs, no missed clock, and
**the autopilot wrote the report AND the grade by itself** (`grade=3/12` in
the status line), which was the fix made an hour earlier.

Roster: `QB Allen, K. Murray · RB Irving, Montgomery, A. Jones, Spears ·
WR Chase, Odunze, Pierce, Sutton, Samuel · TE McBride, Fannin · K
Fairbairn · DEF Steelers`. Report: `data/mocks/reports/10708782.yahoo.md`.

Two defects, both found in the log and both fixed:

* **Pick 3 was Yahoo's, not ours.** Yahoo moved us from slot 7 to slot 3
  at the room's start and the room began drafting immediately; the
  autopilot's first pass ran at 14:43:57 against a start of about 14:42,
  so our first-round pick was gone before the stack armed. It resolved to
  J. Chase, who was the recommendation anyway. This is a lobby-mock
  hazard: those rooms start the instant they fill, and the entry sequence
  costs a minute or two. In Harvey Cup we are in the room half an hour
  early, which is exactly what drafts 16 and 21 did.
* **The override window collapsed to zero on back-to-back turns.**
  `windowFor` recorded 15 s at picks 22, 46, 70 and 75 but **0 s at picks
  27 and 51** -- the second pick of each turn, where the room still showed
  the tail of the previous timer, so `clock - 15` came out negative. The
  click went out under three seconds into a turn that had a full clock.
  Nothing was lost, but the human had no window on those turns. A clock
  reading at or below the margin in the first four seconds of a turn is
  now discarded and re-read (DECISIONS 025).

Everything else held: `deadline=worker`, armed 12, fired 10; `clockAtTurn`
read 00:30 on every turn; the stall heartbeat logged 60-second gaps all
draft, which is Chrome throttling a background tab while the Worker timer
kept the clicks on time.


## Draft 23 — room 10710193 (12-team, slot 11), real-room flags, 2026-09-04

**First of twelve by forty points, 1725.0 to Martin's 1684.6.** Thirteen
of fifteen picks by our own click; the report and the grade both written
by the autopilot in the room (`grade=1/12`).

Roster: `QB Daniels, Shough · RB Henry, Achane, Etienne · WR McMillan, P.
Washington, Pierce, Sutton, Samuel · TE Fannin, Andrews · K Mevis · DEF
Broncos`. Report room: 10710193.

**The stale-clock fix (DECISIONS 025) is confirmed.** Slot 11 gives a
back-to-back turn every round, and `windowFor` now reads **15 at all
thirteen turns it sized** -- 11, 14, 35, 38, 59, 62, 83, 86, 107, 131,
134, 155, 158 -- where the same shape produced zeros at two turns in the
previous mock. Every second pick of a turn got the same window as the
first.

The two picks that were not ours both fell to the same cause, and it is
not the clock:

* **Pick 110 had no pass at all.** The roster re-read that follows each of
  our picks started after pick 107 and was still holding the Results tab
  three picks later, so every pass returned early and the turn opened and
  closed unobserved. Yahoo's clock took Mark Andrews from the queue --
  which is our own ranking, so the pick was sane, but it was not ours.
* **Pick 179, the last of the draft**, fell to the final-round harvest for
  the same reason, as it has in earlier mocks by design (DECISIONS 019).

Fixed in DECISIONS 026: the re-read is deferred while our next pick is
four or fewer away, and abandoned after three seconds instead of twenty
if our turn opens while it runs.
