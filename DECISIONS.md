# Architecture decisions

Each entry leads with the rule, then why, then how to apply it.

---

## 001 — Score raw stat projections, never a provider's point total

**Rule:** ingest raw stat lines and apply `engine/league.py`. Never consume a
`Proj Pts` / `FPTS` column from anyone.

**Why:** Harvey Cup pays 1.0 per reception and 6 per passing TD. Every
published point total is computed under the publisher's own rules, so
consuming one silently imports the wrong league. Josh Allen is 434 points
under our rules and 370 on ESPN's own board.

**How to apply:** if a new source only exposes computed points, it can be a
cross-check but never the projection of record.

---

## 002 — Simulate replacement level; never hardcode "WR36"

**Rule:** fill all 12 lineups greedily (base starters, then flex to the best
eligible) and read replacement off the last player actually started.

**Why:** this league starts 3 WR plus a W/T and a W/R flex, both WR-eligible.
The result is 47 startable WRs, not 36. Hardcoding the common shortcut
misprices every receiver on the board.

**How to apply:** if the lineup changes, change nothing — the simulation
re-derives it. Never paste a replacement rank from an article.

---

## 003 — Keep valuation and timing separate

**Rule:** VOR comes only from projections; ADP is used only for availability.
Report the difference as `edge`; never blend them into one number.

**Why:** the gap between what a player is worth and when he will be drafted
*is* the edge. Public "value" boards blend them and destroy exactly the
signal a live advisor needs.

---

## 004 — Do not weight positional dropoff (DROPOFF_WEIGHT = 0)

**Rule:** show the positional cliff to the human; do not let it modify the
recommendation score.

**Why:** sweeping the weight against simulated projection error degraded
results monotonically (mean finish 3.13 → 3.90 across w = 0 → 1). VOR already
prices scarcity, because the replacement baseline *is* the last startable
player at the position. Adding a dropoff term double-counts it and, at pick
10, adds ~+89 to every RB and WR against +0.7 to a QB.

**How to apply:** before adding any new "urgency" term, ask whether the
replacement baseline already contains it, then prove it in `engine/sim.py`
under projection error — not under perfect projections, where every term
looks like it helps.

---

## 005 — Read the draft room's DOM, not its WebSocket

**Rule:** the bridge scrapes the DOM and binds only to `ys-*` semantic hooks.

**Why:** the client opens one WebSocket during page load, so a hook installed
afterwards captures nothing, and re-navigating still loses the race. There is
no XHR polling to read instead. The official API needs OAuth and lags the
room. Hashed CSS-in-JS classes (`_ys_17wruqx`) churn on every deploy, so
binding to them guarantees silent breakage.

**How to apply:** any new selector goes in `tests/fixtures/draftroom.html`
first, so `tests/dom_test.js` fails loudly when Yahoo changes it.

---

## 006 — Match on full first names between sources, initials only in the room

**Rule:** `names.key()` (full first name) merges projection sources.
`roomKey()` (first initial) is only for the draft room, and must be
disambiguated by team and then by the room's ADP column.

**Why:** two bugs, both of which produced confident wrong advice. An
initial-based merge key gave Bijan Robinson the ADP of Brian Robinson Jr.
(156.7 instead of 2.3). And stripping suffixes positionally rather than from
the tail ate the initial "V." as a roman numeral, resolving "V. Jefferson" to
Justin Jefferson. In 2026 Bijan and Brian are *teammates*, so team alone is
not enough — the ADP column is the only remaining separator.

**How to apply:** never widen a match without a test in
`tests/match_test.js`; an ambiguous match must be reported, never guessed.

---

## 007 — Duplicate the advisor in Python and JS, and guard it with a golden test

**Rule:** `engine/advisor.py` and `web/advisor.js` are the same algorithm, and
`tests/parity_test.py` runs both over shared fixtures and diffs the numbers.

**Why:** the overlay must answer inside a 60-second pick clock with no network
hop, and the simulator needs Python. Two implementations will drift, and the
drift is invisible — both keep producing plausible advice for different
players.

**How to apply:** change a constant in one, change it in the other, re-run the
sweep in `engine/sim.py`, and re-run the parity test.

---

## 008 — Validate every DOM-derived number against a plausible range

**Rule:** any quantity read from a page (team count, roster size, pick
number) gets a sanity range, and a read outside it falls back to a known
default rather than propagating.

**Why:** `readDraftOrder()` returned the draft-order strip, which Yahoo
re-renders once per ROUND. A 14-team, 15-round draft therefore reported
**210 teams**. Nothing crashed. Replacement level simply became the
210th-best quarterback — about zero points — so every QB carried an enormous
VOR, and the advisor spent the middle rounds recommending quarterbacks. It
drafted two of them before the pattern was noticed in a live mock.

This is the characteristic failure of scraped inputs: they do not fail, they
produce a confident wrong answer downstream of a plausible-looking read.

**How to apply:** `numTeams` is now clamped to 4..20 and the strip is deduped
to its first cycle. When adding any new scraped input, ask "what is the
absurd value here, and what happens if I get it?" — then encode the answer.
The overlay also surfaces the detected league (`WR35 RB35 start`) precisely so
a wrong read is visible on screen rather than buried in the maths.

---

## 009 — Seed state from the authoritative view; never assume you saw the start

**Rule:** when the harness can attach mid-stream, it must reconstruct prior
state from a source of record, not from what it happened to observe.

**Why:** our roster was derived purely from picks observed after arming. Arm
at round 6 and the advisor believes it owns nothing, so every position reads
as an unfilled starting slot. In a completed mock this produced **four tight
ends and three receivers**, and a 5th-of-14 finish that looked like a
strategy failure and was actually a state-tracking failure.

**How to apply:** the Results tab knows every roster regardless of when we
arrived — read it once at arm time and merge with the observed log. More
generally, any observer that can start late needs a catch-up read, and any
metric derived from "what I saw" should be labelled with how much of the
event it actually covered.

---

## 010 — Anything that scales with the league is a parameter, never a constant

**Rule:** roster size, team count, round count, and lineup shape are read from
the room at runtime. No Harvey Cup number may sit in a shared code path as a
literal.

**Why:** `ROSTER_SIZE` was hardcoded to 17 (Harvey Cup) while a Yahoo mock has
15. Every gate expressed as "picks remaining" therefore mis-fired — most
visibly the one that finally allows a kicker and a defense, which never
opened. The roster finished with no K and no DEF, two starting slots scoring
zero, and came **dead last of fourteen**. The advisor was working correctly on
the wrong league.

**How to apply:** the same failure already happened twice in the other
direction — `numTeams` read as 210 from a repeating strip, and `numTeams`
frozen at the fallback 12 in a 14-team room. Treat every league quantity as
untrusted input: read it, range-check it, surface it in the overlay so a bad
value is visible on screen, and never let a constant stand in for it.

---

## 011 — An actuator that only appends is not an actuator

**Rule:** any mechanism that turns advice into action must express the
CURRENT ranking, not the accumulated history of past rankings.

**Why:** the autopilot added its top recommendations to Yahoo's queue and
never removed anything. Yahoo drafts `queue[0]` — the earliest entry — so a
draft that ran fifteen rounds was still picking from a queue assembled in
round two. The advisor recommended a kicker in round fifteen and the room
took a receiver queued in round two. Four mock drafts produced rosters that
looked nothing like the board, and the natural conclusion — "the valuation is
wrong" — was the wrong conclusion.

**How to apply:** the queue is now rebuilt to exactly the top N each pass:
un-star what is no longer wanted, then star the wanted set in order. More
generally, when a system advises and something else acts, verify the ACTION
matches the advice — do not infer it from the advice being correct. The
status line now carries `qtop=` for exactly this reason.

---

## 012 — Read the actuated system's state; never trust your own memory of what you did

**Rule:** the queue actuator reconciles against Yahoo's queue panel on every
pass. It never consults a private record of which stars it clicked.

**Why:** the second-generation actuator kept a `queued` map and un-starred by
looking up `.ys-addqueue[data-id]`. Yahoo swaps a queued player's star to
`.ys-removequeue`, so the lookup found nothing, the map forgot the player,
and Yahoo kept him -- for the rest of the draft. Two quarterbacks were
drafted from a queue the actuator believed was empty of quarterbacks. The
offline test passed, because the fixture reflected the actuator's model of
the page rather than the page.

**How to apply:** an actuator's test fixture must model the target's
behaviour (here: the class swap and the panel), not the actuator's
assumptions. And when a click has a side effect you can observe, observe it
on the next pass instead of remembering it.

---

## 013 — Attribute an event by identity, not by a counter read at the same instant

**Rule:** a pick is numbered from WHO made it (drafter name -> snake slot ->
the largest of that slot's pick numbers at or below the counter), never from
"the counter minus one".

**Why:** the room's "Last: <player>" and "Round R, Pick P" are separate
React updates. A pass that runs between them logs the pick under the wrong
number, and the entry then blocks the real one. The roster count ran two low
for an entire draft, which is the one direction that matters: the gate that
finally permits a kicker and a defense is "picks remaining <= 2", and it
never opened.

**How to apply:** when two DOM values must agree, assume they will not at
the moment you read them, and derive the fact from the one that cannot
drift. Then re-read the authoritative view (the Results tab) at a natural
checkpoint anyway -- that read costs two seconds a round.

---

## 014 — Availability is a question about the drafters in front of you, and the room knows who they are

**Rule:** the live advisor's "will he last to my next pick" comes from
simulating the specific opponents who pick between now and then, using the
rosters they have actually built (`bridge/opponents.js`, a port of
`engine/opponents.py`). The closed-form Normal(ADP) model is the fallback
only.

**Why:** the user's brief is a tool that beats *these* opponents, not a
generic board. The autopilot already records every pick with its drafter, so
each opponent's roster is known for free; a team holding three running backs
in round six is not a threat to the running back we want, whatever ADP says.

**How to apply:** feed the model everything the room reveals about a
drafter. Never let it move a pick by itself (DECISIONS 004 still stands --
availability informs the expectation of what is left later, it does not
outrank value), and keep the ADP fallback so an empty pick log degrades
gracefully.

---

## 015 — An autodrafting opponent is deterministic; detect it and model it that way

**Rule:** a slot whose picks all land within a few seconds of its turn
opening is Yahoo's autodraft. It is simulated as "best XRank at a usable
position, no noise"; people keep the noisy-ADP model.

**Why:** Harvey Cup is a new family league in which most managers had not
touched the site between creation and draft week. Several draft-day
opponents will be autodraft, and autodraft follows Yahoo's public rank (the
room's XRank column) exactly. That is the most predictable drafter there is,
and predicting it converts directly into knowing what will still be on the
board at our pick.

**How to apply:** the fingerprint is timing, which the autopilot now records
per pick. Watch `autodrafters=` in `__hcStatus()`; if a human is misfiled
because they happened to pick fast twice, the cost is a slightly wrong
availability estimate, never a wrong valuation.

---

## 016 — Value from a consensus of projection sources, never from one

**Rule:** the projection of record is a blend of independent sources (ESPN,
Sleeper, and Yahoo's own stat line read from the room), combined at the
raw-stat level and then scored under the league's rules as always
(DECISIONS 001).

**Why:** the first mock in which the room took our advice pick for pick
finished last under Yahoo's projections *and* 11th under our own. Every
starter we drafted was a player ESPN rates well above Yahoo; the winner's
were players Yahoo rates at least as highly. A single-source engine
systematically selects the players its source is most bullish on relative
to everyone else -- precisely the players that source is most likely wrong
about. The "edge" it thought it saw was one forecaster's noise.

**How to apply:** when a source disagrees sharply with the consensus on a
player, that is a reason to trust the *consensus*, not a reason to draft
him. Show the disagreement in the overlay as information; do not let one
source's optimism be the valuation.

---

## 017 — The league is a file, and the browser reads the same file

**Rule:** `config/league.json` is the only place a league is described.
`engine/league.py` loads it; `engine/build.py` writes the lineup string and
the scoring preset into `data/meta.json`; the overlay and the standalone
board apply those rather than any built-in preset.

**Why:** the rules were spread across `league.py` constants, a preset in
`web/league.js`, a fallback string in the bridge, and `NUM_TEAMS`/`ROUNDS`
in the standalone board. Four copies of one fact drift, and the earlier
mocks showed what a wrong roster size or team count does downstream
(DECISIONS 008, 010). One file, read by both languages through the data
plane, means changing leagues is an edit and a rebuild.

**How to apply:** if a new rule is needed (a superflex slot, a bonus
category), add it to the JSON, teach `league.py` and `web/league.js` to
read it, and let `build.py` carry it. Never add a league number to code.

---

## 018 — Every click into the room is a full React re-render; budget clicks, not computation

**Rule:** the autopilot makes at most one star click per pass (two when the
queue is empty) and never toggles Autodraft before the draft has started
or more than once per thirty seconds.

**Why:** rooms kept going unresponsive and it was natural to blame the
opponent simulation or the readers. A profiler in the browser stack
(`__hcProfile()`) showed a pass costing 500-4,400 ms while every profiled
computation summed to under 100 ms. The remainder was the clicks: a queue
star or the Autodraft button is a synchronous React state change that
re-renders the whole room (~180 ms each), and a pass that reconciled four
entries plus retried Autodraft every three seconds spent most of the
main thread on Yahoo's rendering. Before the draft starts Yahoo ignores the
Autodraft click, so the retry loop was pure cost.

**How to apply:** treat a click as expensive I/O, not a free call. Spread
actions across passes; the passes come every second and the queue settles
within a few. When the room misbehaves, read `pass=` and `prof=[...]` in
`__hcStatus()` before guessing.

## 019 — A harvest owns the Players table's filters until it is done

**Rule:** both harvesters (`__hcYahooProj`, `__hcHarvest`) raise
`window.__hcHarvestBusy` while they run, and the autopilot makes no pass at
all while it is up (ninety-second ceiling, so a harvest that never resolves
cannot freeze the draft).

**Why:** the projection scrape reaches every drafted player by turning the
Drafted toggle on and paging through the position filter. The filter
self-heal added after draft 10 exists to undo exactly that state when a
harvest is interrupted. In draft 12 it could not tell the difference: it
put the filters back mid-scrape, the map covered 0% of drafted players,
and the grader (correctly) refused Yahoo's scale. Two correct mechanisms,
each blind to the other, produced a confident wrong answer; a flag is the
cheapest way to make them aware of each other.

**How to apply:** anything that changes the room's view (tab, filter,
select) must announce it, and anything that reads the view must check.
`tests/queue_test.js` tick 6 pins the contract.

## 020 — In a mock, the autopilot drafts the pick itself; the queue is only the fallback

**Rule:** on the clock, once the header's pick number is one of ours, the
autopilot clicks the room's "Draft" button on the row that carries the
recommendation's Yahoo id -- one click per pick. Autodraft is switched
back off whenever Yahoo flips it on. The queue stays reconciled as the
fallback for a click that never lands or a clock that expires.

**Why:** Yahoo moves a seat to auto-pick mode after one missed clock and
from then on drafts queue[0] the instant the turn opens. In a fast round
the queue has not settled by then, and in a snake the second pick comes
from queue[1], which was built for a different board. The user's
requirement is that the exact recommendation is drafted every time. Live
in mock 10510897, picks 34, 58 and 63 were drafted by the click; pick 39
was drafted by the first version of the click, which fired the instant
the title changed while the header still read pick 38 and the advice on
screen was for the old pool -- so the header guard is not optional.

**How to apply:** `A.DRAFT_CLICK` (default on) and `draftclick=N[last]`
in `__hcStatus()`. The overlay's list under the recommendation is the
queue plan itself, so panel and queue always read the same. The real
draft never loads the autopilot; the human clicks. `tests/queue_test.js`
tick 7 pins the header guard and the single click.

## 021 — The autopilot drafts the real draft too, behind an override window

**Rule:** in the Harvey Cup room the autopilot arms when
`localStorage.hcRealAutopilot` is `'1'`, and on each of our turns it waits
`hcDraftDelay` seconds (default 20) before clicking Draft on the
recommendation. A human click inside that window wins. Opponent seats
that have not yet burned clock are modelled as Yahoo's autodraft there
(`hcAssumeAutodraft`), because most of the league is expected not to
show up.

**Why:** the user's design is that the system drafts and the human
supervises -- "I've set up the system (you) and you are making the
picks." Draft 14 and 15 showed the click drafting fifteen and thirteen
picks exactly; leaving the real draft to the human would throw away the
mechanism that was built and tested for it. The window keeps the human
in control of any pick they disagree with, and the loader's league guard
became an opt-in flag rather than a refusal.

**How to apply:** set the flag once before Saturday; watch `window=20s`
in the footer. Mocks keep a zero window so they measure the mechanism.

## 022 — Four stat-line sources in the blend; Yahoo's number is a bias check, not a peer

**Rule:** the projection is the per-stat mean of every source that
publishes the stat -- ESPN, Sleeper, CBS and FantasySharks -- scored under
the league's rules. Yahoo's own projection, scored by Yahoo under the same
rules and read from the league's player list, then moves the result
toward itself by `sources.yahoo_bias_weight` (0.2). For kickers and
defenses, where ESPN is the only stat-line source, the weight is
`kdef_yahoo_weight` (0.5). Every source's number and the Yahoo delta are
kept on the player and shown on the pick.

**Why:** the mocks kept drafting the same names -- Kelce, Judkins, Purdy,
Sutton -- because the same board disagrees with the market in the same
places every time. More independent stat lines shrink the idiosyncratic
part of that without deferring to any one of them; the consensus test
(tools/consensus_test.py) still prefers the blend out of sample. Yahoo is
different in kind: it is the opponents' board (every autodrafting seat
draws from it) and it is scored under our rules by Yahoo, so it is the
right thing to check against and the wrong thing to average in as an
equal -- the goal is to notice when we are the outlier, not to become
Yahoo. The kicker weight is higher because the check found a fact, not an
opinion: ESPN projects the top kickers for 35 field goals a season
against Yahoo's 26, and under our rules that is the entire 30% gap.

**Rejected:** FantasyPros (its page serves ten rows without JavaScript),
NFL.com (a client app now), numberFire (moved into FanDuel). FFToday
parses but adds little beyond FantasySharks.

**How to apply:** run `bridge/yahoo_proj_scrape.js` on the league's
player list before `tools/draftday.sh` so the check is current; read
`python3 tools/bias_report.py` before the draft and decide, name by name,
whether each big disagreement is an edge or an error.

## 023 — The override window is quiet time

**Rule:** on our turn, while the override window is open, the autopilot
makes no pass at all -- no pool rebuild, no advise, no queue reconcile --
and the overlay renders the autopilot's last result instead of computing
its own. The first pass after the window closes clicks.

**Why:** the recommendation was already known before the turn opened;
recomputing it every second bought nothing and cost everything. In mock
10526391 a 20-second window with full passes underneath, on top of
Yahoo's own on-the-clock rendering, froze the renderer for 19 seconds, the
click never ran, and Yahoo's clock took two picks from the queue. Every
click into the room is a re-render (018) and so is every pass we run
while Yahoo is animating our turn.

**How to apply:** `windowSkips` counts the quiet passes in the
autopilot; `window=20s(N left)` in `__hcStatus()` shows the countdown.
The panel's "autopilot pass N" line proves it is rendering the
autopilot's result rather than its own.

## 024 — The window's end is a deadline, not a hope

**Rule:** the moment our turn opens with the override window on, the
autopilot arms a timer for the window's exact end (a blob Web Worker,
which Chrome does not throttle in a hidden tab; plain `setTimeout` if the
page's CSP refuses the worker) and that timer forces a pass, then another
every second until the click is recorded or the turn has passed.

**Why:** a pass ran only when the DOM changed or the 15 s backstop fired.
On our turn Yahoo changes almost nothing in the DOM (the clock is a text
change, which the observer ignores on purpose), so once the window closed
nothing woke the click until the backstop -- and a tab in the background
has that backstop throttled to once a minute. In mock 10603061 the click
landed with five seconds left and Yahoo answered "the pick you are trying
to make is not the current pick"; the queue had already taken the right
player, which is what the queue is for, but the click is the mechanism.
The quiet window (023) made this worse, not better: with no passes inside
the window there was nothing to notice its end.

**How to apply:** `deadline=worker/armedN/firedM` in `__hcStatus()`; a
click should now be recorded within a second of `hcDraftDelay` elapsing.
A user watching the real draft sees the click at 20 s, not at 55.

## 025 — A clock reading below the margin at the instant a turn opens is the previous turn's

**Rule:** when the override window is sized from the room's clock, a
reading at or below `CLOCK_MARGIN` in the first four seconds of our turn
is discarded and re-read on the next pass. After four seconds a low
reading is believed and the window caps to zero.

**Why:** on the second pick of a back-to-back turn the room still shows
the tail of the previous timer. In mock 10708782 that read a few seconds
at picks 27 and 51, the window collapsed to zero, and the autopilot
clicked two seconds into a turn that in fact had a full clock. Nothing
was lost -- an early click is always safe -- but the human got no override
window on those two turns, and the window is the whole point of the
human staying in the loop. Four seconds is longer than any render and
shorter than any margin we would spend.

**How to apply:** `windowFor` in the autopilot holds the window each turn
resolved to; every entry should equal the configured delay in a 60-second
room. `clockAtTurn` shows the reading it was sized from.

## 026 — Never read the Results tab with one of our picks about to open

**Rule:** the roster re-read that follows each of our picks is deferred
while our next pick is four or fewer away, and a read still running when
our turn opens is abandoned after three seconds rather than twenty.

**Why:** the read holds the Results tab for a couple of seconds and every
pass returns early while it does (019). On a back-to-back turn that is the
entire gap between our two picks: in mock 10710193 the read started after
pick 107, was still running at 110, no pass ran on that turn at all, and
Yahoo's clock took the pick from the queue. The read exists to correct a
roster count before the pick after next, so deferring it costs nothing;
running it across our own turn costs the turn.

**How to apply:** `reseeds=N/defM/toK` in `__hcStatus()` — deferrals should
appear on every back-to-back turn and timeouts should stay at zero.

## 027 — On the clock, the only reason to stop trying is that we are no longer on the clock

**Rule:** the deadline timer that forces a pass at the end of the override
window re-arms every second for as long as `upIn === 0`, and stops only
when the turn is over. It does not require the header's pick number to
match the one it was armed for.

**Why:** on a back-to-back turn the board already shows the second pick
number while we are on the clock for the first, so a check for
`st.pick === pick` failed on the very first fire and, because that path
returned instead of re-arming, the chain died and the turn ran out with no
pass at all. Mock 10711777 lost picks 60, 61, 84 and 85 to it, with the
right recommendation logged on both sides of each turn. The click path
re-derives the pick number and checks that it is ours, so the timer does
not need to know it; a timer whose job is "do not let this turn expire"
must not be the thing that gives up first.

**How to apply:** `deadline=worker/armedN/firedM` should show M close to N
across a draft, and `turnLog` records the seconds waited and the locator
used for every pick we clicked.

## 028 — Bench value is a function of depth and eligibility, and a lineup hole is a debt

**Rules** (web/advisor.js and engine/advisor.py, held together by
tests/parity_test.py):

1. Each flex slot carries its own eligibility (`FLEX_SLOTS`, parsed from the
   room). Overflow past the base slots is assigned to the flex slots that
   will take it, in the room's order, largest overflow first; what is left
   at a position is its bench. A position is "starting" only if a base slot
   or a flex slot *it is eligible for* is open.
2. The k-th bench body at a position is worth `BENCH_DISCOUNT * 0.5^k` of
   his VOR, and the discount shrinks value only: a bench player below
   replacement keeps his full deficit.
3. With as many picks left as lineup holes plus one, only hole positions
   may be drafted (must-fill).
4. A candidate at a hole position carries the expected drop at that
   position to our next pick as urgency; positions without a hole get no
   such term.
5. Candidates are the top eighty by VOR plus the best three at every usable
   position, so the last rounds rank real choices.

**Why:** the draft-morning slot study (tools/slot_sim.js, 36 drafts) found
the board drafting three tight ends by round seven and carrying two running
backs into round sixteen against a room of humans, taking its first
quarterback in round sixteen against autodrafters, and falling through to
the emergency pick on the last selection from half the slots. Each traced
to one line: every open flex slot counted as open to every flex position
(so a third tight end looked like a starter); a flat bench discount valued
a sixth receiver like a third running back; multiplying a negative VOR by
the discount made a bench player look better than a starter with a smaller
deficit; and the candidate scan stopped at eighty. After the change every
one of the 36 drafts produces RB 5, WR 6, TE 2, QB 2, K 1, DEF 1, the
average lineup in the all-human room rose 23 points, and no emergency
pick was needed. The user's instruction was explicit: the tool is built so
that it does not need to be overridden.

**How to apply:** `flexOpenFor`, `benchDepth` and `mustFill` are on the
advisor's `roster` output; the slot study is the regression test for
roster shape and should be run after any change to valuation.

## 029 — The pass loop is driven by a Worker heartbeat, not by the page

**Rule:** the autopilot's `schedule()` is called every 1.5 s from a blob
Worker (`A.heartbeat`), in addition to the DOM observer; the 15 s page
interval remains only as a fallback for a CSP that refuses blob workers.

**Why:** the observer fires on DOM changes and the page interval was the
backstop, but a turn opening on a quiet board changes almost nothing in
the DOM, and a hidden tab has page timers throttled to once a minute. In
mock 10794537 the first pass of our turn came 3, 9, 16 and 19 seconds after
it opened, the window was sized from a clock already part-run, and at
pick 79 no pass ran for thirteen seconds while Yahoo's auto-pick took the
seat -- which is also why Autodraft kept switching itself back on: to
Yahoo the seat looked unattended. The deadline timer (024) only arms once
a pass has seen the turn, so a late first pass shortened the human's
window. Chrome does not throttle Worker timers; the loop now ticks from
one whether the tab is visible or not. `schedule()` still rate-limits, so
the cost is unchanged.

**How to apply:** `heartbeat=worker/N` in `__hcStatus()`; the first pass
at our turn should now land within two seconds of the previous pick in any
tab state, and `turnLog` should read the full window at every turn.
