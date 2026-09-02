/* Does the Yahoo draft room's "T. Higgins" render resolve to the right row?
 * This is the bridge's single point of failure: a wrong match silently
 * advises on the wrong player, and the advice still looks reasonable. */
global.window = global;
require('../web/advisor.js');
var data = require('../data/players.json');
/* The "V. Jefferson" case guards the PARSER (a leading "V." must not be eaten
 * as a roman-numeral suffix), not the player. Van Jefferson fell out of the
 * projection set on 2026-09-01, so keep a synthetic row for him rather than
 * letting a roster cut silently delete the test. */
if (!data.players.some(function (p) { return p.name === 'Van Jefferson'; })) {
  data.players.push({ name: 'Van Jefferson', pos: 'WR', team: 'WSH',
                      vor: -50, points: 40, adp: null });
}
var index = HarveyCup.buildIndex(data.players);
var byName = {};
data.players.forEach(function (p) { byName[p.name] = p; });

function adpOf(n) { return byName[n] ? byName[n].adp : null; }

// Strings copied verbatim from the live Yahoo mock draft room, 2026-08-30.
var OBSERVED = [
  ['T. Higgins', 'WR', 'Cin', null, 'Tee Higgins'],
  ['J. Love',    'RB', 'Ari', null, 'Jeremiyah Love'],
  ['Z. Flowers', 'WR', 'Bal', null, 'Zay Flowers'],
  ['C. Olave',   'WR', 'NO',  null, 'Chris Olave'],
  ['D. Smith',   'WR', 'Phi', null, 'DeVonta Smith'],
  ['R. Rice',    'WR', 'KC',  null, 'Rashee Rice']
];

/* Initial+surname+position collisions. Note Bijan and Brian Robinson are
 * BOTH Atlanta running backs in 2026, so team cannot separate them and the
 * ADP column is the only signal the room actually gives us. */
/* The Results tab names a defense by nickname only, with no team. */
var DEFENSES = [
  ['Jaguars',  'DEF', null, null, data.players.filter(function (p) { return p.pos === 'DEF' && p.team === 'JAX'; }).map(function (p) { return p.name; })[0]],
  ['Eagles',   'DEF', null, null, data.players.filter(function (p) { return p.pos === 'DEF' && p.team === 'PHI'; }).map(function (p) { return p.name; })[0]]
];

var COLLISIONS = [
  ['A. Brown',    'WR', 'NE',  null, 'A.J. Brown'],
  ['A. Brown',    'WR', 'DET', null, 'Amon-Ra St. Brown'],
  ['V. Jefferson','WR', 'WSH', null, 'Van Jefferson'],
  ['J. Jefferson','WR', 'MIN', null, 'Justin Jefferson'],
  ['B. Robinson', 'RB', 'ATL', adpOf('Bijan Robinson'),     'Bijan Robinson'],
  ['B. Robinson', 'RB', 'ATL', adpOf('Brian Robinson Jr.'), 'Brian Robinson Jr.']
];

var fails = 0;
function check(label, rows) {
  console.log('--- ' + label);
  rows.forEach(function (r) {
    var got = HarveyCup.lookup(index, r[0], r[1], r[2], r[3]);
    var name = got.player ? got.player.name : null;
    var ok = name === r[4];
    if (!ok) fails++;
    console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  "' + r[0] + '" ' + r[1] + '/' + r[2]
      + (r[3] != null ? ' adp~' + r[3] : '')
      + '  -> ' + name + (ok ? '' : '   (want ' + r[4] + ')')
      + (got.resolvedBy ? '   [by ' + got.resolvedBy + ']' : '')
      + (got.ambiguous ? '   [AMBIGUOUS: ' + got.candidates.join(', ') + ']' : ''));
  });
}
check('observed in the live room', OBSERVED);
check('initial-key collisions', COLLISIONS);
check('defenses by nickname (Results tab)', DEFENSES);

/* Round trip: render every draftable player the way the room would, then
 * resolve it back. Anything that does not come home is a live mis-advice. */
var top = data.players.filter(function (p) { return p.adp && p.adp <= 180; });
var miss = [], amb = [];
top.forEach(function (p) {
  var bits = p.name.split(' ');
  var room = bits[0].charAt(0) + '. ' + bits.slice(1).join(' ');
  var r = HarveyCup.lookup(index, room, p.pos, p.team, p.adp);
  if (!r.player) miss.push(p.name + ' -> (none)');
  else if (r.player.name !== p.name) miss.push(p.name + ' -> ' + r.player.name);
  else if (r.ambiguous) amb.push(p.name);
});
console.log('\n--- round trip over ' + top.length + ' draftable players');
console.log('  unresolved or wrong : ' + miss.length
  + (miss.length ? '  ' + miss.slice(0, 8).join(', ') : ''));
console.log('  needed a tiebreaker : ' + amb.length
  + (amb.length ? '  ' + amb.slice(0, 8).join(', ') : ''));
fails += miss.length;

console.log('\n' + (fails ? fails + ' FAILURES' : 'ALL MATCH CHECKS PASS'));
process.exit(fails ? 1 : 0);
