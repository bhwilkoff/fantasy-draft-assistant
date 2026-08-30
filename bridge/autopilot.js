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
    picks: {}, numTeams: null
  };

  function T(e) { return (e && e.innerText ? e.innerText : '').trim(); }

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
      var parts = T(pe).split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
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
    var body = document.body.innerText || '';
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

    var rows = readRows();
    if (!rows.length) return;
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

    // keep the queue six deep, in advice order, re-synced every tick
    var want = [res.recommendation].concat(res.alternatives).filter(Boolean).slice(0, 6);
    var added = 0;
    want.forEach(function (w) {
      var yid = yidOf[w.name];
      if (!yid || A.queued[yid]) return;
      var star = document.querySelector('.ys-addqueue[data-id="' + yid + '"] button')
              || document.querySelector('.ys-addqueue[data-id="' + yid + '"]');
      if (star) { star.click(); A.queued[yid] = w.name; added++; }
    });
    enableAutodraft();

    A.last = {
      pick: cur, round: st.round, upIn: st.upIn, clock: st.clock,
      onClock: st.onClock, rec: res.recommendation && res.recommendation.name,
      recPos: res.recommendation && res.recommendation.pos,
      target: res.target_position,
      rosterCount: roster.length, poolSize: pool.length, unmatched: unmatched,
      queuedAdded: added, ts: Date.now()
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

  var pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    // microtask coalescing: a single pick mutates many nodes, and we want one
    // tick per pick, not one per node.
    Promise.resolve().then(function () {
      pending = false;
      try { tick(); persist(); } catch (e) { A.lastError = String(e); }
    });
  }

  A.observer = new MutationObserver(schedule);
  A.observer.observe(document.body, {
    childList: true, subtree: true, characterData: true
  });

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
      'autodraft=' + (A.autodraftOn ? 'on' : 'off'),
      'observed=' + A.log.length,
      'picklog=' + Object.keys(A.picks).length,
      'restored=' + (A.restored || 0),
      'alive=' + (A.observer ? 'yes' : 'no'),
      A.lastError ? 'ERR=' + A.lastError.slice(0, 60) : ''
    ].filter(Boolean).join(' ');
  };

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
