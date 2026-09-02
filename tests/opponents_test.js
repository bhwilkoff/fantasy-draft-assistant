/* Opponent-aware availability must carry roster information the ADP model
 * throws away: a running back is safe when everyone picking before us is
 * full at running back, and gone when they all still need one. */
global.window = global;
require('../bridge/opponents.js');
const O = window.__hcOpp;

const pool = [];
for (let i = 1; i <= 30; i++) {
  pool.push({ name: 'RB' + i, pos: 'RB', adp: i * 2 - 1 });
  pool.push({ name: 'WR' + i, pos: 'WR', adp: i * 2 });
}
pool.push({ name: 'K1', pos: 'K', adp: 5 });          // absurd ADP on purpose

let fails = 0;
function check(label, cond, detail) {
  if (!cond) fails++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? ' = ' + detail : ''}`);
}

// picks 10..13 belong to four opponents; our next pick is 14
const empty = {};
const full = {};
for (let pk = 10; pk < 14; pk++) { empty[pk] = {}; full[pk] = { RB: 6 }; }

const sEmpty = O.simulateAvailability(pool, 10, 14, empty, { numTeams: 12, totalRounds: 15, trials: 200, seed: 1 });
const sFull = O.simulateAvailability(pool, 10, 14, full, { numTeams: 12, totalRounds: 15, trials: 200, seed: 1 });

check('top RB mostly gone when opponents need RBs', sEmpty.RB1 < 0.3, sEmpty.RB1.toFixed(2));
check('top RB safe when every opponent is full at RB', sFull.RB1 > 0.99, sFull.RB1.toFixed(2));
check('WRs get taken instead when RBs are refused', sFull.WR1 < sEmpty.WR1, `${sFull.WR1.toFixed(2)} < ${sEmpty.WR1.toFixed(2)}`);
check('kicker never taken this early regardless of ADP', sEmpty.K1 === 1, sEmpty.K1);
check('deep player survives', sEmpty.RB30 > 0.99, sEmpty.RB30.toFixed(2));
check('same seed reproduces', JSON.stringify(sEmpty) === JSON.stringify(
  O.simulateAvailability(pool, 10, 14, empty, { numTeams: 12, totalRounds: 15, trials: 200, seed: 1 })), true);

// inferring rosters from the autopilot's pick log
const picks = {
  1: { pos: 'RB', drafter: 'A' }, 2: { pos: 'RB', drafter: 'B' }, 3: { pos: 'WR', drafter: 'C' },
  24: { pos: 'RB', drafter: 'A' }, 23: { pos: 'TE', drafter: 'B' }
};
const inferred = O.inferOpponentRosters(picks, 12, 25, 28);
check('slot 1 owns picks 1, 24, 25 -> two RBs', JSON.stringify(inferred[25]) === JSON.stringify({ RB: 2 }), JSON.stringify(inferred[25]));
check('slot 2 owns picks 2, 23, 26 -> RB + TE', inferred[26].RB === 1 && inferred[26].TE === 1, JSON.stringify(inferred[26]));
check('slot 3 owns pick 27 -> one WR', JSON.stringify(inferred[27]) === JSON.stringify({ WR: 1 }), JSON.stringify(inferred[27]));

// autodrafters: detected by pick timing, simulated by Yahoo's rank with no noise
// snake, 12 teams: slot 1 owns 1 and 24; slot 2 owns 2 and 23; slot 3 owns 3
const timed = {
  1: { pos: 'RB', dt: 1 }, 24: { pos: 'WR', dt: 2 },      // slot 1: instant, instant
  2: { pos: 'RB', dt: 40 }, 23: { pos: 'WR', dt: 2 },     // slot 2: slow once
  3: { pos: 'RB', dt: 1 }                                 // slot 3: only one pick
};
const auto = O.inferAutodraftSlots(timed, 12, 8);
check('slot 1 (always instant) is an autodrafter', JSON.stringify(auto) === '[1]', JSON.stringify(auto));

// Yahoo ranks WR1 first even though ADP says RB1; an autodrafting slot follows XRank
const xpool = pool.map(p => Object.assign({}, p, { xrank: p.name === 'WR1' ? 1 : (p.name === 'RB1' ? 2 : 100 + p.adp) }));
const oneAuto = { 10: {} };
const sA = O.simulateAvailability(xpool, 10, 11, oneAuto, { numTeams: 12, totalRounds: 15, trials: 50, seed: 3, autodraftSlots: [O.owner(10, 12)] });
const sH = O.simulateAvailability(xpool, 10, 11, oneAuto, { numTeams: 12, totalRounds: 15, trials: 50, seed: 3, autodraftSlots: [] });
check('autodrafter takes Yahoo\'s #1 (WR1) every time', sA.WR1 === 0 && sA.RB1 === 1, `WR1=${sA.WR1} RB1=${sA.RB1}`);
check('a person is noisy: WR1 sometimes survives, RB1 sometimes goes',
  sH.WR1 > 0 && sH.RB1 < 1, `WR1=${sH.WR1.toFixed(2)} RB1=${sH.RB1.toFixed(2)}`);

console.log('\n' + (fails ? fails + ' FAILURES' : 'ALL OPPONENT CHECKS PASS'));
process.exit(fails ? 1 : 0);
