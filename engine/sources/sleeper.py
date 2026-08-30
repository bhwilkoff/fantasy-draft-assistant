"""Sleeper player metadata -- our live injury feed.

ESPN's projection payload carries an `injuryStatus`, but it is coarse and
stale: it moves when ESPN rebuilds projections, not when news breaks. Sleeper
publishes the same field with a `news_updated` timestamp and an injury body
part, free and unauthenticated, and it tracks to within the hour. On draft
morning that difference is the whole game -- a back who is ruled out at 11am
should not still be the recommendation at 2pm.
"""
import json, urllib.request

URL = "https://api.sleeper.app/v1/players/nfl"

# Sleeper's vocabulary -> ours, plus the multiplier we apply to projections.
# These are deliberately blunt: they express "how much of the season do we
# expect to lose", not a medical opinion.
STATUS_FACTOR = {
    None: 1.0, "": 1.0, "Active": 1.0,
    "Questionable": 0.97,
    "Doubtful": 0.90,
    "Out": 0.85,
    "PUP": 0.55,
    "Sus": 0.80,
    "DNR": 0.50,
    "NA": 0.60,
    "IR": 0.30,
    "COV": 0.90,
}


def fetch(timeout=90):
    req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def normalize(payload):
    """-> list of dicts keyed the same way the projection sources are."""
    out = []
    for p in payload.values():
        pos = p.get("position")
        if pos not in ("QB", "RB", "WR", "TE", "K", "DEF"):
            continue
        if not p.get("active") and not p.get("injury_status"):
            continue
        out.append({
            "name": p.get("full_name") or (
                (p.get("first_name") or "") + " " + (p.get("last_name") or "")).strip(),
            "pos": pos,
            "team": p.get("team") or "FA",
            "sleeper_id": p.get("player_id"),
            "injury_status": p.get("injury_status"),
            "injury_body_part": p.get("injury_body_part"),
            "injury_notes": p.get("injury_notes"),
            "news_updated": p.get("news_updated"),
            "depth_chart_order": p.get("depth_chart_order"),
            "years_exp": p.get("years_exp"),
            "age": p.get("age"),
        })
    return out


def factor_for(status):
    return STATUS_FACTOR.get(status, 1.0)
