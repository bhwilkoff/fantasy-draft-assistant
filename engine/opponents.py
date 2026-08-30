"""Opponent-aware availability.

The first version modelled "will he last until my next pick?" as
P(draft slot > pick) with slot ~ Normal(ADP, stdev). That treats the eleven
teams picking in front of us as a faceless average, and it is wrong in the
way that matters most: those teams have ROSTERS, and rosters create needs.

If the four teams between us and our next pick have all taken two running
backs already, the good running back on the board is far safer than his ADP
implies. If three of them still need a tight end and there is one startable
tight end left, he is gone regardless of what his ADP says.

So we simulate the intervening picks directly. Each opponent drafts by noisy
ADP but refuses positions he has already filled, exactly like the bots in
sim.py. Running that a few hundred times gives an empirical survival
probability per player that carries the roster information the closed-form
model throws away.
"""
import random

# How strictly a drafter refuses a position he has already filled. These
# mirror the bot model in sim.py, which was calibrated to look like ADP
# drafting with human noise.
DEFAULT_CAP = {"QB": 2, "RB": 6, "WR": 6, "TE": 2, "K": 1, "DEF": 1}
LATE_ONLY = {"K": 0.85, "DEF": 0.85}   # fraction of the draft that must elapse


def _eligible(pool, counts, rounds_done, total_rounds, cap):
    out = []
    for p in pool:
        pos = p["pos"]
        if counts.get(pos, 0) >= cap.get(pos, 99):
            continue
        if pos in LATE_ONLY and rounds_done < LATE_ONLY[pos] * total_rounds:
            continue
        out.append(p)
        if len(out) >= 40:
            break
    return out


def simulate_availability(pool, current_pick, target_pick, opponent_rosters,
                          num_teams=12, total_rounds=17, trials=300,
                          noise=6.0, seed=None, cap=None):
    """Empirical P(available at `target_pick`) for every player in `pool`.

    `opponent_rosters` maps the overall pick numbers between now and our next
    turn to that drafter's current position counts, e.g.
        {35: {"RB": 2, "WR": 1}, 36: {...}}
    Missing entries are treated as an empty roster, which is the safe default
    (an empty roster refuses nothing, so survival is under-estimated rather
    than over-estimated).
    """
    cap = cap or DEFAULT_CAP
    rng = random.Random(seed)
    picks_between = [p for p in range(current_pick, target_pick)]
    if not picks_between:
        return {p["name"]: 1.0 for p in pool}

    ranked = sorted([p for p in pool if p.get("adp")], key=lambda p: p["adp"])
    no_adp = [p for p in pool if not p.get("adp")]
    survived = {p["name"]: 0 for p in pool}
    for p in no_adp:
        survived[p["name"]] = trials      # unranked players are never targeted

    for _ in range(trials):
        taken = set()
        counts_by_pick = {k: dict(v) for k, v in (opponent_rosters or {}).items()}
        for pk in picks_between:
            counts = counts_by_pick.get(pk, {})
            rounds_done = (pk - 1) // num_teams
            avail = [p for p in ranked if p["name"] not in taken]
            elig = _eligible(avail, counts, rounds_done, total_rounds, cap)
            if not elig:
                elig = avail[:20]
            if not elig:
                break
            pick = min(elig, key=lambda p: p["adp"] + rng.gauss(0, noise))
            taken.add(pick["name"])
        for p in ranked:
            if p["name"] not in taken:
                survived[p["name"]] += 1

    return {k: v / float(trials) for k, v in survived.items()}


def infer_opponent_rosters(pick_log, num_teams, current_pick, target_pick,
                           draft_slot=None):
    """From an observed pick log, build {overall_pick: position counts} for the
    picks between now and our next turn.

    `pick_log` is a list of {"pick": int, "team": str, "pos": str}.
    """
    by_team = {}
    for entry in pick_log:
        t = entry.get("team")
        if t is None:
            continue
        by_team.setdefault(t, {})
        pos = entry.get("pos")
        if pos:
            by_team[t][pos] = by_team[t].get(pos, 0) + 1

    # who owns each upcoming pick, in snake order
    def owner(overall):
        rnd = (overall - 1) // num_teams + 1
        idx = (overall - 1) % num_teams
        slot = idx + 1 if rnd % 2 == 1 else num_teams - idx
        return slot

    slot_team = {}
    for entry in pick_log:
        if entry.get("pick") and entry.get("team"):
            slot_team[owner(entry["pick"])] = entry["team"]

    out = {}
    for pk in range(current_pick, target_pick):
        team = slot_team.get(owner(pk))
        out[pk] = dict(by_team.get(team, {}))
    return out
