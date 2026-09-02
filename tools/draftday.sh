#!/usr/bin/env bash
# One command for draft day (or any day you want the board current):
#   pull -> rebuild the data plane -> run every test -> commit + push ->
#   wait for GitHub Pages to serve the new build -> print what to paste.
#
#   tools/draftday.sh            # full run
#   tools/draftday.sh --no-push  # build + test only
set -u
cd "$(dirname "$0")/.."
PAGES="https://bhwilkoff.github.io/fantasy-draft-assistant"

echo "== 1/5 pull"
git pull -q --ff-only || { echo "pull failed; resolve and re-run"; exit 1; }

echo "== 2/5 rebuild data plane (ESPN + Sleeper projections, injuries, ADP)"
python3 engine/build.py || exit 1

echo "== 3/5 tests"
./run_tests.sh > /tmp/hc_tests.log 2>&1
if ! grep -q "ALL TESTS PASS" /tmp/hc_tests.log; then
  grep -E "FAIL|MISMATCH" /tmp/hc_tests.log; echo "tests failed; see /tmp/hc_tests.log"; exit 1
fi
echo "   ALL TESTS PASS"

echo "== injuries that moved (top of the board)"
python3 tools/injury_report.py 2>/dev/null | head -25

if [ "${1:-}" = "--no-push" ]; then echo "== done (no push)"; exit 0; fi

echo "== 4/5 publish"
stamp=$(python3 -c "import json;print(json.load(open('data/meta.json'))['generated_at'])")
git add data/players.json data/meta.json
git commit -q -m "Data refresh $stamp" 2>/dev/null || echo "   (nothing new to commit)"
git push -q || { echo "push failed"; exit 1; }

echo "== 5/5 waiting for GitHub Pages to serve build $stamp"
for i in $(seq 1 60); do
  if curl -s "$PAGES/data/meta.json?v=$(date +%s)" | grep -q "$stamp"; then
    echo "   live after ${i}0s"; break
  fi
  sleep 10
done

cat <<TXT

== ready ==
Board (study / manual fallback):  $PAGES/web/
Overlay: install bridge/loader.user.js in Tampermonkey once; it self-updates.
Manual arm (paste in the draft room console if the userscript is not installed):

  window.__hcNoAutopilot=true;document.head.appendChild(Object.assign(document.createElement('script'),{src:'$PAGES/bridge/arm.js?v='+Date.now()}));

Relay for a Claude session in the loop:   python3 tools/draft_server.py
TXT
