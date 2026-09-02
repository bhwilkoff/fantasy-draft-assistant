"""Sleeper season projections -- the second projection source.

One source is not a projection, it is an opinion. The first mock in which the
room actually took our advice pick for pick (10427900) finished last under
Yahoo's projections and 11th under ESPN's own: every starter we drafted was a
player ESPN rated well above everyone else, which is exactly where ESPN is
most likely wrong. A consensus damps that. Sleeper publishes full-season raw
stat lines, unauthenticated, in the same shape as ESPN's.

Kicker and defense lines are partial (no sub-40 field-goal bucket, no
points-allowed tiers), so only QB/RB/WR/TE are used from here.
"""
import json, urllib.request

URL = ("https://api.sleeper.com/projections/nfl/2026?season_type=regular"
       "&position[]=QB&position[]=RB&position[]=WR&position[]=TE&order_by=pts_ppr")

# Sleeper key -> our canonical key (same vocabulary as sources/espn.py)
STATS = {
    "pass_att": "pass_att", "pass_cmp": "pass_cmp", "pass_yd": "pass_yd",
    "pass_td": "pass_td", "pass_int": "pass_int", "pass_2pt": "pass_2pt",
    "rush_att": "rush_att", "rush_yd": "rush_yd", "rush_td": "rush_td",
    "rush_2pt": "rush_2pt",
    "rec": "rec", "rec_yd": "rec_yd", "rec_td": "rec_td", "rec_2pt": "rec_2pt",
    "fum_lost": "fum_lost", "gp": "games",
}


def fetch(timeout=60):
    req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def normalize(payload):
    out = []
    for row in payload:
        p = row.get("player") or {}
        s = row.get("stats") or {}
        pos = p.get("position")
        if pos not in ("QB", "RB", "WR", "TE"):
            continue
        if not s.get("pts_ppr"):
            continue
        stats = {}
        for k, v in s.items():
            ck = STATS.get(k)
            if ck is not None and isinstance(v, (int, float)):
                stats[ck] = float(v)
        out.append({
            "name": ((p.get("first_name") or "") + " " + (p.get("last_name") or "")).strip(),
            "pos": pos,
            "team": row.get("team") or p.get("team") or "FA",
            "sleeper_id": row.get("player_id") or p.get("player_id"),
            "stats": stats,
            "sleeper_pts_ppr": s.get("pts_ppr"),
        })
    return out
