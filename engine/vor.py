"""Value Over Replacement, tiers, and availability math for Harvey Cup.

Replacement level is the only number in fantasy valuation that is genuinely
league-specific, and Harvey Cup's lineup makes the usual shortcuts wrong.
The league starts 3 WR plus a W/T and a W/R flex, so WR demand is far deeper
than the common 2WR+1FLEX build: 36 WRs are locked in as starters before a
single flex slot is filled, and both flex slots are WR-eligible.

We therefore do not hardcode "WR replacement = WR36". We simulate the league
filling its 12 lineups greedily and read the replacement level off the last
player who actually gets started.
"""
import math
import league as L

FLEX_SLOTS = tuple(L.FLEX_ELIGIBILITY.keys())   # every slot with a slash in the config, whatever its shape


def replacement_levels(players):
    """Simulate 12 lineups being filled; return {pos: replacement_points}.

    Base starters are assigned first (they are non-negotiable), then each
    flex slot is filled greedily with the best remaining flex-eligible
    player. The replacement level for a position is the projected score of
    the *best undrafted* player at that position once every starting slot in
    the league is full -- i.e. the first guy you could stream off waivers.
    """
    pools = {}
    for pos in ("QB", "RB", "WR", "TE", "K", "DEF"):
        pools[pos] = sorted(
            [p for p in players if p["pos"] == pos],
            key=lambda p: -p["points"],
        )
    idx = {pos: 0 for pos in pools}

    # 1. base starters
    for pos, per_team in L.STARTERS.items():
        if pos in FLEX_SLOTS:
            continue
        idx[pos] += per_team * L.NUM_TEAMS

    # 2. flex slots, interleaved across the league, filled greedily
    flex_order = []
    for _ in range(L.NUM_TEAMS):
        for slot in FLEX_SLOTS:
            flex_order.append(slot)
    for slot in flex_order:
        eligible = L.FLEX_ELIGIBILITY[slot]
        best, best_pts = None, -1e9
        for pos in eligible:
            i = idx[pos]
            if i < len(pools[pos]) and pools[pos][i]["points"] > best_pts:
                best, best_pts = pos, pools[pos][i]["points"]
        if best:
            idx[best] += 1

    levels, counts = {}, {}
    for pos, pool in pools.items():
        i = min(idx[pos], len(pool) - 1) if pool else 0
        levels[pos] = pool[i]["points"] if pool else 0.0
        counts[pos] = idx[pos]
    return levels, counts


def apply_vor(players):
    levels, counts = replacement_levels(players)
    for p in players:
        p["replacement"] = round(levels.get(p["pos"], 0.0), 2)
        p["vor"] = round(p["points"] - p["replacement"], 2)
    players.sort(key=lambda p: -p["vor"])
    for rank, p in enumerate(players, 1):
        p["vor_rank"] = rank
    return levels, counts


def assign_tiers(players, positions=("QB", "RB", "WR", "TE", "K", "DEF")):
    """Gap-based tiering within a position.

    A tier break is declared where the drop to the next player is large
    relative to the typical drop in that position's top-40 range. Tiers are
    what actually drive draft decisions: the cost of waiting is zero inside a
    tier and severe at its edge.
    """
    for pos in positions:
        pool = sorted([p for p in players if p["pos"] == pos],
                      key=lambda p: -p["points"])
        if len(pool) < 3:
            for p in pool:
                p["tier"] = 1
            continue
        head = pool[:40]
        gaps = [head[i]["points"] - head[i + 1]["points"]
                for i in range(len(head) - 1)]
        gaps_sorted = sorted(gaps)
        median = gaps_sorted[len(gaps_sorted) // 2]
        threshold = max(median * 2.0, 1.0)
        tier = 1
        for i, p in enumerate(pool):
            p["tier"] = tier
            if i < len(pool) - 1:
                drop = p["points"] - pool[i + 1]["points"]
                if drop >= threshold and i < 60:
                    tier += 1
    return players


# ------------------------------------------------------------------ availability
def _norm_cdf(z):
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))


def survival_probability(adp, stdev, pick_number):
    """P(player is still on the board at `pick_number`).

    Model: the pick at which a player comes off the board is ~Normal(adp,
    stdev). He survives to our pick if his draft slot is later than it.
    A missing stdev falls back to a scale that widens with ADP, because late
    picks are genuinely more uncertain than early ones.
    """
    if adp is None:
        return 0.5
    if not stdev or stdev <= 0:
        stdev = max(2.0, adp * 0.18)
    return 1.0 - _norm_cdf((pick_number - adp) / stdev)


def snake_picks(draft_slot, num_teams=L.NUM_TEAMS, rounds=L.ROUNDS):
    """Overall pick numbers owned by `draft_slot` in a snake draft."""
    picks = []
    for rnd in range(1, rounds + 1):
        if rnd % 2 == 1:
            picks.append((rnd - 1) * num_teams + draft_slot)
        else:
            picks.append((rnd - 1) * num_teams + (num_teams - draft_slot + 1))
    return picks
