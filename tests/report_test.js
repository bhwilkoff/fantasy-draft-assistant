// Offline test for bridge/report.js: a synthetic 4-team, 3-round harvest
// with pick numbers and Yahoo projections must produce a full report --
// standings with grades, a section per team, values/reaches, one-pick-late
// near misses, our own near miss from the advice log, and a round-by-round
// story -- without touching the network or a DOM.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const W = { localStorage: { setItem() {}, getItem() { return null; } } };
global.window = W;
global.localStorage = W.localStorage;
global.document = { getElementById: () => null, createElement: () => ({ style: {} }), body: { appendChild() {} } };

require(path.join(ROOT, 'web', 'league.js'));
require(path.join(ROOT, 'web', 'advisor.js'));
if (!W.HarveyLeague && global.HarveyLeague) W.HarveyLeague = global.HarveyLeague;
if (!W.HarveyCup && global.HarveyCup) W.HarveyCup = global.HarveyCup;

const PLAYERS = [
  { name: 'A. Back', pos: 'RB', team: 'DET', adp: 1, vor: 150, tier: 1, bye: 6 },
  { name: 'B. Back', pos: 'RB', team: 'ATL', adp: 2, vor: 140, tier: 1, bye: 11 },
  { name: 'C. Wide', pos: 'WR', team: 'CIN', adp: 3, vor: 120, tier: 1, bye: 6 },
  { name: 'D. Wide', pos: 'WR', team: 'LAR', adp: 4, vor: 110, tier: 1, bye: 6 },
  { name: 'E. Pass', pos: 'QB', team: 'BUF', adp: 20, vor: 80, tier: 2, bye: 7 },
  { name: 'F. Pass', pos: 'QB', team: 'BAL', adp: 22, vor: 70, tier: 2, bye: 13 },
  { name: 'G. End', pos: 'TE', team: 'LV', adp: 15, vor: 60, tier: 2, bye: 13 },
  { name: 'H. End', pos: 'TE', team: 'ARI', adp: 30, vor: 40, tier: 3, bye: 6 },
  { name: 'I. Wide', pos: 'WR', team: 'HOU', adp: 9, vor: 90, tier: 2, bye: 6 },
  { name: 'J. Back', pos: 'RB', team: 'NYJ', adp: 40, vor: 30, tier: 4, bye: 6 },
  { name: 'K. Wide', pos: 'WR', team: 'DAL', adp: 11, vor: 85, tier: 2, bye: 7 },
  { name: 'L. Back', pos: 'RB', team: 'SF', adp: 2, vor: 80, tier: 2, bye: 8 },   // falls to 12: a value
];
W.__hcIndex = {};
PLAYERS.forEach(p => {
  W.__hcIndex[W.HarveyCup.roomKey(p.name, p.pos, p.team)] =
    [Object.assign({ points: 200, injury_factor: 1 }, p)];
});

// 4 teams, 3 rounds, snake. Yahoo projections roughly follow VOR.
const proj = {};
PLAYERS.forEach((p, i) => { proj[p.name] = 300 - i * 15; });
const draft = [   // pick -> [team, player index]
  [1, 'North', 0], [2, 'South', 1], [3, 'East', 2], [4, 'West', 3],
  [5, 'West', 4], [6, 'East', 5], [7, 'South', 6], [8, 'North', 7],   // North reaches for H. End (ADP 30 at 8)
  [9, 'North', 9], [10, 'South', 8], [11, 'East', 10], [12, 'West', 11],  // North takes J. Back (ADP 40 at 9)
];
const teams = {};
draft.forEach(([pick, team, i]) => {
  const p = PLAYERS[i];
  (teams[team] = teams[team] || []).push({ name: p.name, pos: p.pos, team: p.team, pick, yahooProj: proj[p.name], yid: String(i) });
});
const harvest = { room: '4242', slot: 1, me: 'North', numTeams: 4, roster: 'QB,RB,WR,TE,BN', teams };

// an autopilot advice log: before pick 8 we wanted G. End, South took him at 7
W.__hcAuto = {
  log: [{ pick: 5, rec: 'G. End' }, { pick: 6, rec: 'G. End' }, { pick: 7, rec: 'G. End' }, { pick: 8, rec: 'H. End' }],
  picks: { 2: { dt: 2 }, 7: { dt: 3 }, 10: { dt: 2 }, 1: { dt: 40 }, 8: { dt: 35 }, 9: { dt: 50 } }
};

require(path.join(ROOT, 'bridge', 'report.js'));
const out = W.__hcReport(harvest);

let fails = 0;
function check(label, ok, extra) {
  if (!ok) fails++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}` + (ok ? '' : `  (${extra})`));
}
const md = out.markdown || '';
check('report produced', !!md && !out.error, out.error);
check('graded on Yahoo projections', out.source === 'yahoo', out.source);
check('four teams ranked', out.teams.length === 4 && out.teams[0].rank === 1, JSON.stringify(out.teams));
check('every team has a section', ['North', 'South', 'East', 'West'].every(t => md.indexOf('. ' + t + ' — ') >= 0), '');
check('standings table present', /\| # \| Team \| Grade \|/.test(md), '');
check('reach detected (H. End at 8, ADP 30)', /H\. End at 8 \(ADP 30, 22 early\)/.test(md), '');
check('value detected (L. Back at 12, ADP 2)', /Good choices: L\. Back at 12 \(ADP 2, fell 10\)/.test(md), '');
check('our near miss: G. End taken by South at 7', /we wanted G\. End; South took him at 7/.test(md), '');
check('rounds narrated', /\*\*Round 1\*\*/.test(md) && /\*\*Round 3\*\*/.test(md), '');
check('first QB noted', /First QB off the board: E\. Pass to West at 5/.test(md), '');
check('autodrafter flagged (South, 2-3 s per pick)', /South[^\n]*autodrafting/.test(md.split('## Team by team')[0]), '');
check('one-line summary', /\*\*In one line:\*\*/.test(md), '');

console.log('\n' + (fails ? fails + ' FAILURES' : 'ALL REPORT CHECKS PASS'));
process.exit(fails ? 1 : 0);
