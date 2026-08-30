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
import opponents as opp_mod
import season as season_mod
import upside as upside_mod

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
            if team == my_slot and strategy.startswith("advisor"):
                nxt = min([p for p in vor_mod.snake_picks(my_slot) if p > overall],
                          default=overall + L.NUM_TEAMS)
                availability = None
                if "opp" in strategy:
                    # who picks between now and our next turn, and what do
                    # they already have?
                    opp = {}
                    for pk in range(overall + 1, nxt):
                        r = (pk - 1) // L.NUM_TEAMS + 1
                        i = (pk - 1) % L.NUM_TEAMS
                        slot = i + 1 if r % 2 == 1 else L.NUM_TEAMS - i
                        counts = {}
                        for pl in rosters.get(slot, []):
                            counts[pl["pos"]] = counts.get(pl["pos"], 0) + 1
                        opp[pk] = counts
                    availability = opp_mod.simulate_availability(
                        pool, overall + 1, nxt, opp,
                        num_teams=L.NUM_TEAMS, total_rounds=L.ROUNDS,
                        trials=120, seed=overall * 7 + my_slot)
                res = adv.advise(pool, rosters[team], overall, nxt, recent,
                                 availability=availability,
                                 mode=("lookahead" if "look" in strategy
                                       else "tiebreak" if "tie" in strategy
                                       else "value"))
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


STRATEGIES = ("vor", "advisor", "advisor_tie", "advisor_tie_opp")


def main(trials=30):
    players, meta = load()
    print(f"{len(players)} players with ADP\n")
    results = {}
    for strategy in STRATEGIES:
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
    for strategy in STRATEGIES:
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


# --------------------------------------------------------------- title odds
LINEUP = {
    "base": {"QB": 1, "RB": 2, "WR": 3, "TE": 1, "K": 1, "DEF": 1},
    "flex": [{"slot": "W/T", "eligible": ("WR", "TE")},
             {"slot": "W/R", "eligible": ("WR", "RB")}],
}


def _pick_by(pool, roster, rnd, key):
    """Best available by an arbitrary key, respecting roster sanity."""
    counts = {}
    for p in roster:
        counts[p["pos"]] = counts.get(p["pos"], 0) + 1
    cands = [p for p in pool
             if counts.get(p["pos"], 0) < BOT_CAP.get(p["pos"], 99)
             and not (p["pos"] in BOT_MIN_BY_ROUND
                      and rnd < BOT_MIN_BY_ROUND[p["pos"]])]
    return max(cands or pool, key=key)


def run_one_strategy(players, my_slot, rng, strategy):
    """Like run_one, but supports the upside-aware strategies."""
    if strategy in ("adp", "vor", "advisor") or strategy.startswith("advisor"):
        return run_one(players, my_slot, rng, strategy)

    pool = sorted(players, key=lambda p: p["adp"])
    rosters = {i: [] for i in range(1, L.NUM_TEAMS + 1)}
    overall = 0
    for rnd in range(1, L.ROUNDS + 1):
        order = (range(1, L.NUM_TEAMS + 1) if rnd % 2 == 1
                 else range(L.NUM_TEAMS, 0, -1))
        for team in order:
            overall += 1
            if not pool:
                break
            if team == my_slot:
                frac = overall / float(L.NUM_TEAMS * L.ROUNDS)
                if strategy == "ceiling":
                    key = lambda p: p.get("ceiling_vor", p["vor"])
                elif strategy == "floor":
                    key = lambda p: p.get("floor_vor", p["vor"])
                elif strategy == "upside_late":
                    # mean early (protect the starting lineup), variance late
                    # (a bench pick is only worth owning if it can win a week)
                    key = ((lambda p: p["vor"]) if frac < 0.45
                           else (lambda p: p.get("ceiling_vor", p["vor"])))
                elif strategy == "upside_bench":
                    # swing only where the pick is genuinely a bench flier:
                    # the last third of the draft, after the lineup is set
                    key = ((lambda p: p["vor"]) if frac < 0.68
                           else (lambda p: p.get("ceiling_vor", p["vor"])))
                elif strategy == "floor_early_ceiling_late":
                    key = ((lambda p: p.get("floor_vor", p["vor"])) if frac < 0.45
                           else (lambda p: p.get("ceiling_vor", p["vor"])))
                else:
                    key = lambda p: p["vor"]
                pick = _pick_by(pool, rosters[team], rnd, key)
            else:
                pick = bot_pick(pool, rosters[team], rnd, rng)
            pool.remove(pick)
            rosters[team].append(pick)
    return {t: 0 for t in rosters}, rosters


def title_odds_compare(strategies, drafts=12, seasons=120, sigma_frac=None,
                       learning=0.5, quiet=False):
    """Draft with each strategy, then play the actual competition.

    Season points are a proxy; this measures the thing you are buying. Each
    drafted roster plays a 14-week head-to-head schedule against the eleven
    bot teams from its own draft, top 6 make the playoffs, weeks 15-17 decide
    the title. Player weekly scores are drawn from engine/season.py.
    """
    players, _ = load()
    upside_mod.annotate(players)
    out = {}
    for strat in strategies:
        titles, playoffs, pts = [], [], []
        for d in range(drafts):
            slot = (d % L.NUM_TEAMS) + 1
            rng = random.Random(7000 + d)
            _, rosters = run_one_strategy([dict(p) for p in players], slot, rng, strat)
            # a hidden season-long multiplier per player, width set by his own
            # uncertainty -- this is what makes "upside" mean anything
            mults = {}
            mrng = random.Random(31000 + d)
            for p in players:
                sf = sigma_frac if sigma_frac is not None else p.get("sigma_frac", 0.35)
                mults[p["name"]] = max(0.05, mrng.gauss(1.0, sf))
            t, po = season_mod.title_odds(rosters, LINEUP, trials=seasons,
                                          seed=900 + d, season_mults=mults,
                                          learning=learning)
            titles.append(t[slot]); playoffs.append(po[slot])
            pts.append(best_lineup_points(rosters[slot]))
        out[strat] = (sum(titles) / len(titles), sum(playoffs) / len(playoffs),
                      sum(pts) / len(pts))
        if not quiet:
            print(f"  {strat:<26} title={out[strat][0]*100:5.1f}%  "
                  f"playoffs={out[strat][1]*100:5.1f}%  projpts={out[strat][2]:7.0f}")
    return out
