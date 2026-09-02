"""League configuration -- loaded from config/league.json.

Every league-specific number the engine uses lives in that one JSON file:
team count, rounds, the starting lineup and its flex eligibility, bench
size, and the scoring rules for offense, kickers and team defense. Edit the
JSON to point the whole engine at a different league; nothing in code needs
to change (DECISIONS 010: anything that scales with the league is a
parameter, never a constant).

Harvey Cup (Yahoo league 539156) is the shipped configuration. Two of its
rules differ from the Yahoo default and both materially change value:
  * Receptions = 1.0 (Yahoo default 0.5)  -> full PPR
  * Passing TD = 6   (Yahoo default 4)    -> QBs gain ~2 pts per passing TD

The module keeps the same attribute names it always had (NUM_TEAMS, STARTERS,
OFFENSE, ...) so every consumer reads exactly as before.
"""
import json
import os

CONFIG_PATH = os.environ.get(
    "HC_LEAGUE_CONFIG",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                 "config", "league.json"))

with open(CONFIG_PATH) as _f:
    CONFIG = json.load(_f)

LEAGUE_ID = CONFIG["league_id"]
LEAGUE_NAME = CONFIG["league_name"]
TEAM_KEY = CONFIG.get("team_key")
NUM_TEAMS = CONFIG["num_teams"]
DRAFT_TYPE = CONFIG.get("draft_type", "snake")
ROUNDS = CONFIG["rounds"]
SECONDS_PER_PICK = CONFIG.get("seconds_per_pick", 60)
DRAFT_TIME = CONFIG.get("draft_time")
FRACTIONAL_POINTS = CONFIG.get("fractional_points", False)

# Starting lineup, in Yahoo's own order.
STARTERS = dict(CONFIG["starters"])
BENCH = CONFIG["bench"]
ROSTER_SIZE = sum(STARTERS.values()) + BENCH

FLEX_ELIGIBILITY = {k: tuple(v) for k, v in CONFIG["flex_eligibility"].items()}

# ---------------------------------------------------------------- scoring
OFFENSE = dict(CONFIG["scoring"]["offense"])
KICKER = dict(CONFIG["scoring"]["kicker"])
DST = dict(CONFIG["scoring"]["dst"])

# Points-allowed tiers: (inclusive upper bound, points)
DST_POINTS_ALLOWED = [tuple(t) for t in CONFIG["scoring"]["dst_points_allowed"]]

REGULAR_SEASON_WEEKS = CONFIG["season"]["regular_season_weeks"]
PLAYOFF_WEEKS = tuple(CONFIG["season"]["playoff_weeks"])
PLAYOFF_TEAMS = CONFIG["season"].get("playoff_teams", 6)


def roster_text():
    """The lineup as the browser side spells it: 'QB,WR,WR,WR,RB,RB,TE,W/T,W/R,K,DEF,BN,...'."""
    slots = []
    for slot, n in STARTERS.items():
        slots.extend([slot] * n)
    slots.extend(["BN"] * BENCH)
    return ",".join(slots)


def scoring_preset():
    """The subset of OFFENSE the browser scorer (web/league.js) understands."""
    o = OFFENSE
    return {
        "name": LEAGUE_NAME,
        "pass_yd": o["pass_yd"], "pass_td": o["pass_td"], "pass_int": o["pass_int"],
        "rush_yd": o["rush_yd"], "rush_td": o["rush_td"],
        "rec": o["rec"], "rec_yd": o["rec_yd"], "rec_td": o["rec_td"],
        "two_pt": o["two_pt"], "fum_lost": o["fum_lost"],
    }
