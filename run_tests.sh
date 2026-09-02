#!/usr/bin/env bash
# Every check that guards a silent failure mode. Run before any draft.
set -u
cd "$(dirname "$0")"
fail=0

echo "=== Python <-> JS advisor parity ==="
python3 tests/parity_test.py || fail=1

echo
echo "=== Yahoo name matching ==="
( cd tests && node match_test.js ) || fail=1

echo
echo "=== queue actuator reflects the CURRENT ranking ==="
( cd tests && node queue_test.js ) || fail=1

echo
echo "=== opponent-aware availability ==="
( cd tests && node opponents_test.js ) || fail=1

echo
echo "=== drafted roster can field a legal lineup ==="
( cd tests && node roster_test.js ) || fail=1

echo
echo "=== draft-room DOM readers (fixture) ==="
( cd tests && node dom_test.js ) || fail=1

echo
echo "=== league-wide draft report ==="
( cd tests && node report_test.js ) || fail=1

echo
echo "=== league config round-trips into the data plane ==="
python3 - <<'PY' || fail=1
import json, sys
sys.path.insert(0, 'engine')
import league as L
meta = json.load(open('data/meta.json'))['league']
cfg = json.load(open('config/league.json'))
ok = True
def check(label, a, b):
    global ok
    good = a == b
    ok = ok and good
    print(f"  {'ok  ' if good else 'FAIL'}  {label} = {a!r}" + ('' if good else f"  (data plane has {b!r})"))
check('teams', cfg['num_teams'], meta['teams'])
check('rounds', cfg['rounds'], meta['rounds'])
check('roster size', sum(cfg['starters'].values()) + cfg['bench'], meta['roster_size'])
check('roster text', L.roster_text(), meta['roster_text'])
check('ppr in browser preset', cfg['scoring']['offense']['rec'], meta['scoring']['rec'])
check('pass td in browser preset', cfg['scoring']['offense']['pass_td'], meta['scoring']['pass_td'])
print('  CONFIG OK' if ok else '  CONFIG MISMATCH -- run engine/build.py')
sys.exit(0 if ok else 1)
PY

echo
echo "=== syntax ==="
node --check web/advisor.js && node --check web/app.js \
  && node --check bridge/yahoo-draft-bridge.user.js && node --check bridge/autopilot.js && node --check bridge/opponents.js \
  && echo "  js ok" || fail=1
python3 -c "import ast,sys
for f in ['engine/league.py','engine/scoring.py','engine/vor.py','engine/advisor.py','engine/build.py','engine/sim.py','engine/names.py','engine/sources/espn.py','engine/sources/ffc.py']:
    ast.parse(open(f).read())
print('  python ok')" || fail=1

echo
if [ "$fail" -eq 0 ]; then echo "ALL TESTS PASS"; else echo "FAILURES"; fi
exit $fail
