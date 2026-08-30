// ==UserScript==
// @name         Harvey Cup Draft Advisor (Yahoo bridge)
// @namespace    https://github.com/bhwilkoff/fantasy-draft-assistant
// @version      1.0.0
// @description  Reads the live Yahoo draft room DOM and overlays VOR-based advice
// @match        https://football.fantasysports.yahoo.com/draftclient/*
// @match        https://football.fantasysports.yahoo.com/f1/*/draft*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/* Why the DOM and not the WebSocket:
 * the draft client opens a single socket during page load, so any hook we
 * install has already lost the race, and there is no XHR polling to read
 * instead (verified live -- see docs/YAHOO-DRAFT-ROOM-RECON.md). The DOM is
 * authoritative, needs no credentials, and updates the moment a pick lands.
 *
 * Yahoo ships hashed CSS-in-JS class names (_ys_17wruqx) that churn on every
 * deploy. We bind ONLY to the stable semantic hooks (.ys-player[data-id],
 * .ys-draftorder-current) and to text shape, never to a hashed class.
 */
(function () {
  'use strict';
  if (window.__harveyCupBridge) return;
  window.__harveyCupBridge = true;

  var DATA_URL = 'https://bhwilkoff.github.io/fantasy-draft-assistant/data/players.json';
  var LOCAL_KEY = 'harveyCupTeam';

  var state = {
    data: null, index: null, error: null, league: null,
    myTeam: localStorage.getItem(LOCAL_KEY) || null,
    lastSig: '', collapsed: false, ambiguous: []
  };

  /* Name matching lives in web/advisor.js so the bridge, the standalone
   * board and the parity test all use one implementation. */
  function buildIndex(players) { return window.HarveyCup.buildIndex(players); }
  function lookup(name, pos, team, adpHint) {
    var r = window.HarveyCup.lookup(state.index, name, pos, team, adpHint);
    if (r.ambiguous) state.ambiguous.push(name + ' -> ' + (r.candidates || []).join('/'));
    return r.player;
  }

  /* ----------------------------------------------------------- DOM reading */
  function textOf(el) { return (el && el.innerText ? el.innerText : '').trim(); }

  function readStatus() {
    // "Eric Hollinger's Pick • You're up in 5 Picks • Round 3, Pick 33"
    var body = document.body.innerText || '';
    var out = { round: null, pick: null, upIn: null, onClock: null, clock: null };
    var m = body.match(/Round\s+(\d+),\s*Pick\s+(\d+)/i);
    if (m) { out.round = +m[1]; out.pick = +m[2]; }
    var u = body.match(/You'?re up in\s+(\d+)\s+Pick/i);
    if (u) {
      out.upIn = +u[1];
    } else if (/^YOUR TURN/i.test(document.title)) {
      // Only the on-the-clock title starts with it ("YOUR TURN, DRAFT NOW").
      // Matching /YOUR TURN/ anywhere is wrong: the waiting title reads
      // "8 picks until your turn", which made the overlay announce
      // "YOU ARE ON THE CLOCK" for the entire draft.
      out.upIn = 0;
    }
    var c = body.match(/\b(\d{1,2}:\d{2})\b/);
    if (c) out.clock = c[1];
    var cur = document.querySelector('.ys-draftorder-current');
    if (cur) out.onClock = textOf(cur).split('\n')[0];
    return out;
  }

  // The available-players table contains ONLY undrafted players, so it is the
  // source of truth for the pool -- we never reconstruct it from the feed.
  function readAvailable() {
    var tables = [].slice.call(document.querySelectorAll('table'));
    var best = null, bestN = 0;
    tables.forEach(function (t) {
      var n = t.querySelectorAll('.ys-player[data-id]').length;
      if (n > bestN) { bestN = n; best = t; }
    });
    if (!best) return { rows: [], table: null };
    var rows = [];
    [].slice.call(best.querySelectorAll('tr')).forEach(function (tr) {
      var pe = tr.querySelector('.ys-player[data-id]');
      if (!pe) return;
      var parts = textOf(pe).split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
      if (parts.length < 2) return;
      var name = parts[0];
      // optional injury tag sits between name and position: "J. Love|Q|RB|Ari"
      var rest = parts.slice(1).filter(function (s) { return !/^Bye/i.test(s); });
      var pos = null, team = null, injury = null;
      rest.forEach(function (s) {
        if (/^(QB|RB|WR|TE|K|DEF|D\/ST)$/i.test(s)) pos = s.toUpperCase().replace('D/ST', 'DEF');
        else if (/^[A-Za-z]{2,3}$/.test(s) && pos) team = s;
        else if (/^(Q|D|O|IR|SUSP|PUP|NA)$/i.test(s)) injury = s.toUpperCase();
      });
      if (!pos) return;
      // The room renders an ADP column; it is the only thing that separates
      // two same-initial, same-surname, same-position TEAMMATES (in 2026,
      // Bijan and Brian Robinson are both ATL running backs).
      var adp = null;
      var tr = pe.closest('tr');
      if (tr) {
        var headCells = [].slice.call(best.querySelectorAll('tr')[0].cells || []);
        var adpCol = -1;
        headCells.forEach(function (c, i) {
          if (/^ADP$/i.test(textOf(c))) adpCol = i;
        });
        if (adpCol >= 0 && tr.cells[adpCol]) {
          var v = parseFloat(textOf(tr.cells[adpCol]).replace(/[^0-9.]/g, ''));
          if (!isNaN(v)) adp = v;
        }
      }
      rows.push({ yid: pe.getAttribute('data-id'), name: name, pos: pos,
                  team: team, injury: injury, adp: adp });
    });
    return { rows: rows, table: best };
  }

  /* Read the room's OWN settings rather than assuming Harvey Cup's. A Yahoo
   * mock room runs default settings (QB/WR/WR/RB/RB/TE/W-R-T/K/DEF, half PPR,
   * 4pt passing TDs); optimising a mock with Harvey Cup's rules gives
   * confidently wrong advice, and the real league could also change. */
  function readLeagueSettings() {
    var body = document.body.innerText || '';
    var out = { rosterText: null, numTeams: null, ppr: null, passTd: null };

    var m = body.match(/Roster Positions\s*\n\s*([^\n]+)/i);
    if (m) out.rosterText = m[1];
    if (!out.rosterText) {
      // draft room: the roster rail renders one slot label per row
      var slots = [].slice.call(document.querySelectorAll('[class*=rosterslot],[class*=roster-slot]'))
        .map(function (e) { return textOf(e).split('\n')[0]; })
        .filter(function (t) { return /^(QB|RB|WR|TE|K|DEF|D\/ST|BN|W\/[RT]|W\/R\/T|Q\/W\/R\/T)$/i.test(t); });
      if (slots.length) out.rosterText = slots.join(',');
    }

    var order = readDraftOrder();
    if (order.length) out.numTeams = order.length;
    var pk = body.match(/Round\s+\d+,\s*Pick\s+(\d+)/i);

    // Scoring: the waiting room prints the stat categories; the draft room
    // does not, so fall back to the league default we were told to expect.
    if (/Receptions/i.test(body)) out.ppr = null;   // value not exposed here
    return out;
  }

  function readDraftOrder() {
    var cur = document.querySelector('.ys-draftorder-current');
    if (!cur) return [];
    var parent = cur.parentElement;
    if (!parent) return [];
    return [].slice.call(parent.children)
      .map(function (c) { return textOf(c).split('\n')[0]; })
      .filter(Boolean);
  }

  /* Roster: derive from the pick feed by team label. Yahoo labels our own
   * entry "You" in the order strip but uses the real team name in the feed,
   * so we let the user confirm once and remember it. */
  function readMyRoster(available) {
    var avail = {};
    available.forEach(function (r) { avail[r.yid] = 1; });
    var mine = [];
    var team = state.myTeam;
    if (!team) return mine;

    [].slice.call(document.querySelectorAll('.ys-player[data-id]')).forEach(function (pe) {
      if (avail[pe.getAttribute('data-id')]) return;   // still on the board

      // Walk up only as far as the element still describes THIS pick. The
      // moment an ancestor contains a second .ys-player we have left the
      // pick row and entered the feed, where a neighbouring pick's team
      // name would match and steal the player.
      var row = pe.parentElement, chosen = null;
      for (var i = 0; row && i < 6; i++, row = row.parentElement) {
        if (row.querySelectorAll('.ys-player[data-id]').length > 1) break;
        chosen = row;
      }
      if (!chosen) return;
      if (textOf(chosen).indexOf(team) < 0) return;

      var parts = textOf(pe).split('\n').map(function (s) { return s.trim(); })
                            .filter(Boolean);
      var pos = null, tm = null;
      parts.slice(1).filter(function (s) { return !/^Bye/i.test(s); })
           .forEach(function (s) {
        if (/^(QB|RB|WR|TE|K|DEF|D\/ST)$/i.test(s)) {
          pos = s.toUpperCase().replace('D/ST', 'DEF');
        } else if (/^[A-Za-z]{2,3}$/.test(s) && pos && !tm) { tm = s; }
      });
      if (pos) mine.push({ name: parts[0], pos: pos, team: tm });
    });
    return mine;
  }

  /* -------------------------------------------------------------- overlay */
  var el = {};
  function buildPanel() {
    var d = document.createElement('div');
    d.id = 'hc-advisor';
    d.innerHTML = [
      '<style>',
      '#hc-advisor{position:fixed;top:12px;right:12px;width:340px;z-index:2147483647;',
      'font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
      'background:#0f1115;color:#e8eaed;border:1px solid #2a2f3a;border-radius:10px;',
      'box-shadow:0 8px 28px rgba(0,0,0,.45);overflow:hidden}',
      '#hc-advisor .hd{display:flex;align-items:center;gap:8px;padding:8px 10px;',
      'background:#161a22;cursor:move;user-select:none}',
      '#hc-advisor .hd b{font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#9aa4b2}',
      '#hc-advisor .hd .sp{margin-left:auto;display:flex;gap:6px}',
      '#hc-advisor button{background:#222836;color:#cbd3df;border:1px solid #333b4a;',
      'border-radius:6px;padding:2px 7px;font-size:11px;cursor:pointer}',
      '#hc-advisor button:hover{background:#2c3444}',
      '#hc-advisor .bd{padding:10px;max-height:72vh;overflow:auto}',
      '#hc-advisor .clk{font-size:11px;color:#9aa4b2;margin-bottom:8px}',
      '#hc-advisor .rec{background:#12251a;border:1px solid #1f5133;border-radius:8px;padding:9px;margin-bottom:9px}',
      '#hc-advisor .rec .nm{font-size:16px;font-weight:700;color:#7ee2a8}',
      '#hc-advisor .rec .wy{font-size:11px;color:#a9b6c4;margin-top:4px}',
      '#hc-advisor .alt{display:flex;justify-content:space-between;gap:6px;padding:4px 0;border-top:1px solid #232a36}',
      '#hc-advisor .alt .l{color:#dfe5ec}#hc-advisor .alt .r{color:#8b95a3;font-size:11px;white-space:nowrap}',
      '#hc-advisor h4{margin:10px 0 4px;font-size:11px;color:#9aa4b2;text-transform:uppercase;letter-spacing:.04em}',
      '#hc-advisor table{width:100%;border-collapse:collapse;font-size:11px}',
      '#hc-advisor td{padding:2px 3px;border-top:1px solid #232a36;color:#c3ccd8}',
      '#hc-advisor .warn{color:#ffcc66}#hc-advisor .err{color:#ff8a80}',
      '#hc-advisor .pill{display:inline-block;background:#222836;border-radius:4px;padding:0 5px;font-size:10px;color:#9aa4b2;margin-left:4px}',
      '</style>',
      '<div class="hd"><b>Harvey Cup Advisor</b><span class="sp">',
      '<button id="hc-team">team</button><button id="hc-min">–</button></span></div>',
      '<div class="bd" id="hc-body">loading projections…</div>'
    ].join('');
    document.body.appendChild(d);
    el.root = d; el.body = d.querySelector('#hc-body');

    d.querySelector('#hc-min').onclick = function () {
      state.collapsed = !state.collapsed;
      el.body.style.display = state.collapsed ? 'none' : '';
      this.textContent = state.collapsed ? '+' : '–';
    };
    d.querySelector('#hc-team').onclick = function () {
      var order = readDraftOrder();
      var guess = prompt('Your team name exactly as the draft room shows it:\n\n'
        + order.join('\n'), state.myTeam || '');
      if (guess) { state.myTeam = guess.trim(); localStorage.setItem(LOCAL_KEY, state.myTeam); render(true); }
    };
    // drag
    var hd = d.querySelector('.hd'), dx = 0, dy = 0, drag = false;
    hd.addEventListener('mousedown', function (e) {
      drag = true; dx = e.clientX - d.offsetLeft; dy = e.clientY - d.offsetTop;
      e.preventDefault();
    });
    document.addEventListener('mousemove', function (e) {
      if (!drag) return;
      d.style.left = (e.clientX - dx) + 'px'; d.style.top = (e.clientY - dy) + 'px';
      d.style.right = 'auto';
    });
    document.addEventListener('mouseup', function () { drag = false; });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function render(force) {
    if (!state.data) return;
    var st = readStatus();
    var av = readAvailable();
    var sig = [st.pick, st.upIn, av.rows.length, state.myTeam].join('|');
    if (!force && sig === state.lastSig) return;
    state.lastSig = sig;

    if (!av.rows.length) {
      el.body.innerHTML = '<div class="err">No player table found. '
        + 'Open the “Players” view in the draft room.</div>';
      return;
    }

    var pool = [], unmatched = 0;
    state.ambiguous = [];
    av.rows.forEach(function (r) {
      var p = lookup(r.name, r.pos, r.team, r.adp);
      if (p) pool.push(p); else unmatched++;
    });

    var roster = readMyRoster(av.rows).map(function (r) {
      return lookup(r.name, r.pos, r.team, r.adp)
        || { name: r.name, pos: r.pos, vor: 0, points: 0 };
    });

    var cur = st.pick || 1;
    var next = cur + (st.upIn != null ? Math.max(1, st.upIn) : 12);
    var res = window.HarveyCup.advise(pool, roster, cur, next, []);
    var rec = res.recommendation;

    var h = [];
    h.push('<div class="clk">'
      + (st.upIn === 0 ? '<b style="color:#7ee2a8">YOU ARE ON THE CLOCK</b>'
        : 'Up in <b>' + esc(st.upIn) + '</b> picks')
      + (st.clock ? ' · ' + esc(st.clock) : '')
      + '<br>Round ' + esc(st.round) + ', pick ' + esc(st.pick)
      + ' · next at ~' + next + '</div>');

    if (!state.myTeam) {
      h.push('<div class="warn" style="margin-bottom:8px">Team not set — roster needs '
        + 'are being ignored. Click <b>team</b> above.</div>');
    }

    if (rec) {
      var why = [];
      why.push('VOR ' + rec.vor.toFixed(0) + ' (' + rec.points.toFixed(0) + ' pts, repl. baseline)');
      if (rec.adp) why.push('ADP ' + rec.adp);
      if (rec.edge != null && Math.abs(rec.edge) >= 8) {
        why.push('<span class="' + (rec.edge > 0 ? 'warn' : '') + '">'
          + (rec.edge > 0 ? 'market is ' + rec.edge + ' picks late on him' : 'going ' + (-rec.edge) + ' ahead of value')
          + '</span>');
      }
      why.push('tier ' + rec.tier + ', ' + rec.tier_players_left + ' left in tier');
      h.push('<div class="rec"><div class="nm">' + esc(rec.name)
        + ' <span class="pill">' + esc(rec.pos) + (rec.team ? ' · ' + esc(rec.team) : '')
        + (rec.bye ? ' · bye ' + esc(rec.bye) : '') + '</span></div>'
        + '<div class="wy">' + why.join(' · ') + '</div></div>');
    }

    if (res.alternatives.length) {
      h.push('<h4>Then</h4>');
      res.alternatives.forEach(function (a) {
        h.push('<div class="alt"><span class="l">' + esc(a.name)
          + ' <span class="pill">' + esc(a.pos) + '</span></span>'
          + '<span class="r">vor ' + a.vor.toFixed(0)
          + ' · ' + Math.round(a.survival_next * 100) + '% back</span></div>');
      });
    }

    h.push('<h4>Cost of waiting (to pick ' + next + ')</h4><table>');
    Object.keys(res.position_view).forEach(function (p) {
      var v = res.position_view[p];
      h.push('<tr><td><b>' + p + '</b></td><td>' + esc(v.best_now_player || '—')
        + '</td><td style="text-align:right">' + v.dropoff.toFixed(0) + '</td>'
        + '<td style="color:#7a8494">' + esc(v.likely_still_there || '—') + '</td></tr>');
    });
    h.push('</table>');

    var need = res.roster;
    h.push('<h4>Roster</h4><div style="font-size:11px;color:#9aa4b2">'
      + window.HarveyCup.POSITIONS.map(function (p) {
        return p + ' ' + need.counts[p] + (need.starterGap[p] ? '<span class="warn">/' + (need.counts[p] + need.starterGap[p]) + '</span>' : '');
      }).join(' · ')
      + ' · flex open ' + need.flexOpen + '</div>');

    if (pool.length < 25) {
      h.push('<div class="warn" style="margin-top:6px">Only ' + pool.length
        + ' players visible — clear any filter on the players table so the '
        + 'advisor can see the whole board.</div>');
    }
    h.push('<div style="margin-top:8px;font-size:10px;color:#6b7480">'
      + pool.length + ' available matched'
      + (unmatched ? ' · <span class="warn">' + unmatched + ' unmatched</span>' : '')
      + (state.ambiguous.length ? ' · <span class="warn">' + state.ambiguous.length
         + ' ambiguous: ' + esc(state.ambiguous.slice(0, 2).join('; ')) + '</span>' : '')
      + ' · ' + esc(state.league.scoring.name) + ' rules ('
      + esc(state.league.detectedFrom) + ')'
      + ' · WR' + state.league.counts.WR + ' RB' + state.league.counts.RB + ' start'
      + ' · data ' + esc((state.data.meta.generated_at || '').slice(0, 16)) + '</div>');

    el.body.innerHTML = h.join('');
  }

  /* Decide which rulebook this room is playing under, then re-derive points,
   * replacement level and VOR for it. */
  function applyDetectedLeague(j) {
    var L = window.HarveyLeague;
    var det = readLeagueSettings();
    var isMock = /\/draftclient\/f1\/\d{7,}\//.test(location.pathname)
              || /mock/i.test(location.href);
    var rosterText = det.rosterText
      || (isMock ? 'QB,WR,WR,RB,RB,TE,W/R/T,K,DEF'
                 : 'QB,WR,WR,WR,RB,RB,TE,W/T,W/R,K,DEF,BN,BN,BN,BN,BN,BN');
    var roster = L.parseRoster(rosterText);
    if (!roster.starters) roster = L.parseRoster('QB,WR,WR,RB,RB,TE,W/R/T,K,DEF');
    var scoring = isMock ? L.SCORING_PRESETS.yahoo_default
                         : L.SCORING_PRESETS.harvey_cup;
    var numTeams = det.numTeams || (isMock ? 12 : 12);
    state.league = L.applyLeague(j.players, {
      roster: roster, scoring: scoring, numTeams: numTeams
    });
    state.league.detectedFrom = det.rosterText ? 'room' : 'fallback';
    state.league.isMock = isMock;
  }

  /* ----------------------------------------------------------------- boot */
  function boot() {
    buildPanel();
    var base = DATA_URL.replace(/data\/players\.json$/, '');
    var s = document.createElement('script');
    s.src = base + 'web/league.js';
    s.onload = function () {
      var s2 = document.createElement('script');
      s2.src = base + 'web/advisor.js';
      s2.onload = loadData;
      s2.onerror = s.onerror;
      document.head.appendChild(s2);
    };
    s.onerror = function () {
      el.body.innerHTML = '<div class="err">Could not load advisor.js from '
        + esc(DATA_URL) + '</div>';
    };
    document.head.appendChild(s);
  }
  function loadData() {
    fetch(DATA_URL, { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) {
        state.data = j;
        applyDetectedLeague(j);
        state.index = buildIndex(j.players);
        // autopilot.js and any external driver reuse the same matcher index
        // and league read, so there is exactly one interpretation of the room.
        window.__hcIndex = state.index;
        window.__hcLeagueSummary = {
          scoring: state.league.scoring.name,
          detectedFrom: state.league.detectedFrom,
          counts: state.league.counts,
          roster: state.league.roster
        };
        render(true);
        new MutationObserver(function () { render(false); })
          .observe(document.body, { childList: true, subtree: true, characterData: true });
        setInterval(function () { render(false); }, 2000);
      })
      .catch(function (e) {
        el.body.innerHTML = '<div class="err">Could not load projections: '
          + esc(e.message) + '<br><br>Run <code>python3 engine/build.py</code> and '
          + 'push, or point DATA_URL at a local https host.</div>';
      });
  }

  // The DOM readers are the part that can silently rot when Yahoo redeploys,
  // so they are exposed for tests/dom_test.js to run against a fixture built
  // from the HTML actually observed in a live room.
  window.__hcReaders = {
    readStatus: readStatus, readAvailable: readAvailable,
    readDraftOrder: readDraftOrder, readMyRoster: readMyRoster,
    setState: function (k, v) { state[k] = v; }
  };

  if (window.__HC_TEST) return;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else { boot(); }
})();
