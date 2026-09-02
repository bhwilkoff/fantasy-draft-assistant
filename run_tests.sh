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
