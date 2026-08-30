#!/usr/bin/env python3
"""Grade a finished mock draft: did our board actually beat the room?

Yahoo does not tell you who drafted well, so we score it ourselves. The one
rule that makes this honest: **grade under the rules the ROOM was playing**,
not Harvey Cup's. A mock runs Yahoo defaults (half PPR, 4-point passing TDs,
2WR + one W/R/T flex). Scoring those rosters under Harvey Cup's full-PPR,
6-point-TD, 3WR+2flex lineup would flatter us for optimising a game nobody
in that room was playing.

Each team's score is its best legal STARTING LINEUP, because bench points are
not points. Input is the JSON the browser harvester produces:

    {"teams": {"Team Name": [{"name":..,"pos":..,"team":..}, ...], ...},
     "me": "Team Name", "roster": "QB,WR,WR,RB,RB,TE,W/R/T,K,DEF",
     "numTeams": 14}
"""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "engine"))
sys.path.insert(0, os.path.join(ROOT, "engine", "sources"))
import names  # noqa: E402

YAHOO_DEFAULT = {
    "pass_yd": 1 / 25, "pass_td": 4, "pass_int": -1,
    "rush_yd": 1 / 10, "rush_td": 6,
    "rec": 0.5, "rec_yd": 1 / 10, "rec_td": 6,
    "two_pt": 2, "fum_lost": -2,
}
HARVEY_CUP = dict(YAHOO_DEFAULT, pass_td=6, rec=1.0)


def score_stats(stats, pos, rules, espn_points=0.0):
    if pos in ("K", "DEF"):
        return espn_points
    return (stats.get("pass_yd", 0) * rules["pass_yd"]
            + stats.get("pass_td", 0) * rules["pass_td"]
            + stats.get("pass_int", 0) * rules["pass_int"]
            + stats.get("rush_yd", 0) * rules["rush_yd"]
            + stats.get("rush_td", 0) * rules["rush_td"]
            + stats.get("rec", 0) * rules["rec"]
            + stats.get("rec_yd", 0) * rules["rec_yd"]
            + stats.get("rec_td", 0) * rules["rec_td"]
            + stats.get("fum_lost", 0) * rules["fum_lost"]
            + (stats.get("pass_2pt", 0) + stats.get("rush_2pt", 0)
               + stats.get("rec_2pt", 0)) * rules["two_pt"])


def parse_roster(text):
    base = {"QB": 0, "RB": 0, "WR": 0, "TE": 0, "K": 0, "DEF": 0}
    flex, bench = [], 0
    for raw in (text or "").split(","):
        t = raw.strip().upper().replace(" ", "")
        if not t:
            continue
        if t in ("BN", "BENCH"):
            bench += 1; continue
        if t in ("IR", "IR+"):
            continue
        if t in ("D/ST", "DST", "DEF"):
            base["DEF"] += 1; continue
        if t in base:
            base[t] += 1; continue
        if "/" in t:
            elig = []
            for part in t.split("/"):
                elig.append({"W": "WR", "R": "RB", "T": "TE", "Q": "QB"}.get(part, part))
            elig = [e for e in elig if e in base]
            if elig:
                flex.append(elig)
    return base, flex


def best_lineup(roster, base, flex):
    by = {}
    for p in roster:
        by.setdefault(p["pos"], []).append(p)
    for k in by:
        by[k].sort(key=lambda p: -p["_pts"])
    used, total, starters = set(), 0.0, []
    for pos, n in base.items():
        got = 0
        for p in by.get(pos, []):
            if got >= n:
                break
            if id(p) in used:
                continue
            used.add(id(p)); total += p["_pts"]; starters.append(p); got += 1
    for elig in flex:
        pool = [p for pos in elig for p in by.get(pos, []) if id(p) not in used]
        if pool:
            b = max(pool, key=lambda p: p["_pts"])
            used.add(id(b)); total += b["_pts"]; starters.append(b)
    return total, starters


def load_projections():
    with open(os.path.join(ROOT, "data", "players.json")) as f:
        players = json.load(f)["players"]
    idx = {}
    for p in players:
        idx.setdefault(names.initial_key(p["name"], p["pos"], p["team"]), []).append(p)
    return players, idx


def resolve(idx, name, pos, team):
    bucket = idx.get(names.initial_key(name, pos, team), [])
    if not bucket:
        return None
    if len(bucket) == 1:
        return bucket[0]
    same = [p for p in bucket
            if names.clean_team(p["team"]) == names.clean_team(team)]
    if len(same) == 1:
        return same[0]
    return max(same or bucket, key=lambda p: p.get("vor", 0))


def grade(payload, rules_name="room"):
    rules = YAHOO_DEFAULT if rules_name == "room" else HARVEY_CUP
    base, flex = parse_roster(payload.get("roster")
                              or "QB,WR,WR,RB,RB,TE,W/R/T,K,DEF")
    _, idx = load_projections()

    results, unresolved = [], []
    for team, picks in payload["teams"].items():
        roster = []
        for pk in picks:
            m = resolve(idx, pk["name"], pk["pos"], pk.get("team"))
            if not m:
                unresolved.append(f"{pk['name']} ({pk['pos']})")
                continue
            q = dict(m)
            q["_pts"] = score_stats(q.get("stats", {}), q["pos"], rules,
                                    q.get("espn_points", 0.0)) * q.get("injury_factor", 1)
            roster.append(q)
        total, starters = best_lineup(roster, base, flex)
        results.append({"team": team, "starters_points": total,
                        "n_picks": len(picks), "n_resolved": len(roster),
                        "lineup": [(s["name"], s["pos"], round(s["_pts"])) for s in starters]})

    results.sort(key=lambda r: -r["starters_points"])
    for i, r in enumerate(results, 1):
        r["rank"] = i
    return results, unresolved


def main(path, rules_name="room"):
    with open(path) as f:
        payload = json.load(f)
    results, unresolved = grade(payload, rules_name)
    me = payload.get("me")
    lineup = payload.get("roster")
    print(f"room: {payload.get('room','?')}   teams: {len(results)}   "
          f"lineup: {lineup}")
    label = "the room's" if rules_name == "room" else "Harvey Cup"
    print(f"graded under {label} rules\n")
    print(f"{'rank':>4}  {'team':<26} {'starting lineup pts':>20}")
    print("-" * 56)
    for r in results:
        mark = "  <== us" if r["team"] == me else ""
        print(f"{r['rank']:>4}  {r['team'][:25]:<26} {r['starters_points']:>20.1f}{mark}")
    if unresolved:
        print(f"\n{len(unresolved)} picks unresolved (deep bench, no projection): "
              + ", ".join(unresolved[:8]))
    mine = next((r for r in results if r["team"] == me), None)
    if mine:
        print(f"\nOUR FINISH: {mine['rank']} of {len(results)}")
        print("our starting lineup:")
        for n, p, pts in mine["lineup"]:
            print(f"   {p:<4} {n[:26]:<28} {pts:>5}")
    return 0 if (mine and mine["rank"] == 1) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1],
                  sys.argv[2] if len(sys.argv) > 2 else "room"))
