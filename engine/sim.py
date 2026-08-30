"""Offline draft simulator -- the only way to check the advisor before Sep 5.

We cannot observe the advisor's quality from a unit test: "the code runs" is
not "the roster is good". So we run the real advisor against 11 bots that
draft the way a Yahoo league actually drafts (ADP order with noise, plus
positional-need constraints so nobody ends up with five quarterbacks), and
score the resulting starting lineups against each other.

The comparison is deliberately harsh: the bots use the SAME market ADP that
the advisor gets to see, so any edge comes from valuation and timing, not
from information the opponents lack.
"""
import json, os, random, statistics, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import league as L
import advisor as adv
import vor as vor_mod

DATA = os.path.join(os.path.dirname(HERE), "data", "players.json")

BOT_CAP = {"QB": 2, "RB": 6, "WR": 6, "TE": 2, "K": 1, "DEF": 1}
BOT_MIN_BY_ROUND = {"K": 15, "DEF": 15}


def load():
    with open(DATA) as f:
        d = json.load(f)
    return [p for p in d["players"] if p.get("adp")], d["meta"]


def best_lineup_points(roster):
    """Score the optimal legal Harvey Cup starting lineup from a roster."""
    by = {}
    for p in roster:
        by.setdefault(p["pos"], []).append(p)
    for k in by:
        by[k].sort(key=lambda p: -p["points"])
    used, total = set(), 0.0

    def take(pos, n):
        nonlocal total
        got = 0
        for p in by.get(pos, []):
            if got >= n:
                break
            if id(p) in used:
                continue
            used.add(id(p)); total += p["points"]; got += 1

    take("QB", 1); take("RB", 2); take("WR", 3); take("TE", 1)
    take("K", 1); take("DEF", 1)
    # W/T then W/R from whatever is left
    for eligible in (("WR", "TE"), ("WR", "RB")):
        pool = [p for pos in eligible for p in by.get(pos, []) if id(p) not in used]
        if pool:
            b = max(pool, key=lambda p: p["points"])
            used.add(id(b)); total += b["points"]
    return total


def bot_pick(pool, roster, rnd, rng, noise=6.0):
    counts = {}
    for p in roster:
        counts[p["pos"]] = counts.get(p["pos"], 0) + 1
    cands = []
    for p in pool[:60]:
        pos = p["pos"]
        if counts.get(pos, 0) >= BOT_CAP.get(pos, 99):
            continue
        if pos in BOT_MIN_BY_ROUND and rnd < BOT_MIN_BY_ROUND[pos]:
            continue
        cands.append(p)
    if not cands:
        cands = pool[:20]
    # noisy ADP order == how humans actually draft
    return min(cands, key=lambda p: p["adp"] + rng.gauss(0, noise))


def run_one(players, my_slot, rng, strategy="advisor"):
    pool = sorted(players, key=lambda p: p["adp"])
    rosters = {i: [] for i in range(1, L.NUM_TEAMS + 1)}
    my_picks = set(vor_mod.snake_picks(my_slot))
    recent = []

    overall = 0
    for rnd in range(1, L.ROUNDS + 1):
        order = (range(1, L.NUM_TEAMS + 1) if rnd % 2 == 1
                 else range(L.NUM_TEAMS, 0, -1))
        for team in order:
            overall += 1
            if not pool:
                break
            if team == my_slot and strategy == "advisor":
                nxt = min([p for p in vor_mod.snake_picks(my_slot) if p > overall],
                          default=overall + L.NUM_TEAMS)
                res = adv.advise(pool, rosters[team], overall, nxt, recent)
                rec = res["recommendation"]
                pick = next((p for p in pool if p["name"] == rec["name"]), pool[0]) \
                    if rec else pool[0]
            elif team == my_slot and strategy == "adp":
                pick = bot_pick(pool, rosters[team], rnd, rng, noise=0.0)
            elif team == my_slot and strategy == "vor":
                counts = {}
                for p in rosters[team]:
                    counts[p["pos"]] = counts.get(p["pos"], 0) + 1
                c = [p for p in pool if counts.get(p["pos"], 0) < BOT_CAP.get(p["pos"], 99)
                     and not (p["pos"] in BOT_MIN_BY_ROUND and rnd < BOT_MIN_BY_ROUND[p["pos"]])]
                pick = max(c or pool, key=lambda p: p["vor"])
            else:
                pick = bot_pick(pool, rosters[team], rnd, rng)
            pool.remove(pick)
            rosters[team].append(pick)
            recent.append(pick["pos"])
    return {t: best_lineup_points(r) for t, r in rosters.items()}, rosters


def main(trials=30):
    players, meta = load()
    print(f"{len(players)} players with ADP\n")
    results = {}
    for strategy in ("adp", "vor", "advisor"):
        mine, ranks, opp = [], [], []
        for t in range(trials):
            rng = random.Random(1000 + t)
            slot = (t % L.NUM_TEAMS) + 1
            scores, _ = run_one([dict(p) for p in players], slot, rng, strategy)
            my = scores[slot]
            others = sorted((v for k, v in scores.items() if k != slot), reverse=True)
            mine.append(my)
            opp.append(statistics.mean(others))
            ranks.append(1 + sum(1 for v in others if v > my))
        results[strategy] = (statistics.mean(mine), statistics.mean(opp),
                             statistics.mean(ranks),
                             sum(1 for r in ranks if r == 1) / len(ranks))
        print(f"{strategy:<9} lineup={results[strategy][0]:7.1f}  "
              f"field={results[strategy][1]:7.1f}  "
              f"avg_finish={results[strategy][2]:.2f}/12  "
              f"win_rate={results[strategy][3]*100:.0f}%")
    return results


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 30)


# --------------------------------------------------------------- honesty check
def run_with_projection_error(trials=24, sigma_frac=0.30):
    """The result above is self-referential: the advisor is scored with the
    same projections it drafts on, so of course it wins. The real question is
    whether the METHOD survives being wrong.

    Here each player gets a hidden 'true' season score drawn around his
    projection (lognormal-ish multiplicative noise, sigma_frac of his mean),
    every strategy still drafts on the PROJECTION, and lineups are scored on
    TRUTH. If VOR's edge over ADP survives this, the edge is coming from
    valuation structure rather than from trusting a point estimate.
    """
    players, _ = load()
    print(f"\nprojection error test (sigma = {int(sigma_frac*100)}% of mean)")
    out = {}
    for strategy in ("adp", "vor", "advisor"):
        mine, ranks = [], []
        for t in range(trials):
            rng = random.Random(5000 + t)
            truth = {}
            ps = []
            for p in players:
                q = dict(p)
                mult = max(0.05, rng.gauss(1.0, sigma_frac))
                truth[q["name"]] = q["points"] * mult
                ps.append(q)
            slot = (t % L.NUM_TEAMS) + 1
            _, rosters = run_one(ps, slot, random.Random(9000 + t), strategy)
            scored = {}
            for team, r in rosters.items():
                tr = [dict(x, points=truth.get(x["name"], x["points"])) for x in r]
                scored[team] = best_lineup_points(tr)
            my = scored[slot]
            others = sorted((v for k, v in scored.items() if k != slot), reverse=True)
            mine.append(my)
            ranks.append(1 + sum(1 for v in others if v > my))
        out[strategy] = (statistics.mean(mine), statistics.mean(ranks),
                         sum(1 for r in ranks if r == 1) / len(ranks))
        print(f"  {strategy:<9} true_lineup={out[strategy][0]:7.1f}  "
              f"avg_finish={out[strategy][1]:.2f}/12  "
              f"win_rate={out[strategy][2]*100:.0f}%")
    return out
