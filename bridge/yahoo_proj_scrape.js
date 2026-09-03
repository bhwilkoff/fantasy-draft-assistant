/* Yahoo's own season projections under THIS league's scoring -- the bias
 * check source (data/sources/yahoo_league_proj.json, DECISIONS 022).
 *
 * Yahoo scores its projections under each league's rules on the league's
 * own player list, which needs a logged-in browser. So this is a console
 * snippet, not a fetcher: open the Harvey Cup player list
 *
 *   https://football.fantasysports.yahoo.com/f1/539156/players?status=ALL&pos=O&cut_type=9&stat1=S_PS_2026&myteam=0&sort=PTS&sdir=1&count=0
 *
 * paste this whole file into the console, and it pages through offense
 * (300 players), kickers and defenses by itself, accumulating in
 * localStorage, then shows the JSON over the page. Select all, copy, and
 * save it as data/sources/yahoo_league_proj.json (replace the file), then
 * run engine/build.py. Takes about two minutes. Do it on draft morning
 * before tools/draftday.sh.
 */
(function () {
  var LEAGUE = '539156';
  var BASE = '/f1/' + LEAGUE + '/players?status=ALL&cut_type=9&stat1=S_PS_2026&myteam=0&sort=PTS&sdir=1';
  var PLAN = [{ pos: 'O', max: 300 }, { pos: 'K', max: 50 }, { pos: 'DEF', max: 32 }];
  var TEAM = { Buf: 'BUF', Bal: 'BAL', NE: 'NE', Cin: 'CIN', Phi: 'PHI', Dal: 'DAL', KC: 'KC', Was: 'WAS',
    Det: 'DET', Atl: 'ATL', Hou: 'HOU', LAR: 'LAR', LAC: 'LAC', SF: 'SF', Sea: 'SEA', Den: 'DEN', Min: 'MIN',
    GB: 'GB', Chi: 'CHI', TB: 'TB', NO: 'NO', Car: 'CAR', NYG: 'NYG', NYJ: 'NYJ', Mia: 'MIA', Jax: 'JAX',
    Ind: 'IND', Ten: 'TEN', Cle: 'CLE', Pit: 'PIT', Ari: 'ARI', LV: 'LV' };

  function num(s) { var v = parseFloat(String(s).replace(/[%,]/g, '')); return isNaN(v) ? null : v; }
  function state() { try { return JSON.parse(localStorage.getItem('hcYahooScrape') || '{"step":0,"rows":[]}'); } catch (e) { return { step: 0, rows: [] }; } }
  function save(st) { localStorage.setItem('hcYahooScrape', JSON.stringify(st)); }
  function go(pos, offset) { location.assign(BASE + '&pos=' + pos + '&count=' + offset); }

  function readPage() {
    var t = [].slice.call(document.querySelectorAll('table')).filter(function (x) {
      return x.tBodies.length && x.tBodies[0].rows.length >= 3; })[0];
    if (!t) return [];
    return [].slice.call(t.tBodies[0].rows).map(function (r) {
      var a = r.querySelector('a.name') || r.querySelector('a[href*="/players/"]') || r.querySelector('a[href*="/teams/"]') || r.querySelector('a');
      var tp = (r.textContent.match(/\b([A-Z][a-z]{1,2}|[A-Z]{2,3})\s*-\s*(QB|RB|WR|TE|K|DEF)\b/) || []);
      var c = [].slice.call(r.cells).map(function (x) { return x.textContent.replace(/\s+/g, ' ').trim(); });
      return { name: a ? a.textContent.trim() : null, team: tp[1] || null, pos: tp[2] || null, cells: c };
    }).filter(function (r) { return r.name && r.pos; });
  }

  function toPlayer(r) {
    var c = r.cells, team = TEAM[r.team] || String(r.team || '').toUpperCase();
    var base = { name: r.name, team: team, pos: r.pos, bye: num(c[5]), points: num(c[6]), yahoo_rank: num(c[7]), pct_rostered: num(c[9]) };
    if (r.pos === 'K') base.stats = { fg_0_19: num(c[10]), fg_20_29: num(c[11]), fg_30_39: num(c[12]), fg_40_49: num(c[13]), fg_50: num(c[14]), pat: num(c[15]) };
    else if (r.pos === 'DEF') base.stats = { pts_allowed: num(c[10]), sacks: num(c[11]), safeties: num(c[12]), int: num(c[13]), fum_rec: num(c[14]), td: num(c[15]), blk: num(c[16]) };
    else base.stats = { games: num(c[4]), pass_yd: num(c[10]), pass_td: num(c[11]), pass_int: num(c[12]), rush_att: num(c[13]), rush_yd: num(c[14]), rush_td: num(c[15]), targets: num(c[16]), rec: num(c[17]), rec_yd: num(c[18]), rec_td: num(c[19]), ret_td: num(c[20]), two_pt: num(c[21]), fum_lost: num(c[22]) };
    Object.keys(base.stats).forEach(function (k) { if (base.stats[k] == null) delete base.stats[k]; });
    return base;
  }

  /* Finished output persists; running the snippet again only shows it.
   * To scrape afresh: localStorage.removeItem('hcYahooProjJSON') first. */
  var done = localStorage.getItem('hcYahooProjJSON');
  if (done && !localStorage.getItem('hcYahooScrape')) { showJSON(done); return 'already done: shown'; }
  var st = state();
  var here = (location.search.match(/pos=([A-Z]+)/) || [])[1];
  var offset = +((location.search.match(/count=(\d+)/) || [])[1] || 0);
  var plan = PLAN[st.step];
  if (!plan) { st = { step: 0, rows: [] }; plan = PLAN[0]; }
  if (here !== plan.pos || (st.rows.filter(function (r) { return r.pos === plan.pos || (plan.pos === 'O' && /QB|RB|WR|TE/.test(r.pos)); }).length !== offset)) {
    // not where the plan says: start this position from the top
    st.rows = st.rows.filter(function (r) { return !(r.pos === plan.pos || (plan.pos === 'O' && /QB|RB|WR|TE/.test(r.pos))); });
    save(st); go(plan.pos, 0); return 'restarting ' + plan.pos;
  }
  var rows = readPage().map(toPlayer);
  st.rows = st.rows.concat(rows);
  var have = st.rows.filter(function (r) { return r.pos === plan.pos || (plan.pos === 'O' && /QB|RB|WR|TE/.test(r.pos)); }).length;
  if (rows.length >= 25 && have < plan.max) { save(st); go(plan.pos, have); return 'next page'; }
  st.step += 1; save(st);
  if (PLAN[st.step]) { go(PLAN[st.step].pos, 0); return 'next position'; }
  // done: show the JSON
  var doc = { source: 'yahoo_league_players_page', league_id: LEAGUE, scoring: 'Harvey Cup (Yahoo scored)',
              fetched: new Date().toISOString().slice(0, 10), players: st.rows };
  localStorage.removeItem('hcYahooScrape');
  var text = JSON.stringify(doc);
  try { localStorage.setItem('hcYahooProjJSON', text); } catch (e) {}
  showJSON(text);
  return 'done: ' + st.rows.length + ' players; copy the JSON to data/sources/yahoo_league_proj.json';

  function showJSON(text) {
    var pre = document.getElementById('hc-yahoo-json') || document.createElement('pre');
    pre.id = 'hc-yahoo-json';
    pre.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;overflow:auto;background:#fff;color:#000;z-index:2147483647;font:11px monospace;white-space:pre-wrap;word-break:break-all';
    pre.textContent = text;
    document.body.appendChild(pre);
  }
})();
