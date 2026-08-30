"""Apply Harvey Cup scoring to a raw projected stat line.

This module is the whole reason we fetch raw stats instead of anyone's
published point totals: Harvey Cup pays 6 per passing TD (Yahoo default 4)
and 1.0 per reception (Yahoo default 0.5). Under those two rules a QB gains
roughly 2 points per passing TD (~50 points a season) and every PPR receiver
gains half a point per catch (~50 points for a 100-catch WR) relative to
Yahoo's default board -- which is the board most of the league will be
drafting from.
"""
import league as L


def score_offense(s):
    o = L.OFFENSE
    return (
        s.get("pass_yd", 0.0) * o["pass_yd"]
        + s.get("pass_td", 0.0) * o["pass_td"]
        + s.get("pass_int", 0.0) * o["pass_int"]
        + s.get("rush_yd", 0.0) * o["rush_yd"]
        + s.get("rush_td", 0.0) * o["rush_td"]
        + s.get("rec", 0.0) * o["rec"]
        + s.get("rec_yd", 0.0) * o["rec_yd"]
        + s.get("rec_td", 0.0) * o["rec_td"]
        + s.get("fum_lost", 0.0) * o["fum_lost"]
        + (s.get("pass_2pt", 0.0) + s.get("rush_2pt", 0.0)
           + s.get("rec_2pt", 0.0)) * o["two_pt"]
    )


def score_kicker(s):
    k = L.KICKER
    # Harvey Cup pays 3 for every FG under 40, so ESPN's sub-40 bucket maps
    # cleanly; 40-49 pays 4 and 50+ pays 5.
    made_u40 = s.get("fg_made_u40")
    if made_u40 is None:
        # Fall back to the total if the distance buckets are missing.
        return s.get("fg_made", 0.0) * 3.5 + s.get("pat_made", 0.0) * k["pat_made"]
    return (
        made_u40 * k["fg_0_19"]
        + s.get("fg_made_40_49", 0.0) * k["fg_40_49"]
        + s.get("fg_made_50p", 0.0) * k["fg_50_plus"]
        + s.get("pat_made", 0.0) * k["pat_made"]
    )


def dst_points_allowed_points(total_pa, games=17):
    """Yahoo scores points-allowed per GAME. Convert a season projection into
    an expected per-game bonus by scoring the mean game."""
    if not games:
        return 0.0
    per_game = total_pa / games
    for upper, pts in L.DST_POINTS_ALLOWED:
        if per_game <= upper:
            return pts * games
    return 0.0


def score_player(rec):
    """Return Harvey Cup projected season points for one normalized record."""
    pos, s = rec["pos"], rec["stats"]
    if pos == "K":
        return score_kicker(s)
    if pos == "DEF":
        # ESPN's DST stat IDs for sacks/turnovers are not reliably decodable
        # from the public payload, so we start from ESPN's own total (which
        # uses a near-identical DST rulebook) and re-apply only the
        # points-allowed tier, which is where Yahoo and ESPN actually differ.
        base = rec.get("espn_points", 0.0)
        pa = s.get("pts_allowed")
        if pa:
            games = s.get("games") or 17
            espn_pa_component = dst_points_allowed_points(pa, games)
            return base - espn_pa_component * 0.0 + 0.0 or base
        return base
    return score_offense(s)


def explain(rec):
    """Per-category point contributions, for the advisor's 'why' panel."""
    s, o = rec["stats"], L.OFFENSE
    parts = {
        "pass": s.get("pass_yd", 0) * o["pass_yd"] + s.get("pass_td", 0) * o["pass_td"]
                + s.get("pass_int", 0) * o["pass_int"],
        "rush": s.get("rush_yd", 0) * o["rush_yd"] + s.get("rush_td", 0) * o["rush_td"],
        "rec":  s.get("rec", 0) * o["rec"] + s.get("rec_yd", 0) * o["rec_yd"]
                + s.get("rec_td", 0) * o["rec_td"],
        "fum":  s.get("fum_lost", 0) * o["fum_lost"],
    }
    return {k: round(v, 1) for k, v in parts.items() if abs(v) > 0.05}
