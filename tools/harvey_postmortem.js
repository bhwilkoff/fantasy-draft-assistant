/* The real draft, graded, replayed with the roster the autopilot should have
 * had, and the waiver wire that is left. node tools/harvey_postmortem.js */
global.window = global; require('../web/league.js'); require('../web/advisor.js');
const data = require('../data/players.json');
const picks = require('../data/harvey-cup/draft-2026-picks.json');
const ME = 'The Middle Children', SLOT = 12, N = 12;
const roster = HarveyLeague.parseRoster('QB,WR,WR,WR,RB,RB,TE,W/T,W/R,K,DEF,BN,BN,BN,BN,BN,BN');
HarveyCup.setRosterSize(17); HarveyCup.setLineup(roster);
const players = JSON.parse(JSON.stringify(data.players));
HarveyLeague.applyLeague(players, { roster, scoring: HarveyLeague.SCORING_PRESETS.harvey_cup, numTeams: N });
const byKey = Object.fromEntries(players.map(p => [p.key, p]));
function lineup(team) {
  const by = {}; team.forEach(p => (by[p.pos] = by[p.pos] || []).push(p));
  Object.values(by).forEach(a => a.sort((x, y) => y.points - x.points));
  const used = new Set(); let pts = 0; const starters = [];
  Object.keys(roster.base).forEach(pos => { for (let i = 0; i < roster.base[pos]; i++) { const p = (by[pos] || []).find(x => !used.has(x)); if (p) { used.add(p); pts += p.points; starters.push(pos + ':' + p.name.split(' ').pop() + ':' + Math.round(p.points)); } else starters.push(pos + ':EMPTY'); } });
  roster.flex.forEach(f => { const c = f.eligible.flatMap(pos => by[pos] || []).filter(x => !used.has(x)).sort((x, y) => y.points - x.points)[0]; if (c) { used.add(c); pts += c.points; starters.push('FLEX:' + c.name.split(' ').pop() + ':' + Math.round(c.points)); } else starters.push('FLEX:EMPTY'); });
  return { pts: Math.round(pts), starters };
}
const teams = {}; picks.forEach(pk => (teams[pk.owner] = teams[pk.owner] || []).push(byKey[pk.pid]));
const table = Object.entries(teams).map(([o, t]) => ({ owner: o, ...lineup(t) })).sort((a, b) => b.pts - a.pts);
console.log('=== ACTUAL, graded on our projections under Harvey Cup rules ===');
table.forEach((t, i) => console.log(String(i + 1).padStart(2) + '. ' + t.owner.padEnd(22) + String(t.pts).padStart(5) + (t.owner === ME ? '  <== US' : '')));
const me = table.find(t => t.owner === ME); console.log('our starters:', me.starters.join(' '));

// counterfactual: our seat re-drafted by the corrected advisor, everyone else as they actually picked
let pool = players.slice().sort((a, b) => (a.adp || 999) - (b.adp || 999));
const mine = [], others = {}; const taken = new Set();
for (const pk of picks) {
  const owner = pk.owner, overall = pk.overall;
  if (owner === ME) {
    const r = pk.round; const nxt = overall + (r % 2 === 1 ? 2 * (N - SLOT) + 1 : 2 * SLOT - 1);
    const res = HarveyCup.advise(pool, mine, overall, nxt, [], 5, { picksRemaining: 17 - mine.length });
    const rec = res.recommendation; const p = pool.find(x => x.name === rec.name);
    mine.push(p); taken.add(p.key); pool = pool.filter(x => x !== p);
    console.log('  R' + String(r).padEnd(2) + ' p' + String(overall).padEnd(3) + ' would take ' + (p.pos + ' ' + p.name).padEnd(28) + ' instead of ' + pk.pos + ' ' + pk.name);
  } else {
    let p = byKey[pk.pid];
    if (taken.has(p.key)) p = pool.find(x => x.pos === pk.pos) || pool[0];   // we took him first: they take the next best at the position
    (others[owner] = others[owner] || []).push(p); taken.add(p.key); pool = pool.filter(x => x !== p);
  }
}
const cf = lineup(mine); const cfTable = Object.entries(others).map(([o, t]) => ({ owner: o, ...lineup(t) })).concat([{ owner: ME, ...cf }]).sort((a, b) => b.pts - a.pts);
console.log('\n=== COUNTERFACTUAL: same room, our seat with the correct roster ===');
console.log('rank ' + (cfTable.findIndex(t => t.owner === ME) + 1) + '/12, lineup ' + cf.pts + ' (actual ' + me.pts + ', top ' + table[0].pts + ')');
console.log('roster:', mine.map(p => p.pos + ' ' + p.name).join(', '));
console.log('starters:', cf.starters.join(' '));

// waiver wire
const drafted = new Set(picks.map(pk => pk.pid));
const und = players.filter(p => !drafted.has(p.key));
console.log('\n=== WAIVER WIRE (undrafted), by our projection ===');
for (const pos of ['RB', 'QB', 'WR', 'TE', 'K', 'DEF']) {
  const top = und.filter(p => p.pos === pos).sort((a, b) => b.points - a.points).slice(0, pos === 'RB' || pos === 'QB' ? 8 : 5);
  console.log(pos + ': ' + top.map(p => p.name + ' ' + Math.round(p.points) + (p.injury && p.injury !== 'ACTIVE' ? '(' + p.injury + ')' : '')).join(' · '));
}
console.log('\nour TEs by projection:', teams[ME].filter(p => p.pos === 'TE').sort((a, b) => b.points - a.points).map(p => p.name + ' ' + Math.round(p.points)).join(' · '));
