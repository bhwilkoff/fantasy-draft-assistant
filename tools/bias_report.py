#!/usr/bin/env python3
"""Where is our board the outlier?  A bias check against Yahoo and the market.

Two comparisons per player, both from data/players.json:

  * vs Yahoo: our four-source blend against Yahoo's own projection scored
    under this league's rules (data/sources/yahoo_league_proj.json). A big
    positive delta means every source we use likes him more than Yahoo
    does -- the pick we will make again and again in mocks, right or wrong.
  * vs the market: our VOR rank against ADP rank. A player we rank far
    above his ADP is one we will "reach" for by the room's lights.

Neither is a verdict. The point is to read the list before the draft and
decide, name by name, whether the disagreement is an edge or an error.

    python3 tools/bias_report.py            # top 40 by points, both tables
    python3 tools/bias_report.py --pos TE   # one position
"""
import argparse
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pos", default=None)
    ap.add_argument("--top", type=int, default=200, help="consider the top N by our points")
    ap.add_argument("--n", type=int, default=25, help="rows per table")
    args = ap.parse_args()

    doc = json.load(open(os.path.join(ROOT, "data", "players.json")))
    players = [p for p in doc["players"] if not args.pos or p["pos"] == args.pos.upper()]
    players.sort(key=lambda p: -p["points"])
    top = players[:args.top]
    meta = doc["meta"].get("sources", {})
    yb = meta.get("yahoo_bias_check") or {}
    print(f"Sources: {meta.get('projections')}")
    print(f"Yahoo bias check: weight {yb.get('weight')}, {yb.get('players_checked')} players, fetched {yb.get('fetched')}")
    print()

    print(f"=== Our blend vs Yahoo (top {args.top} by points; positive = we are higher) ===")
    rows = [p for p in top if p.get("yahoo_delta") is not None]
    rows.sort(key=lambda p: -abs(p["yahoo_delta"]))
    print(f"{'player':24} {'pos':4} {'blend':>6} {'yahoo':>6} {'delta':>7} {'src':>3}  {'final':>6} {'adp':>6}")
    for p in rows[:args.n]:
        print(f"{p['name']:24} {p['pos']:4} {p['points_blend']:6.0f} {p['points_yahoo']:6.0f} "
              f"{p['yahoo_delta']*100:+6.0f}% {p['sources']:3}  {p['points']:6.0f} {str(p.get('adp') or '-'):>6}")
    unmatched = [p for p in top if p.get("yahoo_delta") is None]
    if unmatched:
        print(f"  not in Yahoo's list ({len(unmatched)}): " + ", ".join(p["name"] for p in unmatched[:15])
              + (" ..." if len(unmatched) > 15 else ""))
    print()

    print(f"=== Our VOR rank vs ADP rank (top {args.top}; positive = we rank him earlier than the market) ===")
    ranked = sorted([p for p in doc["players"] if p.get("vor") is not None], key=lambda p: -p["vor"])
    vor_rank = {p["name"]: i + 1 for i, p in enumerate(ranked)}
    rows = []
    for p in top:
        if not p.get("adp") or p["name"] not in vor_rank:
            continue
        rows.append(((p.get("adp_rank") or p["adp"]) - vor_rank[p["name"]], p))
    rows.sort(key=lambda t: -abs(t[0]))
    print(f"{'player':24} {'pos':4} {'vor#':>5} {'adp#':>5} {'gap':>5}  {'final':>6}  {'yahoo delta':>11}")
    for gap, p in rows[:args.n]:
        yd = p.get("yahoo_delta")
        print(f"{p['name']:24} {p['pos']:4} {vor_rank[p['name']]:5} {int(p.get('adp_rank') or p['adp']):5} {int(gap):+5}  {p['points']:6.0f}  "
              f"{(str(round(yd*100)) + '%') if yd is not None else '-':>11}")


if __name__ == "__main__":
    main()
