#!/usr/bin/env python3
"""Format live draft state into a brief a Claude session can reason over.

Run this in a loop during the draft (or let a Claude Code session call it).
It turns the relay's raw state into the handful of things worth thinking
about, and deliberately leads with what the ENGINE CANNOT SEE: injury body
parts, news recency, variance width, and how far each candidate sits from the
market. Those are the inputs to a judgement call.

    python3 tools/draft_watch.py            # one brief
    python3 tools/draft_watch.py --watch    # re-print when the pick changes
"""
import datetime, json, sys, time, urllib.error, urllib.request

RELAY = "http://127.0.0.1:8830"


def get(path):
    try:
        with urllib.request.urlopen(RELAY + path, timeout=4) as r:
            return json.load(r)
    except (urllib.error.URLError, OSError, ValueError):
        return None


def age(ms):
    if not ms:
        return "-"
    hrs = (datetime.datetime.now()
           - datetime.datetime.fromtimestamp(ms / 1000)).total_seconds() / 3600
    return f"{hrs:.0f}h" if hrs < 72 else f"{hrs/24:.0f}d"


def brief(s):
    if not s or s.get("pick") is None:
        return "no draft state yet (is the overlay armed and the relay on?)"
    out = []
    lg = s.get("league") or {}
    out.append(f"PICK {s.get('pick')}  round {s.get('round')}  "
               f"you are up in {s.get('upIn')}  clock {s.get('clock') or '-'}")
    if lg:
        out.append(f"rules: {lg.get('scoring')} ({lg.get('detectedFrom')})  "
                   f"starters consumed {lg.get('counts')}")

    need = s.get("rosterNeeds") or {}
    counts = need.get("counts") or need.get("starterGap") or {}
    gaps = {k: v for k, v in (need.get("starterGap") or {}).items() if v}
    out.append(f"roster: {counts}   unfilled starting slots: {gaps or 'none'}")

    roster = s.get("roster") or []
    if roster:
        out.append("  " + ", ".join(f"{p['name']}({p['pos']})" for p in roster))

    rec = s.get("recommendation") or {}
    out.append("")
    out.append(f"ENGINE SAYS: {rec.get('name')} ({rec.get('pos')}) "
               f"vor {rec.get('vor')}  adp {rec.get('adp')}  tier {rec.get('tier')}")

    out.append("")
    out.append("CANDIDATES  (what the engine cannot interpret is on the right)")
    out.append(f"  {'player':<22} {'pos':<4} {'vor':>6} {'adp':>6} {'edge':>5} "
               f"{'back%':>6}  {'range':<14} {'flag'}")
    for c in (s.get("candidates") or [])[:8]:
        rng = (f"{c.get('floor', 0):.0f}-{c.get('ceiling', 0):.0f}"
               if c.get("ceiling") else "-")
        flag = ""
        if c.get("injury") and str(c["injury"]).lower() != "active":
            flag = f"{c['injury']}"
            if c.get("injury_body_part"):
                flag += f" / {c['injury_body_part']}"
        if (c.get("sigma_frac") or 0) > 0.55:
            flag += "  HIGH VARIANCE"
        out.append(f"  {str(c.get('name'))[:21]:<22} {str(c.get('pos')):<4} "
                   f"{c.get('vor', 0):>6.0f} {str(c.get('adp')):>6} "
                   f"{str(c.get('edge')):>5} "
                   f"{(c.get('survival_next') or 0)*100:>5.0f}%  {rng:<14} {flag}")

    pv = s.get("position_view") or {}
    if pv:
        out.append("")
        out.append("COST OF WAITING")
        for pos, v in pv.items():
            out.append(f"  {pos:<4} best now {str(v.get('best_now_player'))[:20]:<20} "
                       f"drop {v.get('dropoff'):>6}  likely later: "
                       f"{v.get('likely_still_there')}")

    out.append("")
    out.append("Your job: say whether to follow the engine, and if not, why. "
               "Under 40 words.")
    out.append("POST it: curl -s -X POST localhost:8830/note -H 'Content-Type: "
               "application/json' -d '{\"text\":\"...\",\"pick\":%s}'" % s.get("pick"))
    return "\n".join(out)


def main():
    watch = "--watch" in sys.argv
    last = None
    while True:
        s = get("/state")
        if s and s.get("pick") != last:
            last = s.get("pick")
            print("\n" + "=" * 78)
            print(brief(s))
        elif not watch:
            print(brief(s))
        if not watch:
            return
        time.sleep(5)


if __name__ == "__main__":
    main()
