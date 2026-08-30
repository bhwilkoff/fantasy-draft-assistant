#!/usr/bin/env python3
"""What changed on the injury wire, ranked by how much it should matter.

Run this after engine/build.py on draft morning. It answers one question:
which draftable players have a status that moved recently, and how big a
piece of the board are they? A Questionable tag on ADP 180 is noise; the same
tag on ADP 8 changes your first two rounds.
"""
import datetime, json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main(max_adp=180):
    with open(os.path.join(ROOT, "data", "players.json")) as f:
        players = json.load(f)["players"]
    rows = [p for p in players
            if p.get("adp") and p["adp"] <= max_adp
            and (p.get("injury") or "").lower() not in ("", "active", "none")]
    rows.sort(key=lambda p: p["adp"])
    now = datetime.datetime.now()
    print(f"{len(rows)} draftable players (ADP <= {max_adp}) carrying a status\n")
    print(f"{'ADP':>6}  {'player':<24} {'pos':<4} {'status':<13} "
          f"{'body part':<16} {'x':<5} {'news age':<10}")
    print("-" * 88)
    for p in rows:
        ts = p.get("injury_news_updated")
        if ts:
            age = now - datetime.datetime.fromtimestamp(ts / 1000)
            hrs = age.total_seconds() / 3600
            age_s = f"{hrs:.0f}h" if hrs < 72 else f"{hrs/24:.0f}d"
        else:
            age_s = "-"
        print(f"{p['adp']:>6}  {p['name'][:23]:<24} {p['pos']:<4} "
              f"{str(p['injury'])[:12]:<13} {str(p.get('injury_body_part'))[:15]:<16} "
              f"{p.get('injury_factor', 1):<5} {age_s:<10}")
    print("\nA multiplier cannot tell a routine tag from a season-ender.")
    print("Read the body part, then decide. That is what Claude is for.")


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 180)
