/* Draft the Harvey Cup from every slot with the SAME advisor the browser
 * runs, against rooms of three kinds, and grade every roster by the best
 * legal lineup it can field under the league's own scoring.
 *
 *   node tools/slot_sim.js            # all slots, all room types
 *   node tools/slot_sim.js 7 yahoo    # one slot, one room type, verbose
 *
 * Room types (who the other eleven seats are):
 *   adp    -- humans drafting by market ADP with loose position caps
 *   yahoo  -- Yahoo's autodraft: best remaining by Yahoo's own projection,
 *             starters first, K/DEF only once the other starters are full
 *   mixed  -- eight autodrafters and three ADP humans, which is what the
 *             Harvey Cup room is expected to look like (most managers idle)
 *
 * The point is not the finishing place against bots -- it is to see the
 * SAME roster shape from every seat, catch an unfilled starter, a position
 * over its cap, a kicker in round nine, a recommendation the advisor could
 * not make, and to compare slots on the one number that matters: the
 * points the starting lineup projects to.
 */
'use strict';
global.window = global;
require('../web/league.js');
require('../web/advisor.js');
const data = require('../data/players.json');

const ROSTER_TEXT = 'QB,WR,WR,WR,RB,RB,TE,W/T,W/R,K,DEF,BN,BN,BN,BN,BN,BN';
const NUM_TEAMS = 12;
const BOT_CAP = { QB: 2, RB: 6, WR: 6, TE: 2, K: 1, DEF: 1 };
const YAHOO_CAP = { QB: 2, RB: 6, WR: 7, TE: 3, K: 1, DEF: 1 };

const argSlot = process.argv[2] ? +process.argv[2] : null;
const argMode = process.argv[3] || null;
const VERBOSE = !!argSlot;

function setup() {
  const roster = HarveyLeague.parseRoster(ROSTER_TEXT);
  const size = HarveyCup.rosterSizeFrom(roster);
  HarveyCup.setRosterSize(size);
  HarveyCup.setLineup(roster);
  const players = JSON.parse(JSON.stringify(data.players));
  HarveyLeague.applyLeague(players, {
    roster, scoring: HarveyLeague.SCORING_PRESETS.harvey_cup, numTeams: NUM_TEAMS
  });
  players.forEach(p => {
    // Yahoo's board: its own projection where we have it, else ours discounted
    p.yahooRank = p.points_yahoo != null ? p.points_yahoo : (p.points || 0) * 0.85;
  });
  return { roster, size, players };
}

/* Best legal lineup under the roster shape: base slots take the top N at
 * each position, flex slots take the best remaining eligible player. */
function bestLineup(team, roster) {
  const by = {};
  team.forEach(p => { (by[p.pos] = by[p.pos] || []).push(p); });
  Object.values(by).forEach(a => a.sort((x, y) => y.points - x.points));
  const used = new Set(); let pts = 0; const missing = [];
  Object.keys(roster.base).forEach(pos => {
    for (let i = 0; i < roster.base[pos]; i++) {
      const p = (by[pos] || []).find(x => !used.has(x));
      if (p) { used.add(p); pts += p.points; } else missing.push(pos);
    }
  });
  roster.flex.forEach(f => {
    const cands = f.eligible.flatMap(pos => by[pos] || []).filter(x => !used.has(x))
      .sort((x, y) => y.points - x.points);
    if (cands[0]) { used.add(cands[0]); pts += cands[0].points; } else missing.push(f.slot);
  });
  return { pts: Math.round(pts), missing };
}

/* Yahoo's autodraft, approximately: fill open starting slots by Yahoo's
 * rank; a kicker or defense only when every other starter is filled or the
 * draft is nearly over; never past the position caps Yahoo enforces. */
function yahooPick(pool, team, roster, picksLeft) {
  const counts = {}; team.forEach(p => { counts[p.pos] = (counts[p.pos] || 0) + 1; });
  const openBase = pos => (roster.base[pos] || 0) - (counts[pos] || 0) > 0;
  const skillOpen = ['QB', 'RB', 'WR', 'TE'].some(openBase);
  const flexOpen = roster.flex.length
    - Math.max(0, ['RB', 'WR', 'TE'].reduce((s, pos) => s + Math.max(0, (counts[pos] || 0) - (roster.base[pos] || 0)), 0)) > 0;
  const kdefAllowed = (!skillOpen && !flexOpen) || picksLeft <= 3;
  const sorted = pool.slice().sort((a, b) => b.yahooRank - a.yahooRank);
  // starters first
  let pick = sorted.find(p => (counts[p.pos] || 0) < YAHOO_CAP[p.pos]
    && ((p.pos === 'K' || p.pos === 'DEF') ? (kdefAllowed && openBase(p.pos)) : openBase(p.pos)));
  if (!pick) pick = sorted.find(p => (counts[p.pos] || 0) < YAHOO_CAP[p.pos]
    && ((p.pos === 'K' || p.pos === 'DEF') ? (kdefAllowed && openBase(p.pos)) : true));
  return pick || sorted[0];
}

function adpPick(pool, team) {
  const counts = {}; team.forEach(p => { counts[p.pos] = (counts[p.pos] || 0) + 1; });
  return pool.find(p => (counts[p.pos] || 0) < (BOT_CAP[p.pos] || 9)) || pool[0];
}

function draft(mode, mySlot) {
  const { roster, size, players } = setup();
  let pool = players.slice().sort((a, b) => (a.adp || 999) - (b.adp || 999));
  const teams = {}; for (let t = 1; t <= NUM_TEAMS; t++) teams[t] = [];
  // mixed: seats 1,6,11 are humans (spread out), the rest autodraft; never us
  const human = t => mode === 'adp' || (mode === 'mixed' && [1, 6, 11].includes(t));
  const log = []; let fallbacks = 0, nulls = 0;
  let overall = 0;
  for (let r = 1; r <= size; r++) {
    const order = r % 2 === 1
      ? [...Array(NUM_TEAMS).keys()].map(i => i + 1)
      : [...Array(NUM_TEAMS).keys()].map(i => NUM_TEAMS - i);
    for (const t of order) {
      overall++;
      if (!pool.length) break;
      let pick;
      if (t === mySlot) {
        const nxt = overall + (r % 2 === 1 ? 2 * (NUM_TEAMS - mySlot) + 1 : 2 * mySlot - 1);
        const res = HarveyCup.advise(pool, teams[t], overall, nxt, [], 5, { picksRemaining: size - teams[t].length });
        const rec = res.recommendation;
        if (!rec) { nulls++; pick = pool[0]; }
        else { pick = pool.find(p => p.name === rec.name) || pool[0]; if (rec.fallback) fallbacks++; }
        log.push({ r, overall, pick, target: res.target_position, fb: !!(rec && rec.fallback) });
      } else if (human(t)) {
        pick = adpPick(pool, teams[t]);
      } else {
        pick = yahooPick(pool, teams[t], roster, size - teams[t].length);
      }
      teams[t].push(pick);
      pool = pool.filter(p => p !== pick);
    }
  }
  // grade
  const graded = Object.keys(teams).map(t => ({ t: +t, ...bestLineup(teams[t], roster) }))
    .sort((a, b) => b.pts - a.pts);
  const rank = graded.findIndex(g => g.t === mySlot) + 1;
  const mine = teams[mySlot];
  const counts = {}; mine.forEach(p => { counts[p.pos] = (counts[p.pos] || 0) + 1; });
  const firstK = log.find(l => l.pick.pos === 'K'), firstD = log.find(l => l.pick.pos === 'DEF');
  const me = graded.find(g => g.t === mySlot);
  if (process.env.HC_DUMP) {
    require('fs').writeFileSync(process.env.HC_DUMP, JSON.stringify({ mode, mySlot,
      teams: Object.fromEntries(Object.entries(teams).map(([t, ps]) => [t, ps.map(p => p.name)])),
      log: log.map(l => ({ r: l.r, overall: l.overall, name: l.pick.name, pos: l.pick.pos })) }));
  }
  return { mode, mySlot, rank, pts: me.pts, top: graded[0].pts, missing: me.missing, counts,
           firstK: firstK ? firstK.r : null, firstD: firstD ? firstD.r : null, fallbacks, nulls, log, roster };
}

function flags(res) {
  const f = [];
  if (res.missing.length) f.push('UNFILLED ' + res.missing.join(','));
  if (res.nulls) f.push('NULL-REC x' + res.nulls);
  if (res.fallbacks) f.push('fallback x' + res.fallbacks);
  if ((res.counts.QB || 0) > 2) f.push('QB>2');
  if ((res.counts.TE || 0) > 3) f.push('TE>3');
  if ((res.counts.RB || 0) < 3) f.push('RB<3');
  if ((res.counts.WR || 0) < 4) f.push('WR<4');
  if ((res.counts.K || 0) !== 1) f.push('K=' + (res.counts.K || 0));
  if ((res.counts.DEF || 0) !== 1) f.push('DEF=' + (res.counts.DEF || 0));
  if (res.firstK && res.firstK < 14) f.push('K in R' + res.firstK);
  if (res.firstD && res.firstD < 13) f.push('DEF in R' + res.firstD);
  return f.join(' ');
}

const modes = argMode ? [argMode] : ['adp', 'yahoo', 'mixed'];
const slots = argSlot ? [argSlot] : [...Array(NUM_TEAMS).keys()].map(i => i + 1);
const summary = {};
for (const mode of modes) {
  console.log(`\n=== room: ${mode} ===`);
  console.log('slot rank  lineup  (top)   QB RB WR TE K D   K@ D@  flags');
  for (const s of slots) {
    const r = draft(mode, s);
    (summary[mode] = summary[mode] || []).push(r);
    const c = r.counts;
    console.log(`${String(s).padStart(3)}  ${String(r.rank).padStart(2)}/12  ${String(r.pts).padStart(5)}  (${r.top})  `
      + `${c.QB || 0}  ${c.RB || 0}  ${c.WR || 0}  ${c.TE || 0}  ${c.K || 0} ${c.DEF || 0}  `
      + `${String(r.firstK || '-').padStart(2)} ${String(r.firstD || '-').padStart(2)}  ${flags(r)}`);
    if (VERBOSE) {
      r.log.forEach(l => console.log(`      R${String(l.r).padEnd(2)} p${String(l.overall).padEnd(3)} ${l.pick.pos.padEnd(3)} ${l.pick.name.padEnd(24)} adp ${String(l.pick.adp).padEnd(6)} ${String(Math.round(l.pick.points)).padStart(3)} pts  vor ${Math.round(l.pick.vor)}  target ${l.target}${l.fb ? '  <-- FALLBACK' : ''}`));
    }
  }
  const rs = summary[mode];
  const avgRank = rs.reduce((a, b) => a + b.rank, 0) / rs.length;
  const wins = rs.filter(x => x.rank === 1).length;
  console.log(`   avg rank ${avgRank.toFixed(2)}, wins ${wins}/${rs.length}, avg lineup ${Math.round(rs.reduce((a, b) => a + b.pts, 0) / rs.length)}`);
}
