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
