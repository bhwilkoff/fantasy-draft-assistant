#!/usr/bin/env node
/* Regenerate the league-wide draft report offline from a saved bundle.
 *
 *   node tools/draft_report.js data/mocks/harvests/10513354.json > data/mocks/reports/10513354.md
 *
 * A bundle is what the room writes: the final harvest (every roster with
 * pick numbers and Yahoo's projections) plus the autopilot's pick log
 * (timing) and advice log. `bridge/report.js` is the single implementation;
 * this file only gives it a window and the projection index from
 * data/players.json, so a report can be re-run after the room is gone --
 * and after report.js improves.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const file = process.argv[2];
if (!file) { console.error('usage: node tools/draft_report.js <bundle.json>'); process.exit(2); }
const bundle = JSON.parse(fs.readFileSync(file, 'utf8'));

const W = { localStorage: { setItem() {}, getItem() { return null; } } };
global.window = W;
global.localStorage = W.localStorage;
global.document = { getElementById: () => null, createElement: () => ({ style: {} }), body: { appendChild() {} } };
require(path.join(ROOT, 'web', 'league.js'));
require(path.join(ROOT, 'web', 'advisor.js'));
if (!W.HarveyLeague && global.HarveyLeague) W.HarveyLeague = global.HarveyLeague;
if (!W.HarveyCup && global.HarveyCup) W.HarveyCup = global.HarveyCup;

const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'players.json'), 'utf8'));
const players = Array.isArray(data) ? data : data.players;
W.__hcIndex = W.HarveyCup.buildIndex(players);
W.__hcLeagueSummary = bundle.leagueSummary || null;
W.__hcAuto = { picks: bundle.picks || {}, log: bundle.log || [] };

require(path.join(ROOT, 'bridge', 'report.js'));
const out = W.__hcReport(bundle);
if (out.error) { console.error(out.error); process.exit(1); }
process.stdout.write(out.markdown + '\n');
