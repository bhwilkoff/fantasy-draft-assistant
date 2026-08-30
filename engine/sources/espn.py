"""ESPN public fantasy projections.

The `leaguedefaults/3` endpoint is world-readable and returns, per player,
a full-season 2026 RAW STAT projection (statSourceId=1, statSplitTypeId=0)
plus ESPN's live ADP. Raw stats are what we need: Harvey Cup scores passing
TDs at 6 and receptions at 1.0, so any precomputed point total from any
provider is wrong for this league.

Stat-ID mapping below was verified by cross-checking the decoded lines
against FantasyPros' published projections for the same players
(Josh Allen, Jahmyr Gibbs, Puka Nacua, Brandon Aubrey) on 2026-08-30.
"""
import json, urllib.request

URL = ("https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026"
       "/segments/0/leaguedefaults/3?view=kona_player_info")

POSITIONS = {1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "DEF"}

PRO_TEAMS = {
    0: "FA", 1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL",
    7: "DEN", 8: "DET", 9: "GB", 10: "TEN", 11: "IND", 12: "KC", 13: "LV",
    14: "LAR", 15: "MIA", 16: "MIN", 17: "NE", 18: "NO", 19: "NYG",
    20: "NYJ", 21: "PHI", 22: "ARI", 23: "PIT", 24: "LAC", 25: "SF",
    26: "SEA", 27: "TB", 28: "WSH", 29: "CAR", 30: "JAX", 33: "BAL",
    34: "HOU",
}

# ESPN statId -> our canonical stat name (verified, see docstring)
STAT_IDS = {
    "0":  "pass_att",   "1":  "pass_cmp",  "3":  "pass_yd",  "4":  "pass_td",
    "19": "pass_2pt",   "20": "pass_int",
    "23": "rush_att",   "24": "rush_yd",   "25": "rush_td",  "26": "rush_2pt",
    "42": "rec_yd",     "43": "rec_td",    "44": "rec_2pt",
    "53": "rec",        "58": "targets",
    "72": "fum_lost",
    # kicker: 80 = FG made <40, 77 = FG made 40-49, 74 = FG made 50+
    "80": "fg_made_u40", "77": "fg_made_40_49", "74": "fg_made_50p",
    "83": "fg_made",     "84": "fg_att",        "86": "pat_made",
    # team defense
    "120": "pts_allowed", "127": "yds_allowed",
    "210": "games",
}


def fetch(limit=500, timeout=60):
    """Return the raw ESPN player payload."""
    req = urllib.request.Request(URL, headers={
        "User-Agent": "Mozilla/5.0",
        "x-fantasy-filter": json.dumps({"players": {
            "limit": limit,
            "sortDraftRanks": {"sortPriority": 100, "sortAsc": True,
                               "value": "PPR"},
        }}),
    })
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def _season_projection(player, season=2026):
    for st in player.get("stats", []):
        if (st.get("seasonId") == season and st.get("statSourceId") == 1
                and st.get("statSplitTypeId") == 0):
            return st
    return None


def _season_actual(player, season=2025):
    for st in player.get("stats", []):
        if (st.get("seasonId") == season and st.get("statSourceId") == 0
                and st.get("statSplitTypeId") == 0):
            return st
    return None


def normalize(payload, season=2026):
    """-> list of dicts with canonical raw stats, ESPN ADP and last-year points."""
    out = []
    for entry in payload.get("players", []):
        p = entry.get("player") or {}
        pos = POSITIONS.get(p.get("defaultPositionId"))
        if not pos:
            continue
        proj = _season_projection(p, season)
        if not proj:
            continue
        stats = {}
        for sid, val in (proj.get("stats") or {}).items():
            name = STAT_IDS.get(sid)
            if name:
                stats[name] = float(val)
        prior = _season_actual(p, season - 1)
        own = p.get("ownership") or {}
        out.append({
            "espn_id": p.get("id"),
            "name": p.get("fullName"),
            "pos": pos,
            "team": PRO_TEAMS.get(p.get("proTeamId"), "FA"),
            "stats": stats,
            "espn_points": round(float(proj.get("appliedTotal") or 0.0), 2),
            "espn_adp": (round(float(own["averageDraftPosition"]), 2)
                         if own.get("averageDraftPosition") else None),
            "espn_pct_owned": (round(float(own["percentOwned"]), 1)
                               if own.get("percentOwned") else None),
            "prior_points": (round(float(prior.get("appliedTotal") or 0.0), 2)
                             if prior else None),
            "injury_status": p.get("injuryStatus"),
        })
    return out


if __name__ == "__main__":
    data = normalize(fetch())
    print(len(data), "players")
    for d in data[:5]:
        print(d["name"], d["pos"], d["team"], d["espn_adp"], d["stats"].get("rec"))
