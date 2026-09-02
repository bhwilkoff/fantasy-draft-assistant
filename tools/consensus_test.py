"""Out-of-sample test of single-source vs consensus drafting.

Draft with board B (ESPN-only, Sleeper-only, or the blend) against ADP bots,
then score every roster with the OTHER source's projections as 'truth'.
If single-source selection bias is real, the ESPN board scored by Sleeper
(and vice versa) should finish worse than the blend scored by either.
"""
import sys, random, statistics
import os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'engine'))
import sim, vor as vor_mod, league as L

players, meta = sim.load()
base = [dict(p) for p in players if p.get('points_sleeper') is not None or p['pos'] in ('K','DEF')]

def board(src):
    ps = [dict(p) for p in base]
    for p in ps:
        if src == 'espn': p['points'] = p['points_espn']
        elif src == 'sleeper': p['points'] = p['points_sleeper'] if p.get('points_sleeper') is not None else p['points_espn']
        else: p['points'] = p['points']  # blend as built
        p['points'] = p['points'] * (p.get('injury_factor') or 1.0)
    vor_mod.apply_vor(ps); vor_mod.assign_tiers(ps)
    return ps

def truth_points(roster, src):
    def pts(p):
        v = p['points_espn'] if src == 'espn' else (p['points_sleeper'] if p.get('points_sleeper') is not None else p['points_espn'])
        return v * (p.get('injury_factor') or 1.0)
    fake = [dict(p, points=pts(p)) for p in roster]
    return sim.best_lineup_points(fake)

DRAFTS = int(sys.argv[1]) if len(sys.argv) > 1 else 24
for src in ('espn', 'sleeper', 'blend'):
    ps = board(src)
    for truth in ('espn', 'sleeper'):
        if truth == src: continue
        finishes, mine, field = [], [], []
        for d in range(DRAFTS):
            slot = (d % L.NUM_TEAMS) + 1
            rng = random.Random(5000 + d)
            _, rosters = sim.run_one([dict(p) for p in ps], slot, rng, 'advisor')
            scores = {t: truth_points(r, truth) for t, r in rosters.items()}
            my = scores[slot]; others = sorted((v for k, v in scores.items() if k != slot), reverse=True)
            finishes.append(1 + sum(1 for v in others if v > my)); mine.append(my); field.append(statistics.mean(others))
        print(f"draft on {src:7s} scored by {truth:7s}: avg finish {statistics.mean(finishes):.2f}/12  "
              f"lineup {statistics.mean(mine):.0f} vs field {statistics.mean(field):.0f}  wins {sum(1 for f in finishes if f==1)}/{DRAFTS}", flush=True)
