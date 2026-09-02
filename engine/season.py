"""Season simulator: score drafts by CHAMPIONSHIPS, not by projected points.

Every experiment up to here optimised total projected points of the starting
lineup. That is the wrong objective, and the difference is not academic.

Harvey Cup is head-to-head. You play 14 weekly matchups, six of twelve teams
make the playoffs, and the title is decided in weeks 15-17. Points win games
only through the weekly distribution: a roster that scores 130 every week and
a roster that alternates 90 and 170 have identical season totals and very
different playoff odds. And a three-week playoff is short enough that
variance is a weapon, not just a risk -- an underdog wants volatility.

So this module runs the actual competition: weekly scores drawn per player,
optimal legal lineups, a real schedule, seeding, and a bracket. Strategies are
then compared on title odds, which is the thing you are actually buying.

Weekly coefficients of variation are position-level and deliberately coarse;
what matters is their ORDER (TE and DEF swing hardest, QB least), which is
stable across every published study of weekly fantasy scoring.
"""
import math
import random

WEEKLY_CV = {"QB": 0.35, "RB": 0.55, "WR": 0.65, "TE": 0.70, "K": 0.45, "DEF": 0.75}
REG_WEEKS = 14
PLAYOFF_WEEKS = 3
PLAYOFF_TEAMS = 6


def weekly_mu(player):
    games = (player.get("stats") or {}).get("games") or 17
    return player["points"] / max(1.0, games)


def draw_week(player, rng, season_mult=1.0):
    """One weekly score. Lognormal so it is non-negative and right-skewed,
    which is how fantasy scoring actually behaves -- the upside tail is
    longer than the downside, and that tail is what wins playoff games."""
    mu = weekly_mu(player) * season_mult
    if mu <= 0:
        return 0.0
    cv = WEEKLY_CV.get(player["pos"], 0.6)
    sigma = math.sqrt(math.log(1 + cv * cv))
    return rng.lognormvariate(math.log(mu) - 0.5 * sigma * sigma, sigma)


def best_lineup_score(roster_scores, roster, lineup, rank_by=None):
    """Score this week's legal lineup.

    `rank_by` decides WHO STARTS and defaults to `roster_scores`, which is
    hindsight-optimal and badly wrong: a real manager sets a lineup on Sunday
    morning from expectations, not from that afternoon's results. Starting
    players by realised score hands every boom/bust bench player a perfect
    start/sit record and makes variance look far more valuable than it is.

    Pass `rank_by` = expected weekly points to model an honest manager: the
    lineup is chosen ex ante and scored ex post.
    """
    order = rank_by if rank_by is not None else roster_scores
    by_pos = {}
    for p in roster:
        by_pos.setdefault(p["pos"], []).append(p)
    for k in by_pos:
        by_pos[k].sort(key=lambda p: -order.get(id(p), 0.0))

    used, total = set(), 0.0
    for pos, n in lineup["base"].items():
        got = 0
        for p in by_pos.get(pos, []):
            if got >= n:
                break
            if id(p) in used:
                continue
            used.add(id(p)); total += roster_scores.get(id(p), 0.0); got += 1
    for f in lineup["flex"]:
        pool = [p for pos in f["eligible"] for p in by_pos.get(pos, [])
                if id(p) not in used]
        if pool:
            b = max(pool, key=lambda p: order.get(id(p), 0.0))
            used.add(id(b)); total += roster_scores.get(id(b), 0.0)
    return total


def round_robin(num_teams, weeks, rng):
    """A schedule where everyone plays everyone roughly equally."""
    teams = list(range(1, num_teams + 1))
    schedule = []
    for w in range(weeks):
        rot = teams[:1] + teams[1 + w % (num_teams - 1):] + teams[1:1 + w % (num_teams - 1)]
        pairs = [(rot[i], rot[num_teams - 1 - i]) for i in range(num_teams // 2)]
        schedule.append(pairs)
    return schedule


def simulate_season(rosters, lineup, rng, season_mults=None, learning=0.5):
    """-> (champion, standings) for one simulated season."""
    num_teams = len(rosters)
    schedule = round_robin(num_teams, REG_WEEKS, rng)
    wins = {t: 0 for t in rosters}
    points_for = {t: 0.0 for t in rosters}

    def week_scores(week=None):
        out = {}
        for t, roster in rosters.items():
            scores, expected = {}, {}
            for p in roster:
                mult = (season_mults or {}).get(p["name"], 1.0)
                # A player on bye scores nothing and the manager knows it.
                # Byes fall in the regular season only.
                if week is not None and p.get("bye") and int(p["bye"]) == week:
                    scores[id(p)] = 0.0
                    expected[id(p)] = -1.0
                    continue
                scores[id(p)] = draw_week(p, rng, mult)
                # What the manager knows on Sunday morning. `learning` is
                # how much of the player's true season-long quality has become
                # apparent by now: 0 = start/sit purely off preseason
                # projections all year, 1 = know exactly who broke out.
                # Reality is in between, and the answer to "is upside worth
                # drafting?" depends on it, so it is a parameter, not a
                # constant.
                expected[id(p)] = weekly_mu(p) * (1 - learning + learning * mult)
            out[t] = best_lineup_score(scores, roster, lineup, rank_by=expected)
        return out

    for week, pairs in enumerate(schedule, 1):
        sc = week_scores(week)
        for t in rosters:
            points_for[t] += sc[t]
        for a, b in pairs:
            if sc[a] >= sc[b]:
                wins[a] += 1
            else:
                wins[b] += 1

    seeds = sorted(rosters, key=lambda t: (-wins[t], -points_for[t]))[:PLAYOFF_TEAMS]

    # Weeks 15-17: top two seeds get a bye, then a bracket. Each playoff round
    # is a single week, which is exactly why variance is worth something.
    def play(a, b):
        sc = week_scores()
        return a if sc[a] >= sc[b] else b

    s = seeds
    if len(s) >= 6:
        w3 = play(s[2], s[5])
        w4 = play(s[3], s[4])
        semi1 = play(s[0], w4)
        semi2 = play(s[1], w3)
        champ = play(semi1, semi2)
    else:
        champ = s[0]
    return champ, seeds


def title_odds(rosters, lineup, trials=200, seed=0, season_mults=None,
               learning=0.5):
    rng = random.Random(seed)
    titles = {t: 0 for t in rosters}
    playoffs = {t: 0 for t in rosters}
    for _ in range(trials):
        champ, seeds = simulate_season(rosters, lineup, rng, season_mults,
                                       learning)
        titles[champ] += 1
        for t in seeds:
            playoffs[t] += 1
    return ({t: titles[t] / trials for t in titles},
            {t: playoffs[t] / trials for t in playoffs})
