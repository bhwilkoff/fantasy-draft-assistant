/* A drafted roster must be able to field a LEGAL starting lineup.
 *
 * Draft 2 finished dead last of fourteen with no kicker and no defense --
 * two starting slots scoring zero. Nothing errored: ROSTER_SIZE was frozen at
 * Harvey Cup's 17 while the room had 15 slots, so every "picks remaining"
 * gate mis-fired and the one that finally allows K/DEF never opened.
 *
 * This test drafts a full roster under each ruleset we actually meet and
 * asserts the lineup is fillable. It is the cheapest possible guard against
 * a class of bug that costs two hours to discover in a live room.
 */
global.window = global;
require('../web/league.js');
require('../web/advisor.js');
const data = require('../data/players.json');

const BOT_CAP = { QB: 2, RB: 6, WR: 6, TE: 2, K: 1, DEF: 1 };

function draft(rosterText, numTeams, mySlot) {
  const roster = HarveyLeague.parseRoster(rosterText);
  const size = HarveyCup.rosterSizeFrom(roster);
  HarveyCup.setRosterSize(size);
  const players = JSON.parse(JSON.stringify(data.players));
  HarveyLeague.applyLeague(players, {
    roster, scoring: HarveyLeague.SCORING_PRESETS.yahoo_default, numTeams
  });
  let pool = players.filter(p => p.adp).sort((a, b) => a.adp - b.adp);
  const mine = [], others = {};
  let overall = 0;
  for (let r = 1; r <= size; r++) {
    const order = r % 2 === 1
      ? [...Array(numTeams).keys()].map(i => i + 1)
      : [...Array(numTeams).keys()].map(i => numTeams - i);
    for (const t of order) {
      overall++;
      if (!pool.length) break;
      let pick;
      if (t === mySlot) {
        const nxt = overall + (r % 2 === 1 ? 2 * (numTeams - mySlot) + 1 : 2 * mySlot - 1);
        const res = HarveyCup.advise(pool, mine, overall, nxt, []);
        pick = res.recommendation ? pool.find(p => p.name === res.recommendation.name) : pool[0];
        mine.push(pick);
      } else {
        const c = others[t] = others[t] || {};
        pick = pool.find(p => (c[p.pos] || 0) < (BOT_CAP[p.pos] || 9)) || pool[0];
        c[pick.pos] = (c[pick.pos] || 0) + 1;
      }
      pool = pool.filter(p => p !== pick);
    }
  }
  return { mine, roster, size };
}

/* Can this roster fill every starting slot, base and flex? */
function lineupIsLegal(mine, roster) {
  const by = {};
  mine.forEach(p => { (by[p.pos] = by[p.pos] || []).push(p); });
  const used = new Set();
  const missing = [];
  Object.keys(roster.base).forEach(pos => {
    for (let i = 0; i < roster.base[pos]; i++) {
      const p = (by[pos] || []).find(x => !used.has(x));
      if (p) used.add(p); else missing.push(pos);
    }
  });
  roster.flex.forEach(f => {
    const p = f.eligible.flatMap(pos => by[pos] || []).find(x => !used.has(x));
    if (p) used.add(p); else missing.push(f.slot);
  });
  return missing;
}

const CASES = [
  ['Yahoo mock 14-team', 'QB,WR,WR,RB,RB,TE,W/R/T,K,DEF,BN,BN,BN,BN,BN,BN', 14, 7, 15],
  ['Yahoo mock 12-team', 'QB,WR,WR,RB,RB,TE,W/R/T,K,DEF,BN,BN,BN,BN,BN,BN', 12, 1, 15],
  ['Harvey Cup', 'QB,WR,WR,WR,RB,RB,TE,W/T,W/R,K,DEF,BN,BN,BN,BN,BN,BN', 12, 7, 17],
];

let fails = 0;
CASES.forEach(([label, text, teams, slot, wantSize]) => {
  const { mine, roster, size } = draft(text, teams, slot);
  const counts = {};
  mine.forEach(p => { counts[p.pos] = (counts[p.pos] || 0) + 1; });
  const missing = lineupIsLegal(mine, roster);
  const sizeOk = size === wantSize;
  const picksOk = mine.length === wantSize;
  const ok = sizeOk && picksOk && missing.length === 0;
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}`);
  console.log(`        rosterSize=${size}${sizeOk ? '' : ' (want ' + wantSize + ')'}`
    + `  picks=${mine.length}  ${JSON.stringify(counts)}`);
  if (missing.length) console.log(`        UNFILLABLE SLOTS: ${missing.join(', ')}`);
});

console.log('\n' + (fails ? fails + ' FAILURES' : 'ALL ROSTER CHECKS PASS'));
process.exit(fails ? 1 : 0);
