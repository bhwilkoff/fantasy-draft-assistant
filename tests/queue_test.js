/* The queue is the ACTUATOR: Yahoo drafts queue[0], so if the queue does not
 * express the current ranking, the advice never reaches the draft.
 *
 * Four mock drafts were lost to this. The autopilot only ever added stars, so
 * queue[0] stayed whatever was queued first and round 15 drafted from a queue
 * built in round 2. This test drives two ticks with DIFFERENT rankings and
 * asserts the queue ends up holding exactly the second one, in order.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');

// A minimal room: a player table whose rows each carry a queue star.
const PLAYERS = [
  { yid: '1', name: 'A. One', pos: 'RB', team: 'DET' },
  { yid: '2', name: 'B. Two', pos: 'WR', team: 'LAR' },
  { yid: '3', name: 'C. Three', pos: 'TE', team: 'ARI' },
  { yid: '4', name: 'D. Four', pos: 'QB', team: 'BUF' },
  { yid: '5', name: 'E. Five', pos: 'K', team: 'DAL' },
  { yid: '6', name: 'F. Six', pos: 'DEF', team: 'HOU' },
];
const rows = PLAYERS.map(p => `
  <tr>
    <td><div class="ys-addqueue" data-id="${p.yid}"><button>star</button></div></td>
    <td><div class="ys-player" data-id="${p.yid}"><span>${p.name}</span><span>${p.pos}</span><span>${p.team}</span><span>Bye 6</span></div></td>
    <td>10</td><td>12.5</td><td>6</td><td>200</td>
  </tr>`).join('');

const html = `
<div class="_ys_hdr">Colton's Pick • You're up in 3 Picks • Round 2, Pick 20</div>
<div class="_ys_order"><div class="ys-draftorder-team">A</div>
  <div class="ys-draftorder-team ys-draftorder-current">B</div>
  <div class="ys-draftorder-team">You</div></div>
<table>
  <tr><th>Queue</th><th>Player</th><th>XRank</th><th>ADP</th><th>Bye</th><th>Proj Pts</th></tr>
  ${rows}
</table>`;

const dom = new JSDOM('<!doctype html><html><body>' + html + '</body></html>',
  { url: 'https://football.fantasysports.yahoo.com/draftclient/f1/999/3' });
const W = dom.window;
global.window = W; global.document = W.document;
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
// the autopilot runs with `this` = the jsdom window, so globals it touches
// must exist there
W.MutationObserver = W.MutationObserver || global.MutationObserver;
W.localStorage = W.localStorage || global.localStorage;
global.MutationObserver = W.MutationObserver;
global.setInterval = W.setInterval ? W.setInterval.bind(W) : setInterval;
global.clearInterval = W.clearInterval ? W.clearInterval.bind(W) : clearInterval;
global.location = W.location;
global.Event = W.Event;
global.fetch = () => Promise.reject(new Error('offline'));

/* Behave like Yahoo. A click on a player's star toggles him in the QUEUE
 * PANEL (a list of `.ys-removequeue[data-id]` rows in insertion order) and
 * swaps the star's class between ys-addqueue and ys-removequeue. The second
 * generation of the actuator failed precisely because the fixture did not
 * do this: it kept looking for `.ys-addqueue` on a queued player. */
const clicks = [];
const panel = W.document.createElement('div');
panel.id = 'queue-panel';
W.document.body.appendChild(panel);
function yahooQueue() {
  return [...panel.querySelectorAll('.ys-removequeue[data-id]')].map(e => e.getAttribute('data-id'));
}
function wireStar(el) {
  const yid = el.getAttribute('data-id');
  el.querySelector('button').addEventListener('click', () => {
    clicks.push(yid);
    const inQueue = panel.querySelector(`.ys-removequeue[data-id="${yid}"]`);
    if (inQueue) {
      inQueue.remove();
      el.className = 'ys-addqueue';
    } else {
      const row = W.document.createElement('div');
      row.className = 'ys-removequeue';
      row.setAttribute('data-id', yid);
      row.innerHTML = '<button>remove</button>';
      row.querySelector('button').addEventListener('click', () => {
        clicks.push('-' + yid);
        row.remove();
        el.className = 'ys-addqueue';
      });
      panel.appendChild(row);
      el.className = 'ys-removequeue';
    }
  });
}
W.document.querySelectorAll('.ys-addqueue').forEach(wireStar);

// these attach to `window`, which we have pointed at the jsdom window
require(path.join(ROOT, 'web', 'league.js'));
require(path.join(ROOT, 'web', 'advisor.js'));
if (!W.HarveyCup && global.HarveyCup) W.HarveyCup = global.HarveyCup;
if (!W.HarveyLeague && global.HarveyLeague) W.HarveyLeague = global.HarveyLeague;
if (!W.HarveyCup) throw new Error('HarveyCup did not attach to the jsdom window');

// minimal reader + index stubs; we are testing the queue, not the parsing
W.__hcReaders = {
  readStatus: () => ({ round: 2, pick: 20, upIn: 3, onClock: 'B', clock: '00:30' }),
  readMyRoster: () => []
};
W.__hcIndex = {};
PLAYERS.forEach(p => {
  W.__hcIndex[W.HarveyCup.roomKey(p.name, p.pos, p.team)] =
    [{ name: p.name, pos: p.pos, team: p.team, vor: 100, points: 200, adp: 12, tier: 1 }];
});

// drive advise() to return a ranking we control
let ranking = [];
const realAdvise = W.HarveyCup.advise;
// pool-aware, like the real advisor: the queue is now built by drafting our
// next picks one after another, so a stub that ignores the pool would put
// the same player in every slot
W.HarveyCup.advise = function (available) {
  const names = new Set((available || []).map(p => p.name));
  const r = ranking.filter(x => names.has(x.name));
  return {
    recommendation: r[0] || null,
    alternatives: r.slice(1),
    position_view: {}, roster: { counts: {}, starterGap: {}, totalGap: {}, flexOpen: 0 },
    target_position: 'RB', picks_remaining: 10, recent_runs: {}
  };
};

W.__HC_TEST = 1;
new Function(fs.readFileSync(path.join(ROOT, 'bridge', 'autopilot.js'), 'utf8')).call(W);
const A = W.__hcAuto;
A.RATE_MS = 0;

function mk(p) { return { name: p.name, pos: p.pos, team: p.team, vor: 100,
                          points: 200, adp: 12, tier: 1, survival_next: 0.5 }; }

let fails = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label} = ${JSON.stringify(got)}`
    + (ok ? '' : `  (want ${JSON.stringify(want)})`));
}

// --- tick 1: recommend players 1,2,3. One add per pass, so three passes.
ranking = [mk(PLAYERS[0]), mk(PLAYERS[1]), mk(PLAYERS[2])];
clicks.length = 0;
A.tick(); A.tick(); A.tick();
check('tick1 Yahoo queue is 1,2,3 in order', yahooQueue(), ['1', '2', '3']);
check('tick1 queueTop', A.queueTop, 'A. One');
A.tick();
check('tick1 a further pass changes nothing', yahooQueue(), ['1', '2', '3']);

// --- tick 2: ranking changes completely to 5,6 (a kicker and a defense)
ranking = [mk(PLAYERS[4]), mk(PLAYERS[5])];
clicks.length = 0;
A.tick(); A.tick(); A.tick();
console.log('  (tick2 clicks: ' + JSON.stringify(clicks) + ')');
check('tick2 Yahoo queue is exactly the new set, in order', yahooQueue(), ['5', '6']);
check('tick2 queueTop is the live recommendation', A.queueTop, 'E. Five');

// --- tick 3: same players, REVERSED. queue[0] must follow the ranking.
ranking = [mk(PLAYERS[5]), mk(PLAYERS[4])];
A.tick(); A.tick(); A.tick();
check('tick3 reversed ranking reorders the queue', yahooQueue(), ['6', '5']);

// --- tick 4: Yahoo holds a stale player we never asked for (queued by hand,
//     or left over from before a re-arm). It must be removed.
const stale = W.document.querySelector('.ys-addqueue[data-id="1"] button');
stale.click();
check('tick4 setup: stale entry present', yahooQueue(), ['6', '5', '1']);
A.tick();
check('tick4 stale entry removed, wanted order intact', yahooQueue(), ['6', '5']);

// --- tick 5: the queue is SEQUENTIAL. With a roster-aware advisor that
//     never wants a second quarterback, a flat ranking of [QB, QB2, RB]
//     must become a queue of [QB, RB]: entry two is computed as if entry
//     one were already on the roster (mock 10501714 queued three QBs and
//     the room took two of them on back-to-back snake picks).
W.document.querySelectorAll('.ys-removequeue').forEach(e => e.querySelector('button').click());
const qb2 = { yid: '7', name: 'G. Seven', pos: 'QB', team: 'KC' };
const tr = W.document.createElement('tr');
tr.innerHTML = `<td><div class="ys-addqueue" data-id="7"><button>star</button></div></td>
  <td><div class="ys-player" data-id="7"><span>${qb2.name}</span><span>QB</span><span>KC</span><span>Bye 6</span></div></td>
  <td>10</td><td>12.5</td><td>6</td><td>200</td>`;
W.document.querySelector('table').appendChild(tr);
wireStar(tr.querySelector('.ys-addqueue'));
W.__hcIndex[W.HarveyCup.roomKey(qb2.name, qb2.pos, qb2.team)] =
  [{ name: qb2.name, pos: qb2.pos, team: qb2.team, vor: 90, points: 300, adp: 40, tier: 1 }];
W.HarveyCup.advise = function (available, roster) {
  const names = new Set((available || []).map(p => p.name));
  const hasQB = (roster || []).some(p => p.pos === 'QB');
  const r = ranking.filter(x => names.has(x.name) && !(hasQB && x.pos === 'QB'));
  return { recommendation: r[0] || null, alternatives: r.slice(1), position_view: {},
           roster: { counts: {}, starterGap: {}, totalGap: {}, flexOpen: 0 },
           target_position: 'QB', picks_remaining: 10, recent_runs: {} };
};
ranking = [mk(PLAYERS[3]), mk(qb2), mk(PLAYERS[0])];   // QB, QB, RB
A.tick(); A.tick(); A.tick();
check('tick5 sequential queue skips the second QB', yahooQueue(), ['4', '1']);

console.log('\n' + (fails ? fails + ' FAILURES' : 'ALL QUEUE ACTUATOR CHECKS PASS'));
process.exit(fails ? 1 : 0);
