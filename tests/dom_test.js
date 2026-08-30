/* Fixture test for the bridge's DOM readers.
 *
 * The readers are the component most likely to rot without anyone noticing:
 * Yahoo redeploys, a class name changes, and the overlay keeps rendering --
 * just with an empty player pool and confident-looking advice built on it.
 * The fixture reproduces the structure captured live on 2026-08-30, hashed
 * CSS-in-JS class names included, so this also proves we never bind to them.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'draftroom.html'), 'utf8');

const dom = new JSDOM('<!doctype html><html><body>' + html + '</body></html>',
  { url: 'https://football.fantasysports.yahoo.com/draftclient/f1/1/1' });

/* jsdom has no layout engine and therefore no innerText. The readers depend
 * on innerText's block-level newlines to split "T. Higgins / WR / Cin", so we
 * approximate it: element children become lines, leaves fall back to text. */
const W = dom.window;
Object.defineProperty(W.HTMLElement.prototype, 'innerText', {
  get() {
    const kids = Array.from(this.children);
    if (!kids.length) return (this.textContent || '').trim();
    return kids.map(k => k.innerText).filter(Boolean).join('\n');
  },
  configurable: true
});
Object.defineProperty(W.HTMLTableCellElement.prototype, 'innerText', {
  get() {
    const kids = Array.from(this.children);
    if (!kids.length) return (this.textContent || '').trim();
    return kids.map(k => k.innerText).filter(Boolean).join('\n');
  },
  configurable: true
});

global.window = W;
global.document = W.document;
global.fetch = () => Promise.reject(new Error('no network in fixture test'));
global.localStorage = { getItem: () => null, setItem: () => {} };
W.__HC_TEST = 1;

// advisor.js first (the bridge calls into it), then the bridge itself.
require(path.join(ROOT, 'web', 'advisor.js'));
W.HarveyCup = global.HarveyCup || W.HarveyCup;
new Function(fs.readFileSync(path.join(ROOT, 'bridge', 'yahoo-draft-bridge.user.js'), 'utf8'))
  .call(W);

const R = W.__hcReaders;
let fails = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label + ' = ' + JSON.stringify(got)
    + (ok ? '' : '   (want ' + JSON.stringify(want) + ')'));
}

console.log('--- status line');
const st = R.readStatus();
eq('round', st.round, 3);
eq('pick', st.pick, 33);
eq('upIn', st.upIn, 5);
eq('clock', st.clock, '00:24');
eq('onClock', st.onClock, 'Eric Hollinger');

console.log('--- available table');
const av = R.readAvailable();
eq('rows found', av.rows.length, 5);
eq('first name', av.rows[0].name, 'T. Higgins');
eq('first pos', av.rows[0].pos, 'WR');
eq('first team', av.rows[0].team, 'Cin');
eq('first adp', av.rows[0].adp, 33.5);
eq('bye excluded from team', av.rows[1].team, 'Bal');
// the injury tag sits between name and position and must not be read as team
const love = av.rows.find(r => r.name === 'B. Robinson' && r.adp === 156.7);
eq('injury-tagged row pos', love.pos, 'RB');
eq('injury-tagged row team', love.team, 'Atl');
eq('injury-tagged row injury', love.injury, 'Q');
eq('defense pos', av.rows[4].pos, 'DEF');

console.log('--- teammate collision resolved by the ADP column');
const data = require(path.join(ROOT, 'data', 'players.json'));
const index = W.HarveyCup.buildIndex(data.players);
const hits = av.rows
  .filter(r => r.name === 'B. Robinson')
  .map(r => W.HarveyCup.lookup(index, r.name, r.pos, r.team, r.adp).player.name);
eq('two ATL Robinsons resolve apart', hits, ['Bijan Robinson', 'Brian Robinson Jr.']);

console.log('--- draft order');
eq('order', R.readDraftOrder(), ['Chuck', 'Eric Hollinger', 'Ben Wilkoff']);

console.log('--- my roster from the pick feed');
R.setState('myTeam', 'Ben Wilkoff');
const mine = R.readMyRoster(av.rows);
eq('roster names', mine.map(m => m.name), ['R. Rice']);
eq('roster pos', mine.map(m => m.pos), ['WR']);

console.log('\n' + (fails ? fails + ' FAILURES' : 'ALL DOM READER CHECKS PASS'));
process.exit(fails ? 1 : 0);
