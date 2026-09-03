"""FantasySharks season projections -- the fifth projection source.

FantasySharks publishes its full-season projections for every position as
one unauthenticated JSON document: completions, passing yards and TDs,
interceptions, rushing attempts/yards/TDs, receptions/yards/TDs, fumbles,
plus its own ADP and bye. Independent of ESPN, Sleeper and CBS, and in the
same per-stat vocabulary, so it joins the blend without special cases
(DECISIONS 016). No pass attempts or targets, which the blend tolerates:
each stat is averaged over the sources that publish it.

QB/RB/WR/TE only here; its kicker and defense rows are points, not lines.
"""
import json
import urllib.request

URL = "https://www.fantasysharks.com/apps/Projections/SeasonProjections.php?pos=ALL&format=json&l=12"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128 Safari/537.36")

STATS = {
    "Comp": "pass_cmp", "PassYards": "pass_yd", "PassTD": "pass_td", "Int": "pass_int",
    "Att": "rush_att", "RushYards": "rush_yd", "RushTD": "rush_td",
    "Rec": "rec", "RecYards": "rec_yd", "RecTD": "rec_td", "Fum": "fum_lost",
}

# FantasySharks team codes that differ from ours
TEAMS = {"NEP": "NE", "KCC": "KC", "GBP": "GB", "SFO": "SF", "TBB": "TB", "NOS": "NO",
         "LVR": "LV", "JAC": "JAX"}


def fetch(timeout=60):
    req = urllib.request.Request(URL, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def _num(v):
    try:
        return float(str(v).replace(",", ""))
    except (TypeError, ValueError):
        return None


def normalize(payload):
    out = []
    for row in payload:
        pos = (row.get("Pos") or "").upper()
        if pos not in ("QB", "RB", "WR", "TE"):
            continue
        raw = row.get("Name") or ""
        # "Allen, Josh" -> "Josh Allen"
        if "," in raw:
            last, first = [s.strip() for s in raw.split(",", 1)]
            name = (first + " " + last).strip()
        else:
            name = raw.strip()
        stats = {}
        for k, ck in STATS.items():
            v = _num(row.get(k))
            if v is not None:
                stats[ck] = v
        if not stats:
            continue
        team = (row.get("Team") or "FA").upper()
        out.append({
            "name": name, "pos": pos, "team": TEAMS.get(team, team),
            "sharks_id": row.get("ID"), "stats": stats,
            "sharks_pts": _num(row.get("FantasyPoints")),
            "sharks_adp": _num(row.get("ADP")), "bye": _num(row.get("Bye")),
        })
    return out


if __name__ == "__main__":
    rows = normalize(fetch())
    by = {}
    for r in rows:
        by[r["pos"]] = by.get(r["pos"], 0) + 1
    print(len(rows), by)
    for r in rows[:3]:
        print(r)
