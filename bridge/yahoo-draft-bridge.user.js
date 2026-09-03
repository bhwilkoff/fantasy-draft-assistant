// ==UserScript==
// @name         Harvey Cup Draft Advisor (Yahoo bridge)
// @namespace    https://github.com/bhwilkoff/fantasy-draft-assistant
// @version      1.0.0
// @description  Reads the live Yahoo draft room DOM and overlays VOR-based advice
// @match        https://football.fantasysports.yahoo.com/draftclient/*
// @match        https://football.fantasysports.yahoo.com/f1/*/draft*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @connect      localhost
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
    lastSig: '', collapsed: false, ambiguous: [],
    claudeNote: null, relayUp: null
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
  function textOf(el) { return (el && el.textContent ? el.textContent : '').trim(); }

  /* Split a player cell into its text parts WITHOUT forcing layout.
   *
   * The obvious approach -- innerText.split('\n') -- relies on layout to
   * produce the line breaks, so it forces a reflow PER CELL. readRows() runs
   * over 100+ cells on every tick, which meant 100+ forced layouts per pass
   * on an already-heavy React app. That is the reflow storm that made the
   * draft client stop answering.
   *
   * The cell's parts are separate child elements, so read their textContent
   * directly: same data, no layout. Falls back to a whitespace split for
   * cells that have no element children. */
  function cellParts(el) {
    if (!el) return [];
    /* Collect LEAF elements, not direct children.
     *
     * First cut used el.children, which breaks the moment the cell nests --
     * one wrapper child collapses to a single blob, and textContent joins
     * with no separator ("T. HigginsWRCinBye 6"), so the position never
     * parses and every row is skipped. Walk to the leaves instead: those are
     * the actual text spans, in document order, still layout-free. */
    var out = [], stack = [el], seen = 0;
    while (stack.length && seen < 400) {
      var n = stack.shift(); seen++;
      var kids = n.children;
      if (!kids || !kids.length) {
        var t = (n.textContent || '').trim();
        if (t) out.push(t);
      } else {
        for (var i = kids.length - 1; i >= 0; i--) stack.unshift(kids[i]);
      }
    }
    if (out.length) return out;
    return String(el.textContent || '').split('\n')
      .map(function (s) { return s.trim(); }).filter(Boolean);
  }


  function readStatus() {
    // "Eric Hollinger's Pick • You're up in 5 Picks • Round 3, Pick 33"
    //
    // Read the ROOM, not ourselves. Our own panel renders "Round R, pick P",
    // so scanning document.body.innerText makes the parser consume its own
    // output -- a feedback loop that would happily pin the pick number to a
    // stale value forever. Subtract the overlay's text before parsing.
    /* PERFORMANCE, not cosmetics: `document.body.innerText` forces a full
     * layout of the page. This runs on every observed mutation, and the draft
     * room mutates once a second just from the pick clock -- so reading the
     * whole body here was triggering a reflow storm on a heavy React app for
     * the entire draft. That is the most likely cause of the renderer going
     * unresponsive part-way through every run.
     *
     * Cache the smallest element that actually contains the status line and
     * read only that. Fall back to the body scan only when the cache misses. */
    var body = '';
    if (state.statusEl && document.contains(state.statusEl)) {
      body = state.statusEl.textContent || '';
    }
    if (!/Round\s+\d+,\s*Pick\s+\d+/i.test(body)) {
      // textContent needs no layout; innerText forces a full reflow and is
      // slow enough here to time out the caller.
      var host = document.querySelector('#root, #app, [data-reactroot]') || document.body;
      var full = (host && host.textContent) || '';
      var panel = document.getElementById('hc-advisor');
      if (panel && panel.textContent) full = full.split(panel.textContent).join(' ');
      body = full;
      // find and cache a compact host for next time
      var cands = [].slice.call(document.querySelectorAll('div,section,header'))
        .filter(function (e) {
          if (e.id === 'hc-advisor' || e.closest('#hc-advisor')) return false;
          if (e.children.length > 12) return false;
          var t = e.textContent || '';
          return t.length < 600 && /Round\s+\d+,\s*Pick\s+\d+/i.test(t);
        });
      if (cands.length) state.statusEl = cands[cands.length - 1];
    }
    var out = { round: null, pick: null, upIn: null, onClock: null, clock: null };
    /* Take the HIGHEST "Round R, Pick P" on the page, not the first.
     *
     * The draft room renders that phrase in more than one place (the live
     * header, and historical rows in the Picks / Round-by-Round views), so
     * matching the first occurrence can pin us to a stale pick. Observed
     * live: the header read "Round 2, Pick 28" while readStatus kept
     * reporting pick 22, which silently corrupts the next-pick estimate and
     * therefore every survival probability. The current pick is always the
     * largest one present. */
    var best = null, re = /Round\s+(\d+),\s*Pick\s+(\d+)/gi, mm;
    while ((mm = re.exec(body)) !== null) {
      var pk = +mm[2];
      if (best === null || pk > best.pick) best = { round: +mm[1], pick: pk };
    }
    if (best) { out.round = best.round; out.pick = best.pick; }
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
      var parts = cellParts(pe);
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
    /* The order never changes during a draft, and reading it is the most
     * expensive thing the bridge does late in one: the strip holds a cell
     * per PICK (180 in a 12x15 room), and the first version cloned every
     * cell on every pass -- 6.9 s in one pass of mock 10504003. Read it
     * once per strip size and keep it. */
    var n0 = parent.children.length;
    if (state.orderCache && state.orderCache.n === n0 && state.orderCache.order.length >= 4) {
      return state.orderCache.order;
    }
    // The strip repeats the whole order once per ROUND, so its raw length is
    // teams x rounds. Taking it at face value set numTeams to 210, which made
    // replacement level the 210th-best quarterback (~0 points) and handed
    // every QB an enormous VOR -- the advisor then recommended quarterbacks
    // from round 4 on. Dedupe to the first cycle of unique names.
    /* The strip renders the pick ORDER, which is a snake: the second round
     * is the first reversed. (In some rooms each cell also carries the
     * drafted player; the team name is the cell's text once any player
     * element is removed.) The team count n is therefore the smallest n for
     * which round two mirrors round one -- names[n + i] === names[n - 1 - i]
     * -- or, for a strip that repeats plainly, the smallest period. Never
     * dedupe by name: two managers can share one (two "anthony" in mock
     * 10430908), and 11 teams in a 12-team room shifts every pick number. */
    // the team name is the cell's text with any drafted player's card
    // excluded -- walk the text nodes, skipping .ys-player subtrees; no
    // cloning, no layout
    function cellName(c) {
      var out = '';
      // numeric constants: SHOW_TEXT = 4, FILTER_ACCEPT = 1, FILTER_REJECT = 2
      // (NodeFilter is not a global in every environment the tests run in)
      var walker = document.createTreeWalker(c, 4, {
        acceptNode: function (node) {
          var p = node.parentElement;
          while (p && p !== c) {
            if (p.classList && p.classList.contains('ys-player')) return 2;
            p = p.parentElement;
          }
          return 1;
        }
      });
      var t;
      while ((t = walker.nextNode())) { out += t.nodeValue; if (out.length > 80) break; }
      return out.trim().split('\n')[0];
    }
    var names = [].slice.call(parent.children).map(cellName).filter(Boolean);
    var n = names.length;
    if (n === 0) return [];
    var found = null;
    for (var k = 4; k <= 20 && 2 * k <= n && !found; k++) {
      var mirror = true, plain = true;
      for (var i = 0; i < k && k + i < n; i++) {
        if (names[k + i] !== names[k - 1 - i]) mirror = false;
        if (names[k + i] !== names[i]) plain = false;
        if (!mirror && !plain) break;
      }
      if (mirror || plain) found = names.slice(0, k);
    }
    if (found) { state.orderCache = { n: n0, order: found }; return found; }
    // only one round rendered and no period visible: take what is there
    return names.slice(0, Math.min(n, 20));
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

      var parts = cellParts(pe);
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

  /* ---------------------------------------------------------------- relay */
  /* The engine values players; it cannot read a beat writer or notice that
   * the room has started panicking at quarterback. tools/draft_server.py is a
   * localhost relay: we push state, a Claude Code session reads it, thinks,
   * and writes a short note back which we render beside the recommendation.
   *
   * A page on https:// cannot fetch http://127.0.0.1 directly, so this needs
   * the userscript's GM_xmlhttpRequest. Without it the relay is simply off
   * and the overlay still works -- it is an enhancement, never a dependency.
   */
  var RELAY = 'http://127.0.0.1:8830';

  function relay(method, path, body, cb) {
    try {
      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({
          method: method, url: RELAY + path,
          headers: { 'Content-Type': 'application/json' },
          data: body ? JSON.stringify(body) : undefined,
          onload: function (r) {
            state.relayUp = true;
            if (cb) { try { cb(JSON.parse(r.responseText)); } catch (e) {} }
          },
          onerror: function () { state.relayUp = false; }
        });
        return;
      }
      fetch(RELAY + path, {
        method: method, mode: 'cors',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
      }).then(function (r) { return r.json(); })
        .then(function (j) { state.relayUp = true; if (cb) cb(j); })
        .catch(function () { state.relayUp = false; });
    } catch (e) { state.relayUp = false; }
  }

  function pollNote() {
    relay('GET', '/note', null, function (j) {
      if (j && j.text && j.text !== (state.claudeNote || {}).text) {
        state.claudeNote = j;
        render(true);
      }
    });
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

    /* The league is derived at boot, but the draft client renders
     * asynchronously -- arming a few seconds early means readDraftOrder()
     * finds nothing and numTeams silently falls back to 12. In a 14-team room
     * that mis-prices every replacement level. So if we booted on fallbacks,
     * re-derive as soon as the room is actually on screen. */
    /* Re-derive when EITHER the team count was a fallback, or the roster
     * string has since become available.
     *
     * The draft client never prints "Roster Positions" -- only the waiting
     * room does -- so the league boots on a fallback roster with the wrong
     * bench and WR count, and roster size drives the gate that finally allows
     * a kicker and defense. The harvester reads the true slots off the
     * Results tab and publishes them as __hcRosterText; pick that up as soon
     * as it appears instead of requiring someone to set it by hand. */
    var rosterTextChanged = window.__hcRosterText
      && state.league && state.league.rosterText !== window.__hcRosterText;
    if (state.league
        && (state.league.teamsFrom === 'fallback' || rosterTextChanged)
        && document.querySelector('.ys-draftorder-current')) {
      applyDetectedLeague(state.data);
      state.index = buildIndex(state.data.players);
      window.__hcIndex = state.index;
      window.__hcLeagueSummary = {
        scoring: state.league.scoring.name,
        detectedFrom: state.league.detectedFrom,
        counts: state.league.counts,
        roster: state.league.roster
      };
      force = true;
    }

    var st = readStatus();
    /* Final round, no autopilot (the real draft): harvest every roster with
     * Yahoo's projections while the room is still alive, then write the
     * league-wide report (bridge/report.js). The autopilot does the same in
     * mocks; never twice. */
    if (!window.__hcAuto && !state.finalHarvestStarted && st.pick && state.league
        && state.league.numTeams && window.__hcHarvest) {
      var slotsN = (state.league.rosterText || '').split(/[,/]/).filter(Boolean).length || 15;
      var totalN = state.league.numTeams * slotsN;
      if (st.pick >= totalN - state.league.numTeams) {
        state.finalHarvestStarted = true;
        Promise.resolve(window.__hcYahooProj ? window.__hcYahooProj() : null)
          .then(function () { return window.__hcHarvest(); })
          .then(function (h) {
            try { localStorage.setItem('hcFinalHarvest', JSON.stringify(h)); } catch (e) {}
            try { if (window.__hcReport) state.report = window.__hcReport(h); } catch (e) { state.reportError = String(e); }
            var pl = [].slice.call(document.querySelectorAll('button,a,div,span,li'))
              .filter(function (x) { return x.children.length === 0; })
              .find(function (x) { return (x.innerText || '').trim() === 'Players'; });
            if (pl) pl.click();
          })
          .catch(function (e) { state.reportError = String(e); });
      }
    }
    var av = readAvailable();
    var sig = [st.pick, st.upIn, av.rows.length, state.myTeam,
               (window.__hcAuto && window.__hcAuto.passSeq) || 0].join('|');
    if (!force && sig === state.lastSig) return;
    state.lastSig = sig;

    // While the autopilot is re-reading rosters from the Results tab, the
    // players table is not on screen -- say so instead of telling the
    // human to fix a filter the harness itself is about to restore.
    var harvesting = !!(window.__hcAuto && window.__hcAuto.reseeding);
    if (!av.rows.length) {
      el.body.innerHTML = harvesting
        ? '<div class="clk">Reading rosters from the Results tab…</div>'
        : '<div class="err">No player table found. '
          + 'Open the “Players” view in the draft room.</div>';
      return;
    }
    if (harvesting && av.rows.length < 25) return;   // keep the last good panel

    /* When the autopilot has a fresh result, the panel renders it and does
     * not rebuild the pool or run advise() itself -- that doubled the work
     * of every pass and, on our own turn, helped freeze the room. */
    var APf = window.__hcAuto, apFresh = !!(APf && APf.lastRes && APf.last && APf.last.ts
                                            && Date.now() - APf.last.ts < 15000);
    var pool = [], unmatched = 0;
    state.ambiguous = [];
    if (!apFresh) {
      av.rows.forEach(function (r) {
        var p = lookup(r.name, r.pos, r.team, r.adp);
        if (p) pool.push(p); else unmatched++;
      });
    } else {
      unmatched = APf.last.unmatched || 0;
    }

    var roster = readMyRoster(av.rows).map(function (r) {
      return lookup(r.name, r.pos, r.team, r.adp)
        || { name: r.name, pos: r.pos, vor: 0, points: 0 };
    });

    var cur = st.pick || 1;
    var next = cur + (st.upIn != null ? Math.max(1, st.upIn) : 12);
    var res = apFresh ? APf.lastRes : window.HarveyCup.advise(pool, roster, cur, next, []);
    var rec = res.recommendation;
    /* When the autopilot is running, show ITS result -- the roster it
     * reconstructed from the pick log and reseeds, the advice it queued and
     * will click -- not a second opinion from a second roster read. Only
     * when fresh; a stalled autopilot must not pin the panel. */
    var AP = window.__hcAuto, fromAutopilot = false;
    if (AP && AP.lastRes && AP.last && AP.last.ts && Date.now() - AP.last.ts < 15000) {
      res = AP.lastRes; rec = res.recommendation;
      if (AP.lastRoster) roster = AP.lastRoster;
      fromAutopilot = true;
    }

    var h = [];
    h.push('<div class="clk">'
      + (st.upIn === 0 ? '<b style="color:#7ee2a8">YOU ARE ON THE CLOCK</b>'
        : 'Up in <b>' + esc(st.upIn) + '</b> picks')
      + (st.clock ? ' · ' + esc(st.clock) : '')
      + '<br>Round ' + esc(st.round) + ', pick ' + esc(st.pick)
      + ' · next at ~' + next
      + ' · re-ranked ' + new Date().toTimeString().slice(0, 8)
      + (fromAutopilot ? ' · autopilot pass ' + AP.passSeq : '') + '</div>');

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
      var full = state.index && (state.index[window.HarveyCup.roomKey(
        rec.name, rec.pos, rec.team)] || []).filter(function (x) {
          return x.name === rec.name; })[0];
      if (full && full.ceiling) {
        why.push('range ' + Math.round(full.floor) + '-' + Math.round(full.ceiling)
          + (full.sigma_frac > 0.55 ? ' <span class="warn">(high variance)</span>' : ''));
      }
      // per-source disagreement: one forecaster's optimism is information,
      // not valuation (DECISIONS 016)
      if (full && full.points_espn != null) {
        var srcs = [['ESPN', full.points_espn], ['Sleeper', full.points_sleeper],
                    ['CBS', full.points_cbs], ['Sharks', full.points_sharks]]
          .filter(function (x) { return x[1] != null; });
        var vals = srcs.map(function (x) { return x[1]; });
        var spread = vals.length > 1 ? Math.max.apply(null, vals) - Math.min.apply(null, vals) : 0;
        var line = srcs.map(function (x) { return x[0] + ' ' + Math.round(x[1]); }).join(' / ')
          + (spread >= 30 ? ' <span class="warn">(sources split by ' + Math.round(spread) + ')</span>' : '');
        if (full.points_yahoo != null && full.yahoo_delta != null) {
          var pct = Math.round(full.yahoo_delta * 100);
          line += ' · Yahoo ' + Math.round(full.points_yahoo)
            + (Math.abs(pct) >= 15 ? ' <span class="warn">(we are ' + (pct > 0 ? '+' : '') + pct + '% vs Yahoo)</span>'
                                   : ' (' + (pct > 0 ? '+' : '') + pct + '%)');
        }
        why.push(line);
      }
      if (full && full.injury && String(full.injury).toLowerCase() !== 'active') {
        // the body part is the part a multiplier cannot interpret
        why.push('<span class="warn">' + esc(full.injury)
          + (full.injury_body_part ? ' - ' + esc(full.injury_body_part) : '')
          + '</span>');
      }
      h.push('<div class="rec"><div class="nm">' + esc(rec.name)
        + ' <span class="pill">' + esc(rec.pos) + (rec.team ? ' · ' + esc(rec.team) : '')
        + (rec.bye ? ' · bye ' + esc(rec.bye) : '') + '</span></div>'
        + '<div class="wy">' + why.join(' · ') + '</div></div>');
    }

    if (state.claudeNote && state.claudeNote.text) {
      var stale = state.claudeNote.pick != null && st.pick != null
                && state.claudeNote.pick < st.pick - 2;
      h.push('<h4>Claude' + (stale ? ' <span class="warn">(stale)</span>' : '')
        + '</h4><div style="background:#161a22;border:1px solid #2a2f3a;'
        + 'border-radius:8px;padding:8px;font-size:12px;color:'
        + (stale ? '#7a8494' : '#dfe5ec') + '">'
        + esc(state.claudeNote.text) + '</div>');
    }

    /* When the autopilot is running, show THE LIST THE QUEUE HOLDS, in
     * order, so the panel and Yahoo's queue read the same (the user asked
     * why they differed: the queue is sequential -- entry k is the pick if
     * entries 1..k-1 are gone -- while "Then" was a flat ranking). */
    var plan = (window.__hcAuto && window.__hcAuto.plan) || null;
    if (plan && plan.length) {
      var surv = {};
      res.alternatives.forEach(function (a) { surv[a.name] = a.survival_next; });
      if (rec) surv[rec.name] = rec.survival_next;
      if (AP.lastBoardPick) {
        var lb = AP.lastBoardPick, pc = AP.planChange;
        h.push('<div class="clk" style="margin-top:6px">Off the board: <b>' + esc(lb.name)
          + '</b> ' + esc(lb.pos) + ' (pick ' + lb.pick + ', ' + esc(lb.drafter || '?')
          + (lb.dt != null ? ', ' + lb.dt + 's' : '') + ')'
          + (pc && pc.at >= (AP.last ? AP.last.pick - 1 : 0) && (pc.gone.length || pc.came.length)
              ? '<br>Plan adjusted at pick ' + pc.at
                + (pc.gone.length ? ': &minus;' + esc(pc.gone.join(', ')) : '')
                + (pc.came.length ? ' +' + esc(pc.came.join(', ')) : '')
              : '<br>Plan unchanged by that pick')
          + '</div>');
      }
      h.push('<h4>Queue (in order; entry k if 1..k-1 are gone)</h4>');
      plan.forEach(function (a, i) {
        h.push('<div class="alt"><span class="l">' + (i + 1) + '. ' + esc(a.name)
          + ' <span class="pill">' + esc(a.pos) + '</span></span>'
          + '<span class="r">vor ' + (a.vor || 0).toFixed(0)
          + (surv[a.name] != null ? ' · ' + Math.round(surv[a.name] * 100) + '% back' : '')
          + '</span></div>');
      });
    } else if (res.alternatives.length) {
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
      + ' · data ' + esc((state.data.meta.generated_at || '').slice(0, 16))
      + ' · relay ' + (state.relayUp === true ? 'on'
                       : state.relayUp === false ? '<span class="warn">off</span>' : '?') + '</div>');

    el.body.innerHTML = h.join('');

    if (rec && st.pick != null && st.pick !== state.lastPushed) {
      state.lastPushed = st.pick;
      relay('POST', '/state', {
        source: 'overlay', pick: st.pick, round: st.round, upIn: st.upIn,
        clock: st.clock, onClock: st.onClock,
        league: window.__hcLeagueSummary || null,
        recommendation: rec, alternatives: res.alternatives,
        position_view: res.position_view, rosterNeeds: res.roster,
        roster: roster.map(function (p) {
          return { name: p.name, pos: p.pos, points: p.points, vor: p.vor,
                   bye: p.bye, injury: p.injury }; }),
        candidates: res.alternatives.concat([rec]).map(function (a) {
          var full = (state.index[window.HarveyCup.roomKey(a.name, a.pos, a.team)] || [])
            .filter(function (x) { return x.name === a.name; })[0] || {};
          return { name: a.name, pos: a.pos, team: a.team, vor: a.vor,
                   adp: a.adp, edge: a.edge, tier: a.tier,
                   survival_next: a.survival_next,
                   ceiling: full.ceiling, floor: full.floor,
                   sigma_frac: full.sigma_frac, injury: full.injury,
                   injury_body_part: full.injury_body_part }; }),
        poolSize: pool.length
      });
    }
  }

  /* Decide which rulebook this room is playing under, then re-derive points,
   * replacement level and VOR for it. */
  function applyDetectedLeague(j) {
    var L = window.HarveyLeague;
    var det = readLeagueSettings();
    var isMock = /\/draftclient\/f1\/\d{7,}\//.test(location.pathname)
              || /mock/i.test(location.href);
    // The data plane carries the configured league (config/league.json via
    // engine/build.py), so a real room runs exactly the rules the engine was
    // built with; only a mock falls back to Yahoo's defaults.
    var cfg = (j.meta && j.meta.league) || {};
    /* A copy of OUR league is our league. Yahoo's instant mock of Harvey
     * Cup runs under a fresh mock id but names the league in the room
     * header ("Harvey Cup - Mock Draft"); it drafts 17 rounds under our
     * scoring, and is the only rehearsal that does. Detect the configured
     * league's name in the room, or take an explicit override:
     * localStorage.hcLeagueOverride = 'config' (our rules) | 'mock' (Yahoo). */
    var override = null;
    try { override = localStorage.getItem('hcLeagueOverride'); } catch (e) {}
    var headText = (document.title || '') + ' ' + ((document.querySelector('header, h1, [class*="header"]') || {}).textContent || '');
    var namedOurs = !!(cfg.name && headText.toLowerCase().indexOf(String(cfg.name).toLowerCase()) >= 0);
    if (override === 'config' || (override !== 'mock' && namedOurs)) isMock = false;
    state.leagueByName = namedOurs;
    // a Yahoo mock is always 15 slots: 9 starters and 6 bench. Without the
    // bench the roster size read 9 and the K/DEF gate opened in round 6.
    var rosterText = det.rosterText
      || (isMock ? 'QB,WR,WR,RB,RB,TE,W/R/T,K,DEF,BN,BN,BN,BN,BN,BN'
                 : (cfg.roster_text || 'QB,WR,WR,WR,RB,RB,TE,W/T,W/R,K,DEF,BN,BN,BN,BN,BN,BN'));
    var roster = L.parseRoster(rosterText);
    if (!roster.starters) roster = L.parseRoster('QB,WR,WR,RB,RB,TE,W/R/T,K,DEF');
    // The draft client never prints "Roster Positions" (only the waiting room
    // does), so without this we silently run on the fallback -- which has no
    // bench and the wrong WR count.
    if (window.__hcRosterText) {
      var fromRoom = L.parseRoster(window.__hcRosterText);
      if (fromRoom.starters) { roster = fromRoom; rosterText = window.__hcRosterText; }
    }
    var scoring = isMock ? L.SCORING_PRESETS.yahoo_default
                         : (cfg.scoring || L.SCORING_PRESETS.harvey_cup);
    // Guard the range as well: a bad read must never silently become a
    // 210-team league again.
    var numTeams = det.numTeams;
    if (!numTeams || numTeams < 4 || numTeams > 20) numTeams = cfg.teams || 12;
    state.league = L.applyLeague(j.players, {
      roster: roster, scoring: scoring, numTeams: numTeams
    });
    state.league.detectedFrom = (det.rosterText || window.__hcRosterText)
      ? 'room' : (isMock ? 'fallback' : (override === 'config' ? 'override' : (namedOurs ? 'league name' : 'config')));
    state.league.rosterText = rosterText;
    // teach the advisor how many picks this league actually has
    if (window.HarveyCup && window.HarveyCup.setRosterSize) {
      window.HarveyCup.setRosterSize(window.HarveyCup.rosterSizeFrom(roster));
    }
    // ... and what shape its lineup is, so a 2-WR / one-flex mock is not
    // drafted as if it were Harvey Cup's 3-WR / two-flex
    if (window.HarveyCup && window.HarveyCup.setLineup) {
      window.HarveyCup.setLineup(roster);
    }
    state.league.teamsFrom = det.numTeams ? 'room' : 'fallback';
    window.__hcLeague = state.league;
    state.league.isMock = isMock;
  }

  /* ----------------------------------------------------------------- boot */
  function boot() {
    buildPanel();
    var base = DATA_URL.replace(/data\/players\.json$/, '');
    /* If arm.js already loaded league.js and advisor.js (fresh, with a
     * cache-buster), do NOT load them again. GitHub Pages serves with a
     * ten-minute max-age, so a bare URL here fetched a STALE cached copy
     * that silently overwrote the fresh one -- a fix pushed and re-armed
     * mid-draft was in the page for about a second. Load only what is
     * missing, and always with a cache-buster. */
    var v = '?v=' + Date.now();
    function need(rel, present, next) {
      if (present) { next(); return; }
      var s = document.createElement('script');
      s.src = base + rel + v;
      s.onload = next;
      s.onerror = function () {
        el.body.innerHTML = '<div class="err">Could not load ' + esc(rel)
          + ' from ' + esc(base) + '</div>';
      };
      document.head.appendChild(s);
    }
    need('web/league.js', !!window.HarveyLeague, function () {
      need('web/advisor.js', !!window.HarveyCup, loadData);
    });
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
        /* Rate-limit with a timestamp rather than a timer: setTimeout is
         * throttled to ~1/min in a hidden tab, but Date.now() is not, so this
         * bounds the work without depending on scheduling we do not get. */
        var lastRender = 0;
        new MutationObserver(function () {
          var now = Date.now();
          if (now - lastRender < 1200) return;
          lastRender = now;
          render(false);
        }).observe(document.body, { childList: true, subtree: true });
        setInterval(function () { render(false); }, 3000);
        setInterval(pollNote, 4000);
        pollNote();
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
  // profiled wrappers (web/league.js supplies __hcProf; absent in the
  // fixture test, where the bridge is loaded alone)
  function prof(name, fn) { return window.__hcProf ? window.__hcProf(name, fn) : fn(); }
  var _readStatus = readStatus, _readAvailable = readAvailable,
      _readDraftOrder = readDraftOrder, _readMyRoster = readMyRoster, _render = render;
  readStatus = function () { return prof('readStatus', _readStatus); };
  readAvailable = function () { return prof('readAvailable', _readAvailable); };
  readDraftOrder = function () { return prof('readDraftOrder', _readDraftOrder); };
  readMyRoster = function (a) { return prof('readMyRoster', function () { return _readMyRoster(a); }); };
  render = function (f) { return prof('render', function () { return _render(f); }); };
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
