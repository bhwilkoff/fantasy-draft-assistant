"""Per-player season uncertainty, and what a "ceiling" is worth.

VOR ranks on a point estimate, which quietly assumes every projection is
equally trustworthy. It is not. A 27-year-old bell-cow entering his sixth
season is a narrow distribution; a rookie behind an unsettled depth chart is
a wide one with a long right tail. Those two can share a projection and be
completely different draft picks -- and which one you want depends on what
you still need from the roster.

We estimate a season-level coefficient of variation per player from the few
signals we actually have (position, experience, depth-chart role, whether the
projection is a big move off last year), then expose:

    sigma_frac  the width of his outcome distribution
    ceiling     roughly a 85th-percentile season
    floor       roughly a 15th-percentile season

Nothing here claims to know who breaks out. It claims only to know who is
UNCERTAIN, which is a much easier question and the one that matters for
deciding when to buy variance.
"""
import math

# Baseline season-level CV by position. Running backs carry injury risk and
# workload cliffs; quarterbacks are the most stable fantasy asset there is.
BASE_CV = {"QB": 0.24, "RB": 0.40, "WR": 0.36, "TE": 0.38, "K": 0.22, "DEF": 0.30}


def sigma_frac(p):
    cv = BASE_CV.get(p["pos"], 0.35)

    exp = p.get("years_exp")
    if exp is not None:
        if exp <= 0:
            cv += 0.16          # rookie: role and quality both unknown
        elif exp == 1:
            cv += 0.09          # second year: breakout or bust window
        elif exp >= 8:
            cv += 0.05          # age cliff risk

    depth = p.get("depth_chart_order")
    if depth is not None and depth > 1:
        cv += 0.10 * min(depth - 1, 2)   # not the clear starter

    # A projection that departs sharply from last season is, by construction,
    # a bet rather than an extrapolation.
    prior, proj = p.get("prior_points"), p.get("points_raw") or p.get("points")
    if prior and proj and prior > 20:
        move = abs(proj - prior) / prior
        cv += min(0.18, 0.25 * move)

    # Injury designations widen the distribution as well as lowering the mean;
    # the mean is handled by injury_factor in build.py, this is the spread.
    if (p.get("injury") or "").lower() not in ("", "active", "none"):
        cv += 0.06

    return max(0.12, min(0.85, cv))


def annotate(players):
    """Attach sigma_frac, ceiling, floor and an upside score to each player."""
    for p in players:
        s = sigma_frac(p)
        pts = p.get("points", 0.0)
        p["sigma_frac"] = round(s, 3)
        # lognormal-ish quantiles, so the ceiling tail is longer than the floor
        p["ceiling"] = round(pts * math.exp(0.95 * s), 1)
        p["floor"] = round(pts * math.exp(-0.95 * s), 1)
        p["ceiling_vor"] = round(p["ceiling"] - p.get("replacement", 0.0), 1)
        p["floor_vor"] = round(p["floor"] - p.get("replacement", 0.0), 1)
    return players
