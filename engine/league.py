"""Harvey Cup (Yahoo league 539156) — league configuration.

Scraped verbatim from the Yahoo Scoring & Settings page on 2026-08-30.
Two settings differ from the Yahoo default and both materially change value:
  * Receptions = 1.0 (Yahoo default 0.5)  -> full PPR
  * Passing TD = 6   (Yahoo default 4)    -> QBs gain ~2 pts per passing TD
"""

LEAGUE_ID = 539156
LEAGUE_NAME = "Harvey Cup"
TEAM_KEY = 7
NUM_TEAMS = 12
DRAFT_TYPE = "snake"          # "Live Standard Draft"
ROUNDS = 17
SECONDS_PER_PICK = 60
FRACTIONAL_POINTS = False     # Yahoo truncates to whole points

# Starting lineup, in Yahoo's own order.
STARTERS = {
    "QB": 1,
    "WR": 3,
    "RB": 2,
    "TE": 1,
    "W/T": 1,   # WR or TE
    "W/R": 1,   # WR or RB
    "K": 1,
    "DEF": 1,
}
BENCH = 6
ROSTER_SIZE = sum(STARTERS.values()) + BENCH   # 11 + 6 = 17

FLEX_ELIGIBILITY = {
    "W/T": ("WR", "TE"),
    "W/R": ("WR", "RB"),
}

# ---------------------------------------------------------------- scoring
OFFENSE = {
    "pass_yd": 1 / 25,
    "pass_td": 6.0,      # league override (Yahoo default 4)
    "pass_int": -1.0,
    "rush_yd": 1 / 10,
    "rush_td": 6.0,
    "rec": 1.0,          # league override (Yahoo default 0.5)
    "rec_yd": 1 / 10,
    "rec_td": 6.0,
    "ret_td": 6.0,
    "two_pt": 2.0,
    "fum_lost": -2.0,
    "off_fum_ret_td": 6.0,
}

KICKER = {
    "fg_0_19": 3.0,
    "fg_20_29": 3.0,
    "fg_30_39": 3.0,
    "fg_40_49": 4.0,
    "fg_50_plus": 5.0,
    "pat_made": 1.0,
}

DST = {
    "sack": 1.0,
    "int": 2.0,
    "fum_rec": 2.0,
    "td": 6.0,
    "safety": 4.0,       # league override (Yahoo default 2)
    "blk_kick": 2.0,
    "xp_ret": 2.0,
}

# Points-allowed tiers: (inclusive upper bound, points)
DST_POINTS_ALLOWED = [
    (0, 10.0),
    (6, 7.0),
    (13, 4.0),
    (20, 1.0),
    (27, 0.0),
    (34, -1.0),
    (10**9, -4.0),
]

REGULAR_SEASON_WEEKS = 14     # playoffs begin week 15
PLAYOFF_WEEKS = (15, 16, 17)
