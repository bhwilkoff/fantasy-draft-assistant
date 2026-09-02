"""Live draft advisor.

The recommendation is the highest-VOR player we can still use, plus a small
bonus for filling an empty starting slot. That is deliberately boring, and it
is what survived testing.

The obvious alternative -- weigh how much a position DROPS between now and
your next pick, and take the position about to fall off a cliff -- is
implemented here and scores zero weight, because it lost. Sweeping
DROPOFF_WEIGHT against simulated projection error degraded results
monotonically (mean finish 3.13 -> 3.90 across 0.0 .. 1.0). The cause is
structural rather than statistical: VOR *already* prices positional scarcity,
since the replacement baseline is the last player at that position who gets
started league-wide. Adding a dropoff term double-counts it, and at pick 10 it
adds ~+89 to every RB and WR against +0.7 to a QB -- a systematic thumb on a
scale that was already balanced.

Two further variants were tried and also lost, and are kept only so the
experiments in sim.py stay reproducible:

    mode="lookahead"  pick the best player at the position chosen by a
                      two-pick lookahead. The formulation
                      argmax over (p,q) of now[p] + later[q] is SEPARABLE, so
                      it always picks p = argmax now[p] regardless of later --
                      mathematically vacuous. Correcting it reduces to the
                      dropoff rule above, which loses.
    mode="tiebreak"   among near-equals, prefer the player least likely to
                      last. Also lost, and worse as the band widened
                      (3.15 -> 3.65 -> 4.85 for bands of 5, 8, 15 VOR).

What the advisor still COMPUTES and SHOWS, without letting it move the pick:

    best_now(p)    VOR of the best available player at p
    best_later(p)  EXPECTED VOR of the best player at p still available at our
                   next pick, as an exact expectation over survival:

                       E[max] = sum_i VOR_i * P(i survives)
                                * prod_{j above i} (1 - P(j survives))

                   (ordered by VOR descending; survivals treated as
                   independent draws around each player's ADP)

"An RB like this will be gone but a TE like this will not" is exactly the
judgement a human should be making, so it is on screen. It just does not get
to overrule the valuation. See docs/STRATEGY.md.
"""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import league as L
import vor as vor_mod

BENCH_TARGET = {"QB": 1, "RB": 3, "WR": 3, "TE": 1, "K": 0, "DEF": 0}

# A player who would sit on the bench is worth only the fraction of his VOR
# he is likely to actually start (byes, injuries, a later flex slot). VOR over
# positional replacement is right for a starter and badly wrong for a backup:
# a second quarterback's VOR over QB12 beat every receiver's at pick 53 in a
# live mock, with a QB already rostered. Mirrored in web/advisor.js.
BENCH_DISCOUNT = {"QB": 0.2, "RB": 0.6, "WR": 0.6, "TE": 0.35, "K": 0.0, "DEF": 0.0}

# The lineup shape is a league parameter (DECISIONS 010), mirrored in
# web/advisor.js: base starters per position, how many flex slots exist, and
# which positions may fill one. Harvey Cup is the default; a room with a
# different shape calls set_lineup() -- the JS side does so from the league
# detector, so a Yahoo mock (2 WR, one W/R/T flex) no longer hands the
# starter bonus to a third receiver or caps tight ends at four.
BASE_STARTERS = {"QB": 1, "RB": 2, "WR": 3, "TE": 1, "K": 1, "DEF": 1}
NUM_FLEX = 2
FLEX_ELIGIBLE = {"WR", "RB", "TE"}


def set_lineup(starters, flex_eligibility=None):
    """starters: Yahoo-style dict {"QB":1,"WR":3,"W/T":1,...};
    flex_eligibility: {"W/T": ("WR","TE"), ...} for the slash slots."""
    global BASE_STARTERS, NUM_FLEX, FLEX_ELIGIBLE
    base = {p: 0 for p in ("QB", "RB", "WR", "TE", "K", "DEF")}
    nflex, elig = 0, set()
    for slot, n in starters.items():
        key = slot.upper().replace("D/ST", "DEF")
        if key in base:
            base[key] += n
        elif "/" in key:
            nflex += n
            for part in key.split("/"):
                elig.add({"W": "WR", "R": "RB", "T": "TE", "Q": "QB"}.get(part, part))
    if flex_eligibility:
        for slot, positions in flex_eligibility.items():
            elig.update(positions)
    BASE_STARTERS, NUM_FLEX = base, nflex
    FLEX_ELIGIBLE = {p for p in elig if p in base}

# These are not taste; they were swept in sim.py against simulated projection
# error (see docs/METHOD.md).
#
# DROPOFF_WEIGHT is deliberately ZERO, which is the opposite of what the
# "positional cliff" folklore predicts. The sweep degraded monotonically as
# the weight rose (mean finish 3.13 -> 3.90 over 0.0 .. 1.0), and the reason
# is structural rather than statistical: VOR *already* prices positional
# scarcity, because the replacement baseline is the last player at that
# position who gets started league-wide. Adding a positional dropoff term on
# top double-counts scarcity, and at pick 10 it adds ~+89 to every RB and WR
# but +0.7 to a QB -- a systematic thumb on the scale that VOR had already
# accounted for correctly.
#
# The dropoff numbers are still COMPUTED and still SHOWN, because "an RB like
# this will be gone but a TE like this will not" is exactly the judgement a
# human should be making. We just refuse to let it silently overrule the
# valuation.
DROPOFF_WEIGHT = 0.0
STARTER_BONUS = 3.0
TIEBREAK_BAND = 8.0


def roster_needs(roster):
    """How many more of each position we can still USE.

    Returns (starter_gap, total_gap). starter_gap is what we still need to
    field a legal lineup -- it is what makes late-draft K/DEF urgent and what
    stops us drafting a fourth quarterback.
    """
    counts = {p: 0 for p in ("QB", "RB", "WR", "TE", "K", "DEF")}
    for p in roster:
        if p.get("pos") in counts:
            counts[p["pos"]] += 1

    # Fill base starters first, then flex from the overflow.
    base = BASE_STARTERS
    starter_gap = {p: max(0, base[p] - counts[p]) for p in base}

    overflow = sum(max(0, counts[p] - base[p]) for p in FLEX_ELIGIBLE)
    flex_open = NUM_FLEX - min(NUM_FLEX, overflow)

    total_gap = {}
    for p in starter_gap:
        cap = base[p] + BENCH_TARGET[p]
        if p in FLEX_ELIGIBLE:
            cap += flex_open
        total_gap[p] = max(0, cap - counts[p])
    return starter_gap, total_gap, counts, flex_open


def expected_best_later(pool, pos, next_pick, limit=40, availability=None):
    """Exact E[max VOR] among players at `pos` surviving to `next_pick`.

    `availability` optionally supplies empirical survival probabilities from
    engine/opponents.py, which account for what the teams picking in front of
    us actually still need. When absent we fall back to the closed-form
    Normal(ADP, stdev) model.
    """
    cands = [p for p in pool if p["pos"] == pos][:limit]
    if not cands:
        return 0.0, None
    exp, none_so_far, top = 0.0, 1.0, None
    for c in cands:
        if availability is not None and c["name"] in availability:
            s = availability[c["name"]]
        else:
            s = vor_mod.survival_probability(c.get("adp"), c.get("adp_stdev"), next_pick)
        contrib = c["vor"] * s * none_so_far
        exp += contrib
        if top is None and s >= 0.5:
            top = c
        none_so_far *= (1.0 - s)
        if none_so_far < 1e-4:
            break
    return exp, top


def positional_run(recent_picks, window=8):
    """Count positions taken in the last `window` picks -- a run is real
    information: it both drains the position and signals the room's intent."""
    counts = {}
    for p in recent_picks[-window:]:
        counts[p] = counts.get(p, 0) + 1
    return counts


def advise(available, roster, current_pick, next_pick, recent_pick_positions=None,
           top_n=6, availability=None, mode="value", picks_remaining=None):
    """Return a ranked recommendation list plus the reasoning behind it.

    `picks_remaining` may be supplied by a caller that knows its snake slot;
    it is exact (a function of the current pick alone) where the roster
    count has twice run low and kept the K/DEF gate shut."""
    pool = sorted([p for p in available if p.get("vor") is not None],
                  key=lambda p: -p["vor"])
    starter_gap, total_gap, counts, flex_open = roster_needs(roster)

    my_picks_remaining = (picks_remaining if picks_remaining is not None
                          else max(0, L.ROSTER_SIZE - len(roster)))

    # Positions we can still use at all.
    usable = [p for p in ("QB", "RB", "WR", "TE", "K", "DEF") if total_gap[p] > 0]

    # Never spend an early pick on K/DEF: they are worth ~1 point a week over
    # the waiver alternative and there are 12 of each for 12 teams.
    # Gate opens at 4 picks left (see web/advisor.js for why).
    for p in ("K", "DEF"):
        if p in usable and my_picks_remaining > (4 if starter_gap[p] else 1):
            usable.remove(p)
    if not usable:
        usable = [p for p in ("RB", "WR", "TE", "QB") if total_gap[p] > 0] or ["WR"]

    now, later = {}, {}
    for p in usable:
        c = [x for x in pool if x["pos"] == p]
        now[p] = (c[0]["vor"], c[0]) if c else (0.0, None)
        later[p] = expected_best_later(pool, p, next_pick, availability=availability)

    # Two-pick lookahead over ordered position pairs.
    best_pair, best_val = None, -1e9
    for p in usable:
        if now[p][1] is None:
            continue
        for q in usable:
            if q == p and len([x for x in pool if x["pos"] == p]) < 2:
                continue
            val = now[p][0] + later[q][0]
            if val > best_val:
                best_val, best_pair = val, (p, q)

    target_pos = best_pair[0] if best_pair else (usable[0] if usable else "WR")

    runs = positional_run(recent_pick_positions or [])

    ranked = []
    for cand in pool[:80]:
        pos = cand["pos"]
        if total_gap.get(pos, 0) <= 0:
            continue
        if pos in ("K", "DEF") and pos not in usable:
            continue
        if availability is not None and cand["name"] in availability:
            surv = availability[cand["name"]]
        else:
            surv = vor_mod.survival_probability(cand.get("adp"),
                                                cand.get("adp_stdev"), next_pick)
        dropoff = now[pos][0] - later[pos][0] if pos in now else 0.0
        same_tier_left = sum(1 for x in pool
                             if x["pos"] == pos and x.get("tier") == cand.get("tier"))
        # Score: the player's own value, plus what we lose by not taking his
        # position now, discounted by how likely he is to come back to us.
        starts = starter_gap.get(pos, 0) > 0 or (pos in FLEX_ELIGIBLE and flex_open > 0)
        score = (cand["vor"] if starts else cand["vor"] * BENCH_DISCOUNT[pos]) \
            + DROPOFF_WEIGHT * dropoff * (1.0 - surv)
        if starter_gap.get(pos, 0) > 0:
            score += STARTER_BONUS            # a lineup hole is real value
        ranked.append({
            "name": cand["name"], "pos": pos, "team": cand.get("team"),
            "tier": cand.get("tier"), "bye": cand.get("bye"),
            "vor": cand["vor"], "points": cand["points"], "adp": cand.get("adp"),
            "edge": cand.get("edge"), "injury": cand.get("injury"),
            "survival_next": round(surv, 3),
            "position_dropoff": round(dropoff, 1),
            "tier_players_left": same_tier_left,
            "score": round(score, 2),
            "is_target_position": pos == target_pos,
        })
    if mode == "tiebreak":
        # Availability as a TIE-BREAK, never an override. Among candidates
        # within TIEBREAK_BAND VOR of the best, prefer the one least likely to
        # come back to us. This is the only use of availability that does not
        # trade away real projected points for a timing guess.
        ranked.sort(key=lambda r: -r["score"])
        if ranked:
            top = ranked[0]["score"]
            band = [r for r in ranked if top - r["score"] <= TIEBREAK_BAND]
            rest = [r for r in ranked if top - r["score"] > TIEBREAK_BAND]
            band.sort(key=lambda r: (r["survival_next"], -r["score"]))
            ranked = band + rest
    elif mode == "lookahead":
        # The true two-pick optimisation: we already chose the ordered pair of
        # positions (p_now, p_next) maximising best_now(p_now) +
        # E[best_later(p_next)], so the pick is the best player at p_now.
        # `mode="value"` instead ranks globally by VOR and treats the pair
        # result as advice for the human. Which of these is actually better is
        # an empirical question -- see engine/sim.py.
        ranked.sort(key=lambda r: (0 if r["pos"] == target_pos else 1, -r["score"]))
    else:
        ranked.sort(key=lambda r: -r["score"])

    return {
        "current_pick": current_pick,
        "next_pick": next_pick,
        "target_position": target_pos,
        "recommendation": ranked[0] if ranked else None,
        "alternatives": ranked[1:top_n],
        "position_view": {
            p: {
                "best_now": round(now[p][0], 1),
                "best_now_player": now[p][1]["name"] if now[p][1] else None,
                "expected_best_later": round(later[p][0], 1),
                "dropoff": round(now[p][0] - later[p][0], 1),
                "likely_still_there": later[p][1]["name"] if later[p][1] else None,
            } for p in usable
        },
        "roster": {"counts": counts, "starter_gap": starter_gap,
                   "total_gap": total_gap, "flex_open": flex_open,
                   "picks_remaining": my_picks_remaining},
        "recent_runs": runs,
    }
