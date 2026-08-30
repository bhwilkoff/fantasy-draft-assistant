"""Golden parity test: engine/advisor.py and web/advisor.js must agree.

The advisor exists twice -- Python for simulation and backtesting, JavaScript
so the in-room overlay can answer inside a 60-second pick clock without a
network hop. Two implementations of the same maths is a standing invitation
for them to drift, and drift here is invisible: both sides keep producing
plausible-looking advice while recommending different players.

So we run BOTH on the same fixtures and diff the actual numbers.
"""
import json, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "engine"))
import advisor  # noqa: E402

DATA = os.path.join(ROOT, "data", "players.json")

# (current_pick, next_pick, roster as [(name,pos)])
CASES = [
    (10, 15, []),
    (15, 34, [("Jahmyr Gibbs", "RB")]),
    (34, 39, [("Jahmyr Gibbs", "RB"), ("Puka Nacua", "WR")]),
    (58, 63, [("Jahmyr Gibbs", "RB"), ("Puka Nacua", "WR"),
              ("Trey McBride", "TE"), ("Josh Allen", "QB")]),
    (100, 105, [("Jahmyr Gibbs", "RB"), ("Puka Nacua", "WR"),
                ("Trey McBride", "TE"), ("Josh Allen", "QB"),
                ("Breece Hall", "RB"), ("Rashee Rice", "WR"),
                ("Garrett Wilson", "WR")]),
]

JS_RUNNER = r"""
global.window = global;
require(process.argv[2]);
const data = require(process.argv[3]);
const cases = JSON.parse(process.argv[4]);
const out = cases.map(c => {
  const drafted = new Set(c.roster.map(r => r[0]));
  const avail = data.players.filter(p => p.adp && !drafted.has(p.name));
  const roster = c.roster.map(r => ({ name: r[0], pos: r[1] }));
  const res = HarveyCup.advise(avail, roster, c.current, c.next, []);
  return {
    target: res.target_position,
    rec: res.recommendation ? res.recommendation.name : null,
    score: res.recommendation ? res.recommendation.score : null,
    alts: res.alternatives.map(a => a.name),
    view: res.position_view
  };
});
console.log(JSON.stringify(out));
"""


def run():
    with open(DATA) as f:
        data = json.load(f)

    cases_json = json.dumps([
        {"current": c, "next": n, "roster": r} for c, n, r in CASES
    ])
    runner = os.path.join(ROOT, "tests", "_runner.js")
    with open(runner, "w") as f:
        f.write(JS_RUNNER)
    js_raw = subprocess.run(
        ["node", runner, os.path.join(ROOT, "web", "advisor.js"), DATA, cases_json],
        capture_output=True, text=True, check=True).stdout
    js_out = json.loads(js_raw)
    os.remove(runner)

    failures = 0
    for i, (cur, nxt, roster) in enumerate(CASES):
        drafted = {n for n, _ in roster}
        avail = [p for p in data["players"] if p.get("adp") and p["name"] not in drafted]
        py = advisor.advise(avail, [{"name": n, "pos": p} for n, p in roster],
                            cur, nxt, [])
        js = js_out[i]

        checks = [
            ("target_position", py["target_position"], js["target"]),
            ("recommendation",
             py["recommendation"]["name"] if py["recommendation"] else None,
             js["rec"]),
            ("score",
             round(py["recommendation"]["score"], 2) if py["recommendation"] else None,
             round(js["score"], 2) if js["score"] is not None else None),
            ("alternatives", [a["name"] for a in py["alternatives"]], js["alts"]),
        ]
        for pos, v in py["position_view"].items():
            jv = js["view"].get(pos, {})
            checks.append((f"{pos}.dropoff", round(v["dropoff"], 1),
                           round(jv.get("dropoff", -999), 1)))
            checks.append((f"{pos}.later", round(v["expected_best_later"], 1),
                           round(jv.get("expected_best_later", -999), 1)))

        bad = [(w, a, b) for w, a, b in checks if a != b]
        status = "ok" if not bad else "FAIL"
        print(f"case {i} pick {cur}->{nxt} roster={len(roster)}: {status}")
        for w, a, b in bad:
            print(f"    {w}: python={a!r}  js={b!r}")
            failures += 1
    print("\nPARITY OK" if not failures else f"\n{failures} MISMATCHES")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(run())
