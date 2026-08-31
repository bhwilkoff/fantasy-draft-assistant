/* Autopilot: drive a Yahoo mock draft from the advisor, unattended.
 *
 * Purpose is harness validation and data collection, not cheating a real
 * league -- point it at mock rooms.
 *
 * It does NOT click a "Draft Player" button, because that button only exists
 * during our own 60-second window and a missed click means a lost pick.
 * Instead it keeps Yahoo's QUEUE synced to the advisor's current ranking and
 * turns Autodraft on. Yahoo then picks queue-top the instant our turn opens.
 * The queue is re-synced every few seconds, so it always reflects advice
 * computed against the CURRENT board -- this is the adaptive decision, not a
 * pre-draft cheat sheet.
 *
 * Re-arm after a page reload with:
 *   var s=document.createElement('script');
 *   s.src='https://bhwilkoff.github.io/fantasy-draft-assistant/bridge/autopilot.js?v='+Date.now();
 *   document.head.appendChild(s);
 */
(function () {
  'use strict';
  if (window.__hcAuto && window.__hcAuto.timer) { window.__hcAuto.rearmed = true; return; }

  var RELAY = 'http://127.0.0.1:8830';
  var LOG_KEY = 'hcAutopilotLog';
  var A = window.__hcAuto = {
    on: true, queued: {}, log: [], last: null, results: null,
    timer: null, autodraftOn: false, relay: true,
    picks: {}, numTeams: null,
    RATE_MS: 1500,         // floor between heavy passes; see schedule()
    QUEUE_DEPTH: 4         // keep the queue small so its ORDER stays correct
  };

  function T(e) { return (e && e.textContent ? e.textContent : '').trim(); }

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


  function biggestTable() {
    var ts = [].slice.call(document.querySelectorAll('table'));
    ts.sort(function (a, b) {
      return b.querySelectorAll('.ys-player[data-id]').length
           - a.querySelectorAll('.ys-player[data-id]').length;
    });
    return ts[0] && ts[0].querySelectorAll('.ys-player[data-id]').length ? ts[0] : null;
  }

  function readRows() {
    var t = biggestTable();
    if (!t) return [];
    var head = [].slice.call((t.querySelectorAll('tr')[0] || {}).cells || []);
    var adpCol = -1;
    head.forEach(function (c, i) { if (/^ADP$/i.test(T(c))) adpCol = i; });
    return [].slice.call(t.querySelectorAll('tr')).map(function (tr) {
      var pe = tr.querySelector('.ys-player[data-id]');
      if (!pe) return null;
      var parts = cellParts(pe);
      var pos = null, team = null;
      parts.slice(1).filter(function (s) { return !/^Bye/i.test(s); }).forEach(function (s) {
        if (/^(QB|RB|WR|TE|K|DEF|D\/ST)$/i.test(s)) pos = s.toUpperCase().replace('D/ST', 'DEF');
        else if (/^[A-Za-z]{2,3}$/.test(s) && pos && !team) team = s;
      });
      var adp = null;
      if (adpCol >= 0 && tr.cells[adpCol]) {
        var v = parseFloat(T(tr.cells[adpCol]).replace(/[^0-9.]/g, ''));
        if (!isNaN(v)) adp = v;
      }
      return pos ? { yid: pe.getAttribute('data-id'), name: parts[0],
                     pos: pos, team: team, adp: adp } : null;
    }).filter(Boolean);
  }

  /* Reconstruct the full pick log from the status area.
   *
   * The roster rail does not pair slot labels to drafted players, and the
   * Picks feed is virtualised (our own early picks scroll out of the DOM), so
   * neither can tell us what WE own. But the header always shows
   * "Last: <PLAYER> (POS - TEAM) <drafter>" alongside "Round R, Pick P", and
   * the player named there is pick P-1. Recording those as they land rebuilds
   * the whole draft -- including our roster, which is just the picks landing
   * on the numbers our snake slot owns. */
  function recordLastPick(st) {
    // textContent, not innerText: no layout, no reflow storm.
    var host = document.querySelector('#root, #app, [data-reactroot]') || document.body;
    var body = (host && host.textContent) || '';
    var m = body.match(/Last:\s*\n?\s*([^\n(]+)\n?\s*\(([A-Z/]+)\s*[·\-]\s*([A-Z]{2,3})\)\s*\n?\s*([^\n]+)/i);
    if (!m || st.pick == null) return;
    var pickNo = st.pick - 1;
    if (pickNo < 1) return;
    if (A.picks[pickNo]) return;
    A.picks[pickNo] = {
      pick: pickNo,
      name: m[1].trim(),
      pos: m[2].toUpperCase().replace('D/ST', 'DEF'),
      team: m[3].toUpperCase(),
      drafter: m[4].trim()
    };
  }

  function mySnakePicks(numTeams, slot, rounds) {
    var out = [];
    for (var r = 1; r <= (rounds || 20); r++) {
      out.push(r % 2 === 1 ? (r - 1) * numTeams + slot
                           : (r - 1) * numTeams + (numTeams - slot + 1));
    }
    return out;
  }

  /* Seed our roster from the Results tab once, at arm time.
   *
   * myRosterFromPicks() can only see picks that landed while we were armed.
   * Arming at round 6 therefore reported roster=0, so every position looked
   * like an unfilled starting slot and the advisor drafted FOUR tight ends
   * in one mock. The Results tab knows the truth regardless of when we
   * arrived, so read it once and merge. */
  A.seedRoster = null;
  A.seedRosterFromResults = async function () {
    try {
      var h = await window.__hcHarvest();
      if (h && h.teams && h.me && h.teams[h.me]) {
        A.seedRoster = h.teams[h.me].map(function (p) {
          return { name: p.name, pos: p.pos, team: p.team, seeded: true };
        });
      }
      var pl = [].slice.call(document.querySelectorAll('button,a,div,span,li'))
        .filter(function (x) { return x.children.length === 0; })
        .find(function (x) { return (x.innerText || '').trim() === 'Players'; });
      if (pl) pl.click();
    } catch (e) { A.seedError = String(e); }
    return A.seedRoster ? A.seedRoster.length : 0;
  };

  function myRosterFromPicks() {
    var m = location.pathname.match(/\/draftclient\/f1\/(\d+)\/(\d+)/);
    if (!m) return [];
    var slot = +m[2];
    var order = (function () {
      var cur = document.querySelector('.ys-draftorder-current');
      if (!cur || !cur.parentElement) return [];
      var seen = [];
      [].slice.call(cur.parentElement.children).forEach(function (c) {
        var n = (c.innerText || '').trim().split('\n')[0];
        if (n && seen.indexOf(n) < 0 && seen.length < 20) seen.push(n);
      });
      return seen;
    })();
    var numTeams = order.length || A.numTeams || 12;
    A.numTeams = numTeams;
    var mine = mySnakePicks(numTeams, slot, 20);
    var out = [];
    mine.forEach(function (pk) {
      if (A.picks[pk]) out.push(A.picks[pk]);
    });
    // The seed is authoritative for everything drafted before we armed;
    // the observed log covers everything since. Union by name.
    if (A.seedRoster && A.seedRoster.length) {
      /* Dedupe case-insensitively. The Results tab renders "T. Etienne Jr."
       * while the status header renders "T. ETIENNE JR.", so a plain name
       * comparison counted the same player twice -- four picks reported as
       * six, which inflates the roster and skews every positional need. */
      var norm = function (n) {
        return String(n || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      };
      var seen = {}, merged = [];
      A.seedRoster.concat(out).forEach(function (p) {
        var k = norm(p.name) + '|' + (p.pos || '');
        if (seen[k]) return;
        seen[k] = 1; merged.push(p);
      });
      return merged;
    }
    return out;
  }
  A.myRosterFromPicks = myRosterFromPicks;

  function enableAutodraft() {
    if (A.autodraftOn) return;
    var b = [].slice.call(document.querySelectorAll('button'))
      .find(function (x) { return /^autodraft$/i.test(T(x)); });
    if (b) { b.click(); A.autodraftOn = true; }
  }

  function post(path, obj) {
    if (!A.relay) return;
    try {
      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({ method: 'POST', url: RELAY + path,
          headers: { 'Content-Type': 'application/json' },
          data: JSON.stringify(obj), onerror: function () { A.relay = false; } });
      } else {
        fetch(RELAY + path, { method: 'POST', mode: 'cors',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(obj) }).catch(function () { A.relay = false; });
      }
    } catch (e) { A.relay = false; }
  }

  function tick() {
    if (!A.on) return;
    var HC = window.HarveyCup, R = window.__hcReaders, idx = window.__hcIndex;
    if (!HC || !R || !idx) return;

    /* If there is no player table we are on the wrong view (Results, Picks,
     * Board) -- usually because a seed or harvest switched tabs and the
     * switch back failed. Previously tick() just returned, silently, forever,
     * while __hcStatus still reported alive=yes. An instrument must say when
     * it is blind, and this one can also fix itself: click back to Players. */
    var rows = readRows();
    if (!rows.length) {
      A.blind = 'no player table (wrong view?)';
      var pl = [].slice.call(document.querySelectorAll('button,a,div,span,li'))
        .filter(function (x) { return x.children.length === 0; })
        .find(function (x) { return (x.innerText || '').trim() === 'Players'; });
      if (pl) { A.blindRecoveries = (A.blindRecoveries || 0) + 1; pl.click(); }
      return;
    }
    A.blind = null;
    var st = R.readStatus();
    recordLastPick(st);

    var pool = [], yidOf = {}, unmatched = 0;
    rows.forEach(function (r) {
      var m = HC.lookup(idx, r.name, r.pos, r.team, r.adp);
      if (m.player) { pool.push(m.player); yidOf[m.player.name] = r.yid; }
      else unmatched++;
    });

    // Prefer the reconstructed pick log; fall back to the DOM scrape.
    var raw = myRosterFromPicks();
    if (!raw.length) raw = R.readMyRoster(rows) || [];
    var roster = raw.map(function (r) {
      var m = HC.lookup(idx, r.name, r.pos, r.team);
      return m.player || { name: r.name, pos: r.pos, vor: 0, points: 0 };
    });

    var cur = st.pick || 1;
    var next = cur + (st.upIn != null ? Math.max(1, st.upIn) : 12);
    var res = HC.advise(pool, roster, cur, next, []);

    /* Keep the queue EXACTLY the current top N, in order.
     *
     * The first version only ever ADDED. Yahoo drafts queue[0], which is
     * whatever was queued first -- so by round 15 it was still drafting from
     * a queue built in round 2. Every roster came out looking nothing like
     * the advice: three quarterbacks, four tight ends, and no kicker or
     * defense even while the advisor was recommending one. The
     * recommendation was right the whole time; the queue ignored it.
     *
     * So: drop anything no longer in the top N, then add the top N in order.
     * Yahoo appends new stars to the end of the queue, which means clearing
     * first is what makes the order correct. */
    var want = [res.recommendation].concat(res.alternatives)
      .filter(Boolean).slice(0, A.QUEUE_DEPTH);
    var wantYids = {};
    want.forEach(function (w) { if (yidOf[w.name]) wantYids[yidOf[w.name]] = w.name; });

    var added = 0, removed = 0;
    // 1. unqueue anything stale (clicking the star again toggles it off)
    Object.keys(A.queued).forEach(function (yid) {
      if (wantYids[yid]) return;
      var star = document.querySelector('.ys-addqueue[data-id="' + yid + '"] button')
              || document.querySelector('.ys-addqueue[data-id="' + yid + '"]');
      if (star) { star.click(); removed++; }
      delete A.queued[yid];
    });
    // 2. add the wanted set in advice order, so queue[0] is the recommendation
    want.forEach(function (w) {
      var yid = yidOf[w.name];
      if (!yid || A.queued[yid]) return;
      var star = document.querySelector('.ys-addqueue[data-id="' + yid + '"] button')
              || document.querySelector('.ys-addqueue[data-id="' + yid + '"]');
      if (star) { star.click(); A.queued[yid] = w.name; added++; }
    });
    A.queueTop = want.length ? want[0].name : null;

    enableAutodraft();

    A.last = {
      pick: cur, round: st.round, upIn: st.upIn, clock: st.clock,
      onClock: st.onClock, rec: res.recommendation && res.recommendation.name,
      recPos: res.recommendation && res.recommendation.pos,
      target: res.target_position,
      rosterCount: roster.length, poolSize: pool.length, unmatched: unmatched,
      queuedAdded: added, queuedRemoved: removed, queueTop: A.queueTop,
      ts: Date.now()
    };
    var lastPick = A.log.length ? A.log[A.log.length - 1].pick : null;
    if (added || lastPick !== cur) {
      A.log.push(A.last);
      post('/state', {
        source: 'autopilot', pick: cur, round: st.round, upIn: st.upIn,
        room: location.pathname, recommendation: res.recommendation,
        alternatives: res.alternatives, position_view: res.position_view,
        roster: roster.map(function (p) {
          return { name: p.name, pos: p.pos, vor: p.vor, points: p.points }; }),
        rosterNeeds: res.roster, poolSize: pool.length, unmatched: unmatched,
        league: window.__hcLeagueSummary || null
      });
    }

    /* Auto-harvest in the FINAL round, while the room is still alive.
     *
     * Once a draft ends Yahoo refuses to reload the client ("Unable to load,
     * return and re-enter your draft") and mock leagues have no public
     * results page -- so a harvest attempted after the fact gets nothing. We
     * therefore grab all rosters during the last round and persist them, then
     * restore the Players view so the remaining picks still work.
     */
    if (!A.harvestedFinal && A.numTeams && st.pick) {
      var rounds = A.rounds || 15;
      var totalPicks = A.numTeams * rounds;
      if (st.pick >= totalPicks - A.numTeams) {
        A.harvestedFinal = true;
        try {
          Promise.resolve(window.__hcHarvest()).then(function (h) {
            try {
              localStorage.setItem('hcFinalHarvest', JSON.stringify(h));
              A.finalHarvest = { teams: Object.keys(h.teams || {}).length,
                                 me: h.me, at: Date.now() };
            } catch (e) {}
            // put the player list back so the last picks still advise
            var pl = [].slice.call(document.querySelectorAll('button,a,div,span,li'))
              .filter(function (x) { return x.children.length === 0; })
              .find(function (x) { return (x.innerText || '').trim() === 'Players'; });
            if (pl) pl.click();
          });
        } catch (e) { A.harvestError = String(e); }
      }
    }

    // draft over?
    if (/draft (is )?(complete|over|has ended)/i.test(document.body.innerText || '')) {
      A.results = { roster: roster, finishedAt: Date.now(), room: location.pathname };
      post('/state', { source: 'autopilot', event: 'draft_complete',
                       pick: 9999, room: location.pathname,
                       roster: A.results.roster });
      clearInterval(A.timer); A.timer = null; A.on = false;
    }
  }

  /* ------------------------------------------------------------ autonomy
   *
   * The first version polled with setInterval(2500). That is wrong for a
   * draft: Chrome throttles timers to roughly once a MINUTE once the tab has
   * been hidden a while, so the autopilot would miss most of the picks in a
   * 60-second-per-pick draft and could not keep the queue current.
   *
   * A MutationObserver is NOT throttled -- it fires when the DOM actually
   * changes, which is exactly when a pick lands. So the draft drives us
   * rather than us polling it, and we react to every pick whether the tab is
   * visible, hidden, or minimised. The interval stays only as a slow
   * backstop in case a re-render happens without a mutation we notice.
   *
   * We also mirror progress into localStorage after every pick, so a tab
   * teardown (Yahoo does this periodically) loses nothing: re-arming reads
   * the log back rather than starting blind. */
  function persist() {
    try {
      localStorage.setItem(LOG_KEY, JSON.stringify({
        room: location.pathname, log: A.log.slice(-260),
        picks: A.picks, queued: A.queued, last: A.last, savedAt: Date.now()
      }));
    } catch (e) { /* quota or private mode: the draft still runs */ }
  }
  A.persist = persist;

  A.restore = function () {
    try {
      var v = JSON.parse(localStorage.getItem(LOG_KEY) || 'null');
      if (v && v.room === location.pathname) {
        A.log = v.log || [];
        A.picks = v.picks || {};
        A.queued = v.queued || {};
        A.restored = A.log.length;
      }
    } catch (e) {}
  };
  A.restore();

  var pending = false, lastRun = 0;
  function schedule() {
    /* Rate-limit to at most one heavy pass per RATE_MS.
     *
     * The observer previously coalesced only into a microtask, so a pass ran
     * on every batch of mutations -- and the draft room mutates once a second
     * from the pick clock alone. Each pass parses 100+ player rows, does 100
     * index lookups and runs the full advisor, so this was pegging the main
     * thread for the whole draft. A timestamp guard is used rather than
     * setTimeout because timers are throttled in a hidden tab and Date.now()
     * is not. */
    var now = Date.now();
    if (now - lastRun < A.RATE_MS) return;
    if (pending) return;
    pending = true;
    lastRun = now;
    Promise.resolve().then(function () {
      pending = false;
      try { tick(); persist(); } catch (e) { A.lastError = String(e); }
    });
  }

  A.observer = new MutationObserver(schedule);
  // characterData:true fires on every clock tick for no benefit -- childList
  // is enough to catch a pick landing.
  A.observer.observe(document.body, { childList: true, subtree: true });

  /* One-line health probe. Monitoring a 210-pick draft must not cost a large
   * tool result per check, and it must answer the only question that matters:
   * is this thing still watching, and how far has the draft got? */
  window.__hcStatus = function () {
    var l = A.last || {};
    return [
      'pick=' + (l.pick == null ? '?' : l.pick),
      'rd=' + (l.round == null ? '?' : l.round),
      'upIn=' + (l.upIn == null ? '?' : l.upIn),
      'rec=' + (l.rec || '-'),
      'roster=' + (l.rosterCount == null ? '?' : l.rosterCount),
      'pool=' + (l.poolSize == null ? '?' : l.poolSize),
      'unmatched=' + (l.unmatched == null ? '?' : l.unmatched),
      'queued=' + Object.keys(A.queued).length,
      'qtop=' + (A.queueTop || '-'),
      'autodraft=' + (A.autodraftOn ? 'on' : 'off'),
      'observed=' + A.log.length,
      'picklog=' + Object.keys(A.picks).length,
      'restored=' + (A.restored || 0),
      'alive=' + (A.observer ? 'yes' : 'no'),
      // staleness is the failure that looks like success: report it loudly
      'lastTick=' + (A.last ? Math.round((Date.now() - A.last.ts) / 1000) + 's' : 'NEVER'),
      A.blind ? 'BLIND=' + A.blind : '',
      A.blindRecoveries ? 'recovered=' + A.blindRecoveries : '',
      'harvested=' + (A.finalHarvest ? A.finalHarvest.teams + 'teams' : 'no'),
      'seed=' + (A.seedRoster ? A.seedRoster.length : 0),
      A.lastError ? 'ERR=' + A.lastError.slice(0, 60) : ''
    ].filter(Boolean).join(' ');
  };

  A.rows = readRows;
  A.tick = tick;
  A.stop = function () {
    A.on = false;
    if (A.timer) clearInterval(A.timer);
    A.timer = null;
    if (A.observer) A.observer.disconnect();
  };
  // slow backstop only; the observer is the real driver
  A.timer = setInterval(schedule, 15000);
  schedule();
})();
