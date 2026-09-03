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

  /* A native alert()/confirm() blocks the page's event loop -- every pass,
   * every observer, and any script evaluation from outside -- until a human
   * clicks it. Yahoo raises one when it puts an inactive team into auto-pick
   * mode. In a mock room nobody is there to click, and the room looked
   * frozen for minutes (10502966). Make them non-blocking and keep a log. */
  try {
    window.__hcDialogs = window.__hcDialogs || [];
    if (!window.__hcDialogsPatched) {
      window.__hcDialogsPatched = true;
      window.alert = function (m) { window.__hcDialogs.push({ t: Date.now(), kind: 'alert', text: String(m).slice(0, 200) }); };
      window.confirm = function (m) { window.__hcDialogs.push({ t: Date.now(), kind: 'confirm', text: String(m).slice(0, 200) }); return true; };
      window.prompt = function (m) { window.__hcDialogs.push({ t: Date.now(), kind: 'prompt', text: String(m).slice(0, 200) }); return ''; };
      window.onbeforeunload = null;
    }
  } catch (e) {}

  var RELAY = 'http://127.0.0.1:8830';
  var LOG_KEY = 'hcAutopilotLog';
  var A = window.__hcAuto = {
    on: true, queued: {}, log: [], last: null, results: null,
    timer: null, autodraftOn: false, relay: true,
    picks: {}, numTeams: null,
    RATE_MS: 1000,         // floor between heavy passes; see schedule()
    QUEUE_DEPTH: 8         // deep enough that an autodraft cascade taking
                           // the top entries still leaves OUR next choice
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
    var adpCol = -1, xrCol = -1;
    head.forEach(function (c, i) {
      if (/^ADP$/i.test(T(c))) adpCol = i;
      if (/^XRank$/i.test(T(c))) xrCol = i;   // Yahoo's own rank: what autodraft follows
    });
    return [].slice.call(t.querySelectorAll('tr')).map(function (tr) {
      var pe = tr.querySelector('.ys-player[data-id]');
      if (!pe) return null;
      var parts = cellParts(pe);
      var pos = null, team = null;
      parts.slice(1).filter(function (s) { return !/^Bye/i.test(s); }).forEach(function (s) {
        if (/^(QB|RB|WR|TE|K|DEF|D\/ST)$/i.test(s)) pos = s.toUpperCase().replace('D/ST', 'DEF');
        else if (/^[A-Za-z]{2,3}$/.test(s) && pos && !team) team = s;
      });
      var adp = null, xrank = null;
      if (adpCol >= 0 && tr.cells[adpCol]) {
        var v = parseFloat(T(tr.cells[adpCol]).replace(/[^0-9.]/g, ''));
        if (!isNaN(v)) adp = v;
      }
      if (xrCol >= 0 && tr.cells[xrCol]) {
        var x = parseInt(T(tr.cells[xrCol]).replace(/[^0-9]/g, ''), 10);
        if (!isNaN(x)) xrank = x;
      }
      return pos ? { yid: pe.getAttribute('data-id'), name: parts[0],
                     pos: pos, team: team, adp: adp, xrank: xrank } : null;
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

    /* Which pick number was that?
     *
     * The obvious answer -- "Round R, Pick P" minus one -- is wrong often
     * enough to matter: the "Last:" line and the pick counter are separate
     * React updates, and a pass that lands between them attributes the
     * pick to the wrong number. Live, that logged Justin's Malik Willis as
     * OUR pick 125 and then refused to record our real pick 125 because
     * the slot was taken. The audit reported a mismatch that never
     * happened.
     *
     * The drafter's name is in the same line, and a drafter's picks are a
     * fixed set of numbers in a snake. The last pick is therefore the
     * LARGEST of that drafter's numbers that is <= the counter, whether the
     * counter has advanced yet or not. Fall back to P-1 only when the name
     * cannot be placed in the order strip. */
    var rawDrafter = m[4].trim();
    var order = (window.__hcReaders && window.__hcReaders.readDraftOrder)
      ? window.__hcReaders.readDraftOrder() : [];
    // the team count comes from the Results tab when known; the strip is a
    // fallback (it once read 20 and filed our own defense under the wrong
    // pick number, so the roster never showed one and a second was drafted)
    var numTeams = A.numTeamsFromResults || A.numTeams
      || ((order.length >= 4 && order.length <= 20) ? order.length : 12);
    var mySlot = (location.pathname.match(/\/draftclient\/f1\/\d+\/(\d+)/) || [])[1];
    var slot = null, best = 0;
    order.forEach(function (name, i) {
      if (name === 'You' || !name) return;
      if (rawDrafter.indexOf(name) === 0 && name.length > best) { best = name.length; slot = i + 1; }
    });
    // our own entry in the strip is "You", but the header uses our team name
    if (slot === null && order.length && mySlot) slot = +mySlot;

    var pickNo;
    if (slot !== null) {
      var candidates = mySnakePicks(numTeams, slot, 25)
        .filter(function (pk) { return pk <= st.pick; });
      pickNo = candidates.length ? candidates[candidates.length - 1] : st.pick - 1;
    } else {
      pickNo = st.pick - 1;
    }
    if (pickNo < 1) return;
    var entry = {
      pick: pickNo,
      name: m[1].trim(),
      pos: m[2].toUpperCase().replace('D/ST', 'DEF'),
      team: m[3].toUpperCase(),
      // textContent has no line breaks, so keep only the name we matched
      drafter: (best ? order[slot - 1] : (slot === +mySlot ? 'You' : rawDrafter.slice(0, 24)))
    };
    A.draftedKeys = A.draftedKeys || {};
    A.draftedKeys[String(entry.name).toLowerCase().replace(/[^a-z]/g, '') + '|' + entry.pos] = 1;
    var prev = A.picks[pickNo];
    if (prev && prev.name === entry.name) return;
    // a pick we drafted by click is known exactly; a differing "Last:" here
    // is the stale header of the pick before it, not a correction
    if (prev && prev.byClick) return;
    /* When did it land? Yahoo's autodraft picks within a second or two of
     * the turn opening; a human burns clock. The gap since the previous
     * pick is therefore a fingerprint for who is autodrafting. */
    entry.t = Date.now();
    var before = A.picks[pickNo - 1];
    if (before && before.t) entry.dt = Math.round((entry.t - before.t) / 1000);
    A.picks[pickNo] = entry;
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
  A.seedRosterFromResults = async function (opts) {
    // Passes must not read the players table while the harvester has the
    // Drafted filter on (drafted players would look available); guard
    // manual calls the same way the automatic reseed is guarded.
    A.reseeding = true; A.reseedStartedAt = Date.now();
    try {
      // our own team only, unless a full harvest is asked for: twelve
      // roster renders after every one of our picks was most of the load
      // that made the room unresponsive
      var h = await window.__hcHarvest(Object.assign({ onlyMe: true }, opts || {}));
      if (h && h.numTeams >= 4 && h.numTeams <= 20) A.numTeamsFromResults = h.numTeams;
      if (h && h.teams && h.me && h.teams[h.me]) {
        A.seedRoster = h.teams[h.me].map(function (p) {
          return { name: p.name, pos: p.pos, team: p.team, pick: p.pick || null, seeded: true };
        });
        // The Results tab also carries each player's pick number, so our
        // own picks can be backfilled into the log even when the header
        // race (or a reseed in progress) lost them -- the audit needs them.
        h.teams[h.me].forEach(function (p) {
          if (p.pick && !A.picks[p.pick]) {
            A.picks[p.pick] = { pick: p.pick, name: p.name, pos: p.pos,
                                team: p.team, drafter: 'You', fromResults: true };
          }
        });
      }
      var pl = [].slice.call(document.querySelectorAll('button,a,div,span,li'))
        .filter(function (x) { return x.children.length === 0; })
        .find(function (x) { return (x.innerText || '').trim() === 'Players'; });
      if (pl) pl.click();
    } catch (e) { A.seedError = String(e); }
    A.reseeding = false;
    return A.seedRoster ? A.seedRoster.length : 0;
  };

  function myRosterFromPicks() {
    var m = location.pathname.match(/\/draftclient\/f1\/(\d+)\/(\d+)/);
    if (!m) return [];
    var slot = +m[2];
    /* Team count: the Results tab's team list is authoritative (one option
     * per team, whatever the labels say) and the harvester records it as
     * h.numTeams; until a harvest has run, use the bridge's period-detecting
     * strip reader. Never dedupe the strip by name -- two managers can share
     * one (mock 10430908), and 11 teams in a 12-team room shifts every snake
     * pick number. */
    var numTeams = A.numTeamsFromResults
      || ((window.__hcReaders && window.__hcReaders.readDraftOrder)
          ? window.__hcReaders.readDraftOrder().length : 0)
      || A.numTeams || 12;
    if (numTeams < 4 || numTeams > 20) numTeams = A.numTeams || 12;
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
      /* ...and the click records the FULL name ("Josh Allen") while the
       * Results tab abbreviates ("J. Allen"), so a name key still doubled
       * every click-drafted player (mock 10513354: three picks, roster of
       * five). Key by pick number when both sides have one, else by the
       * matched player's canonical name, else by the normalised text. */
      /* Two independent keys, and an entry is a duplicate if EITHER
       * matches: the projection-set player it resolves to (so "J. Taylor"
       * and "Jonathan Taylor" are one), or its pick number when both
       * sides carry one. Mock 10515116: the seed had no pick number, the
       * click had one, and a pick-only key doubled the roster again. */
      var idOf = function (p) {
        try {
          var mm = window.HarveyCup.lookup(window.__hcIndex, p.name, p.pos, p.team);
          if (mm && mm.player) return 'id|' + mm.player.name + '|' + mm.player.pos;
        } catch (e) {}
        return norm(p.name) + '|' + (p.pos || '');
      };
      var seenId = {}, seenPick = {}, merged = [];
      A.seedRoster.concat(out).forEach(function (p) {
        var k = idOf(p);
        if (seenId[k]) return;
        if (p.pick && seenPick[p.pick]) return;
        seenId[k] = 1; if (p.pick) seenPick[p.pick] = 1;
        merged.push(p);
      });
      return merged;
    }
    return out;
  }
  A.myRosterFromPicks = myRosterFromPicks;

  /* Autodraft must be ON or the queue is decoration. Read the button's
   * actual state every pass -- when it is on, Yahoo renders a check icon
   * (an <svg>) inside it and fills the background; when off, plain text on
   * the dark panel. The first version clicked once and remembered "on",
   * which was false in mock 10429138: the click landed before React had
   * attached its handler, and the room would have autodrafted from
   * Yahoo's rankings instead of our queue. */
  /* DRAFT THE PICK OURSELVES (mock rooms).
   *
   * Leaving the pick to Yahoo's clock meant Yahoo took queue[0] the instant
   * our turn opened (auto-pick mode), and a queue that had not settled in
   * a four-second round drafted the wrong player. The room shows a "Draft"
   * button on every player row while we are on the clock; click the one
   * whose single-player container carries the recommendation's Yahoo id.
   *
   * Two guards, both learned live in mock 10510897:
   *  - wait until the header's pick number IS one of ours. When the title
   *    flips to "YOUR TURN" the header still shows the previous pick for a
   *    beat, and the advice on screen was computed for that pool; a click
   *    at that instant drafted Garrett Wilson when the advice, once
   *    recomputed, was Lamar Jackson.
   *  - one click per pick number. */
  A.DRAFT_CLICK = true;
  var IN_REAL_ROOM = /\/draftclient\/f1\/539156\//.test(location.pathname);
  /* THE OVERRIDE WINDOW. In the real draft the autopilot makes the pick,
   * but the human watching the panel gets DRAFT_DELAY seconds on each of
   * our turns to click a different player first; the autopilot clicks only
   * if the pick is still open when the window closes. Mocks: 0. */
  A.DRAFT_DELAY = IN_REAL_ROOM ? 20 : 0;
  try { var dd = localStorage.getItem('hcDraftDelay'); if (dd != null && dd !== '' && !isNaN(+dd)) A.DRAFT_DELAY = +dd; } catch (e) {}
  /* ASSUME AUTODRAFT UNTIL PROVEN HUMAN. Harvey Cup is a new family league
   * where most managers are expected not to show up; a seat that has not
   * yet burned clock on any pick is modelled as Yahoo's autodraft (its
   * ranking, no noise) when this is on. Off in mocks, on in the real room;
   * localStorage.hcAssumeAutodraft overrides ('1'/'0'). */
  A.ASSUME_AUTODRAFT = IN_REAL_ROOM;
  try { var aa = localStorage.getItem('hcAssumeAutodraft'); if (aa === '1') A.ASSUME_AUTODRAFT = true; if (aa === '0') A.ASSUME_AUTODRAFT = false; } catch (e) {}
  function ourPick(pick, slot) {
    if (!A.numTeams || !slot || !pick) return false;
    var n = A.numTeams, r = Math.ceil(pick / n), i = pick - (r - 1) * n;
    return (r % 2 === 1) ? i === slot : i === n + 1 - slot;
  }
  function draftButtonFor(yid) {
    var btns = [].slice.call(document.querySelectorAll('button'))
      .filter(function (b) { return /^\s*draft\s*$/i.test(T(b)); });
    for (var i = 0; i < btns.length; i++) {
      var row = btns[i];
      while (row && row.querySelectorAll('.ys-player[data-id]').length < 1 && row.parentElement) row = row.parentElement;
      if (!row) continue;
      var pes = row.querySelectorAll('.ys-player[data-id]');
      if (pes.length === 1 && pes[0].getAttribute('data-id') === String(yid)) return btns[i];
    }
    /* the other direction: from the player's cell up to its row (tr, li,
     * or the nearest ancestor holding exactly one player) and look for a
     * Draft button inside it */
    var cells = [].slice.call(document.querySelectorAll('.ys-player[data-id="' + yid + '"]'));
    for (var c = 0; c < cells.length; c++) {
      var r = cells[c].closest('tr, li') || cells[c], up = 0;
      while (r && r.querySelectorAll('.ys-player[data-id]').length <= 1 && up < 8
             && !r.querySelector('button')) { r = r.parentElement; up++; }
      if (!r) continue;
      var bs = [].slice.call(r.querySelectorAll('button'))
        .filter(function (b) { return /^\s*draft\s*$/i.test(T(b)); });
      if (bs.length && r.querySelectorAll('.ys-player[data-id]').length === 1) return bs[0];
    }
    A.draftDiag = {
      yid: yid, cells: cells.length,
      inTable: cells.filter(function (e) { return !!e.closest('table'); }).length,
      draftButtons: btns.length, at: Date.now()
    };
    return null;
  }
  /* Second locator: by the room's short name. "Travis Kelce" renders as
   * "T. Kelce", "Broncos D/ST" as "Broncos"; the row's player cell starts
   * with that. Used when the id map has no button for the recommendation
   * (mock 10526391, picks 133 and 157: the id on file was on no row). */
  function draftButtonForName(name, pos) {
    var short;
    if (pos === 'DEF') short = String(name).replace(/\s*D\/ST$/i, '').trim().toLowerCase();
    else {
      var w = String(name).trim().split(/\s+/);
      short = (w[0].charAt(0) + '. ' + w.slice(1).join(' ')).toLowerCase();
    }
    var btns = [].slice.call(document.querySelectorAll('button'))
      .filter(function (b) { return /^\s*draft\s*$/i.test(T(b)); });
    for (var i = 0; i < btns.length; i++) {
      var row = btns[i];
      while (row && row.querySelectorAll('.ys-player[data-id]').length < 1 && row.parentElement) row = row.parentElement;
      if (!row) continue;
      var pes = row.querySelectorAll('.ys-player[data-id]');
      if (pes.length !== 1) continue;
      var t = (pes[0].textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (t.indexOf(short) === 0) return btns[i];
    }
    return null;
  }

  function draftClick(st, res, yidOf, slot, cur) {
    if (A.DRAFT_CLICK === false) return;
    if (st.upIn !== 0) return;                       // not on the clock
    if (!ourPick(cur, slot)) { A.draftWait = cur; return; }   // header has not reached our pick yet
    if (A.draftClickedPick === cur) return;
    // the override window: give the human DRAFT_DELAY seconds first
    A.onClockSince = A.onClockSince || {};
    if (!A.onClockSince[cur]) A.onClockSince[cur] = Date.now();
    var waited = (Date.now() - A.onClockSince[cur]) / 1000;
    if (A.DRAFT_DELAY > 0 && waited < A.DRAFT_DELAY) {
      A.draftWindowLeft = Math.ceil(A.DRAFT_DELAY - waited);
      return;
    }
    A.draftWindowLeft = 0;
    var rec = res.recommendation;
    if (!rec) return;
    var yid = yidOf[rec.name];
    if (!yid) {
      var bn = draftButtonForName(rec.name, rec.pos);
      if (!bn) { A.draftMiss = 'no yid for ' + rec.name; return; }
      bn.click();
      A.draftClickedPick = cur; A.draftMiss = null;
      A.draftClicks = (A.draftClicks || 0) + 1;
      A.draftLog = (A.draftLog || []).concat([cur + ' ' + rec.name + ' (by name)']);
      return;
    }
    var b = draftButtonFor(yid), via = rec.name;
    if (!b) { b = draftButtonForName(rec.name, rec.pos); if (b) via = rec.name + ' (by name)'; }
    if (!b) {
      /* THE CLOCK MUST NEVER EXPIRE: one missed clock puts the seat into
       * Yahoo's auto-pick mode for the rest of the draft (mock 10510897,
       * twice). If the recommendation's button cannot be found, walk the
       * plan for any entry that has one; with the clock under twenty
       * seconds take whatever row shows a Draft button at all. */
      A.draftMiss = 'no button for ' + rec.name + ' at ' + cur;
      /* A row far down the table renders without its Draft button (mock
       * 10513354, pick 170: Denzel Boston's row was in the table, no
       * button). Bring it into view; the next pass looks again. */
      try {
        var cell = document.querySelector('table .ys-player[data-id="' + yid + '"]');
        if (cell && cell.scrollIntoView) { cell.scrollIntoView({ block: 'center' }); A.draftScrolls = (A.draftScrolls || 0) + 1; }
      } catch (e) {}
      /* Right after our own click the table re-renders and the next
       * recommendation's row can be absent for a pass (mock 10511947,
       * pick 133: the fallback took plan entry 3 with 70 s on the clock).
       * With time left, wait for the next pass; fall through the plan
       * only under twenty seconds, and to any button under ten. */
      var clock = st.clock;
      if (!clock) {
        /* the status reader's clock is null on our own turn (the timer is
         * not inside the "Round R, Pick P" element it caches). The timer is
         * a leaf span reading "00:45"; find it directly. Only runs on our
         * turn when the recommendation's button is missing. */
        var leaf = [].slice.call(document.querySelectorAll('span,div,time')).filter(function (x) {
          return x.children.length <= 2 && /^\d{1,2}:\d{2}$/.test((x.textContent || '').trim());
        })[0];
        if (leaf) clock = leaf.textContent.trim();
      }
      var secs = clock ? (+clock.split(':')[0]) * 60 + (+clock.split(':')[1]) : null;
      A.draftClock = clock || 'unknown';
      // unknown clock: assume it is low -- a wrong pick beats a lost seat
      if (secs != null && secs > 20) return;
      var plan = A.plan || [];
      for (var pi = 1; pi < plan.length && !b; pi++) {
        var pyid = yidOf[plan[pi].name];
        if (pyid) { b = draftButtonFor(pyid); if (b) via = plan[pi].name + ' (plan ' + (pi + 1) + ')'; }
      }
      if (!b && (secs == null || secs <= 10)) {
        var any = [].slice.call(document.querySelectorAll('button'))
          .filter(function (x) { return /^\s*draft\s*$/i.test(T(x)); })[0];
        if (any) { b = any; via = 'first Draft button (clock ' + st.clock + ')'; }
      }
      if (!b) return;
    }
    b.click();
    A.draftClickedPick = cur; A.draftMiss = null;
    A.draftClicks = (A.draftClicks || 0) + 1;
    A.draftLog = (A.draftLog || []).concat([cur + ' ' + via]);
    /* We know exactly what we drafted; the "Last:" header does not update
     * in step with the counter and, in a back-to-back turn, attributed our
     * first pick's player to our second pick as well (mock 10511947,
     * picks 36/37). Record the click as the authoritative entry. */
    if (via === rec.name) {
      A.picks[cur] = { pick: cur, name: rec.name, pos: rec.pos, team: rec.team || '',
                       drafter: 'You', t: Date.now(), byClick: true };
      A.draftedKeys = A.draftedKeys || {};
      A.draftedKeys[String(rec.name).toLowerCase().replace(/[^a-z]/g, '') + '|' + rec.pos] = 1;
    }
  }

  function enableAutodraft() {
    var b = [].slice.call(document.querySelectorAll('button'))
      .find(function (x) { return /^\s*autodraft\s*$/i.test(T(x)); });
    if (!b) { A.autodraftOn = false; return; }
    var on = b.querySelectorAll('svg').length > 0;
    /* Policy: leave Autodraft OFF. Yahoo drafts the top of the queue when
     * the clock expires whether or not Autodraft is on; with it off the
     * actuator has the whole clock to settle the queue, and a burst of
     * instant picks cannot outrun it. Set localStorage hcMockAutodraft=1 to
     * have the autopilot switch it on anyway (fast, unattended mocks). */
    var wantOn = false;
    try { wantOn = localStorage.getItem('hcMockAutodraft') === '1'; } catch (e) {}
    if (on && !wantOn && A.DRAFT_CLICK !== false) {
      /* Yahoo switches a seat to auto-pick after one missed clock; from
       * then on it drafts queue[0] the instant our turn opens and the
       * Draft click never gets a chance. Switch it back off (spaced, as
       * every click is a re-render). */
      var nowOff = Date.now();
      if (!A.autodraftClickedAt || nowOff - A.autodraftClickedAt > 30000) {
        b.click(); A.autodraftClickedAt = nowOff; A.autodraftOffClicks = (A.autodraftOffClicks || 0) + 1;
      }
    }
    if (!on && wantOn) {
      /* One click, then wait: each click is a React re-render of the whole
       * room (~200 ms) and before the draft has started Yahoo ignores it,
       * so a 3-second retry loop was burning a fifth of the CPU for
       * nothing (mock 10504003, "clicked3" before pick one). */
      var now = Date.now();
      var started = !!(A.last && A.last.pick != null) || !!document.querySelector('.ys-draftorder-current');
      if (started && (!A.autodraftClickedAt || now - A.autodraftClickedAt > 30000)) {
        b.click(); A.autodraftClickedAt = now; A.autodraftClicks = (A.autodraftClicks || 0) + 1;
      }
    }
    A.autodraftOn = on;
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

  /* Yahoo's queue, in order, from its queue panel. Queued players carry a
   * `.ys-removequeue[data-id]` star; the same star also appears in the
   * players table row, which we skip so each player is counted once. */
  function readYahooQueue() {
    var seen = {}, out = [];
    [].slice.call(document.querySelectorAll('.ys-removequeue[data-id]')).forEach(function (e) {
      if (e.closest('table')) return;
      var yid = e.getAttribute('data-id');
      if (!seen[yid]) { seen[yid] = 1; out.push(yid); }
    });
    if (!out.length) {
      // panel not rendered (collapsed?) -- fall back to the table's stars
      [].slice.call(document.querySelectorAll('table .ys-removequeue[data-id]')).forEach(function (e) {
        var yid = e.getAttribute('data-id');
        if (!seen[yid]) { seen[yid] = 1; out.push(yid); }
      });
    }
    return out;
  }
  A.readYahooQueue = readYahooQueue;

  function draftedToggle() {
    // the toggle is a <button> whose text is exactly "Drafted" (plus a check
    // icon when on); leaf-text matching missed it once the icon was present
    var btn = [].slice.call(document.querySelectorAll('button'))
      .find(function (b) { return T(b) === 'Drafted'; });
    if (btn) return btn;
    var dr = [].slice.call(document.querySelectorAll('div,span'))
      .filter(function (x) { return x.children.length === 0 && T(x) === 'Drafted'; })[0];
    return dr ? (dr.closest('button') || dr) : null;
  }
  A.draftedToggle = draftedToggle;

  function starButton(cls, yid) {
    var e = document.querySelector('.' + cls + '[data-id="' + yid + '"]');
    return e ? (e.querySelector('button') || e) : null;
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
    /* While the roster is being re-read from the Results tab the harvester
     * has the "Drafted" filter switched on, so the players table briefly
     * contains DRAFTED players. A pass that ran in that window recommended
     * Puka Nacua in round eleven and purged the real queue to make room for
     * him; the queue was still being rebuilt when a burst of instant
     * autodraft picks reached our turn (mock 10427900, pick 137). */
    var tPre = Date.now();
    var st = R.readStatus();
    recordLastPick(st);      // the header is present in every view; read it first
    /* After the draft the header has no pick number; a pass then runs at
     * "pick 1" and its advice overwrote round one's in the audit (mock
     * 10510897: r1 read "rec Justice Hill" after the fact). Do nothing. */
    if (!st.pick && A.log.length) return;
    /* A reseed that never resolves (a re-arm replaced the harvester under
     * it, mid-await) must not freeze the autopilot for the rest of the
     * draft. Live: reseeding stayed true for two minutes and the queue went
     * stale through our own pick. Give a reseed 20 s, then carry on. */
    if (A.reseeding) {
      if (A.reseedStartedAt && Date.now() - A.reseedStartedAt > 20000) {
        A.reseeding = false; A.reseedTimeouts = (A.reseedTimeouts || 0) + 1;
      } else {
        return;
      }
    }
    /* A harvester is paging the Players table through Drafted and the
     * position filter. Touching either now (the self-heal below) empties
     * its projection map -- mock 12 graded at 0% Yahoo coverage for exactly
     * that reason. Ninety seconds covers a full twelve-team harvest. */
    /* THE OVERRIDE WINDOW IS QUIET TIME. On our turn with the window open,
     * a full pass every second (pool rebuild, advise, panel render) on top
     * of Yahoo's own on-the-clock rendering saturated the renderer: mock
     * 10526391 froze for 19 s, the click never ran, and Yahoo's clock took
     * two picks from the queue. The recommendation was already known
     * before the turn; nothing needs recomputing until the window closes. */
    if (A.DRAFT_DELAY > 0 && st.upIn === 0 && st.pick) {
      var slotW = (location.pathname.match(/\/draftclient\/f1\/\d+\/(\d+)/) || [])[1];
      if (slotW && ourPick(st.pick, +slotW)) {
        A.onClockSince = A.onClockSince || {};
        if (!A.onClockSince[st.pick]) A.onClockSince[st.pick] = Date.now();
        var waitedW = (Date.now() - A.onClockSince[st.pick]) / 1000;
        if (waitedW < A.DRAFT_DELAY && A.draftClickedPick !== st.pick) {
          A.draftWindowLeft = Math.ceil(A.DRAFT_DELAY - waitedW);
          A.windowSkips = (A.windowSkips || 0) + 1;
          return;
        }
      }
    }
    if (window.__hcHarvestBusy) {
      if (window.__hcHarvestBusyAt && Date.now() - window.__hcHarvestBusyAt > 90000) {
        window.__hcHarvestBusy = false; A.harvestBusyTimeouts = (A.harvestBusyTimeouts || 0) + 1;
      } else {
        A.harvestBusySkips = (A.harvestBusySkips || 0) + 1;
        return;
      }
    }
    var rows = window.__hcProf ? window.__hcProf('readRows', readRows) : readRows();
    if (!rows.length) {
      A.blind = 'no player table (wrong view?)';
      var pl = [].slice.call(document.querySelectorAll('button,a,div,span,li'))
        .filter(function (x) { return x.children.length === 0; })
        .find(function (x) { return (x.innerText || '').trim() === 'Players'; });
      if (pl) { A.blindRecoveries = (A.blindRecoveries || 0) + 1; pl.click(); }
      return;
    }
    A.blind = null;

    /* Filter sanity. The table must show every undrafted player and no
     * drafted one. Two ways it silently stops doing that: the Drafted toggle
     * is left on (a harvest interrupted mid-way, or a stray click), so
     * already-drafted players look available -- live, the advisor
     * recommended Jahmyr Gibbs in round nine; or the position select is
     * left on one position, so the pool is a fraction of the board. Detect
     * both from the rows themselves and put the filters back. */
    var now0 = Date.now();
    // Yahoo renders a check icon inside the Drafted toggle when it is on
    // (the same convention as the Autodraft button): read the state, never
    // toggle blind -- a lost click would turn it ON.
    var draftedBtn = draftedToggle();
    var draftedOn = draftedBtn && draftedBtn.querySelectorAll('svg').length > 0;
    if (draftedOn && !A.reseeding && (!A.filterFixAt || now0 - A.filterFixAt > 5000)) {
      draftedBtn.click(); A.filterFixAt = now0; A.filterFixes = (A.filterFixes || 0) + 1;
      return;   // re-read on the next pass
    }
    var posCounts = {};
    rows.forEach(function (r) { posCounts[r.pos] = (posCounts[r.pos] || 0) + 1; });
    if (rows.length < 60 && Object.keys(posCounts).length === 1
        && (!A.filterFixAt || now0 - A.filterFixAt > 5000)) {
      var sel = [].slice.call(document.querySelectorAll('select')).find(function (x) {
        return [].slice.call(x.options).some(function (o) { return /All Positions/i.test(T(o)); });
      });
      if (sel) {
        var all = [].slice.call(sel.options).find(function (o) { return /All Positions/i.test(T(o)); });
        var d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(sel), 'value');
        if (d && d.set) d.set.call(sel, all.value); else sel.value = all.value;
        sel.dispatchEvent(new Event('input', { bubbles: true }));
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        A.filterFixAt = now0; A.filterFixes = (A.filterFixes || 0) + 1;
        return;
      }
    }

    var pool = [], yidOf = {}, unmatched = 0;
    rows.forEach(function (r) {
      var m = HC.lookup(idx, r.name, r.pos, r.team, r.adp);
      if (m.player) {
        m.player.xrank = r.xrank;   // Yahoo's rank, for modelling autodrafters
        pool.push(m.player);
        /* One projection-set player, one Yahoo id -- and only from a row of
         * the same position. Mock 10526391 pick 133: a row at another
         * position resolved to "Broncos D/ST" and overwrote the defense's
         * id with a player id that was on no row, so the Draft click had
         * nothing to find and the ladder took plan entry 3. */
        if (yidOf[m.player.name] == null || r.pos === m.player.pos) yidOf[m.player.name] = r.yid;
      }
      else unmatched++;
    });

    // Prefer the reconstructed pick log; fall back to the DOM scrape.
    var raw = myRosterFromPicks();
    if (!raw.length) raw = R.readMyRoster(rows) || [];
    var roster = raw.map(function (r) {
      var m = HC.lookup(idx, r.name, r.pos, r.team);
      return m.player || { name: r.name, pos: r.pos, vor: 0, points: 0 };
    });

    A.preMs = Date.now() - tPre;   // status, pick log, rows, filters, matching, roster
    var cur = st.pick || 1;
    var next = cur + (st.upIn != null ? Math.max(1, st.upIn) : 12);
    /* Exact picks remaining from the snake: how many of OUR pick numbers
     * are still >= the current pick. Independent of the roster count,
     * which has been wrong in every mock so far. */
    var slotM = location.pathname.match(/\/draftclient\/f1\/\d+\/(\d+)/);
    var rounds = HC.getRosterSize ? HC.getRosterSize() : 15;
    var remaining = null;
    if (slotM && A.numTeams) {
      remaining = mySnakePicks(A.numTeams, +slotM[1], rounds)
        .filter(function (pk) { return pk >= cur; }).length;
    }
    /* Opponent-aware availability: who picks between now and our next turn,
     * and what do they already hold? (bridge/opponents.js) */
    var availability = null;
    if (window.__hcOpp && A.numTeams && next > cur && A.availCache && A.availCache.pick === cur
        && A.availCache.n === pool.length) {
      availability = A.availCache.map;      // nothing changed since the last pass
    } else if (window.__hcOpp && A.numTeams && next > cur) {
      try {
        var oppRosters = window.__hcOpp.inferOpponentRosters(A.picks, A.numTeams, cur, next);
        A.autodraftSlots = window.__hcOpp.inferAutodraftSlots(A.picks, A.numTeams,
          slotM ? +slotM[1] : null);
        A.assumedSlots = [];
        if (A.ASSUME_AUTODRAFT) {
          // a seat is proven human by one pick that burned eight seconds
          var provenHuman = {};
          Object.keys(A.picks).forEach(function (k) {
            var e = A.picks[k];
            if (e && e.dt != null && e.dt >= 8) {
              var n = A.numTeams, r = Math.ceil(+k / n), i = +k - (r - 1) * n;
              provenHuman[(r % 2 === 1) ? i : n + 1 - i] = 1;
            }
          });
          for (var seat = 1; seat <= A.numTeams; seat++) {
            if (slotM && seat === +slotM[1]) continue;
            if (provenHuman[seat] || A.autodraftSlots.indexOf(seat) >= 0) continue;
            A.autodraftSlots.push(seat); A.assumedSlots.push(seat);
          }
          A.autodraftSlots.sort(function (a, b) { return a - b; });
        }
        availability = (window.__hcProf || function (n, f) { return f(); })('opponents', function () {
          return window.__hcOpp.simulateAvailability(pool, cur, next, oppRosters, {
            numTeams: A.numTeams, totalRounds: rounds, trials: 60, seed: cur * 7919 + pool.length,
            autodraftSlots: A.autodraftSlots
          });
        });
        A.availabilityAt = cur;
        A.availCache = { pick: cur, n: pool.length, map: availability };
      } catch (e) { A.availError = String(e); availability = null; }
    }
    var advOpts = {};
    if (remaining != null) advOpts.picksRemaining = remaining;
    if (availability) advOpts.availability = availability;
    var res = (window.__hcProf || function (n, f) { return f(); })('advise', function () { return HC.advise(pool, roster, cur, next, [], 6, advOpts); });
    /* ONE BRAIN. The overlay used to read the roster and run advise() on
     * its own, so panel and queue could disagree (the user saw the panel
     * lag the room's picks while the queue had moved on). Publish what this
     * pass actually acted on; the overlay renders it when fresh. */
    A.lastRes = res; A.lastRoster = roster; A.passSeq = (A.passSeq || 0) + 1;

    /* The queue is built SEQUENTIALLY, not from the flat ranking.
     *
     * Yahoo drafts queue[0], and if our turn comes twice in a row (a snake
     * turn at either end, or a fast room) it drafts queue[1] next. A flat
     * top-N ranking against the current roster puts three quarterbacks in
     * a row when the roster has none, and the room took two of them. So
     * entry k is what the advisor would say AFTER entries 1..k-1 have been
     * drafted onto the roster and off the board. */
    /* Entry k answers "who, if entries 1..k-1 are GONE" -- gone to
     * opponents, which is what usually happens between passes; Yahoo drafts
     * queue[0] the instant our turn opens, so the entry beneath a player
     * an opponent just took must be the right pick for THIS roster. (The
     * first version put entries 1..k-1 on our roster instead, and when an
     * opponent took the queued tight end the entry beneath it was a receiver
     * chosen as if we already had that tight end.) The one thing the
     * roster-based version prevented -- three quarterbacks in a row, two of
     * which a snake turn-around then drafted -- is prevented by a cap: at
     * most one queued player at each onesie position (QB, TE, K, DEF). */
    var seqPool = pool.slice(), seq = [], onesie = { QB: 0, TE: 0, K: 0, DEF: 0 };
    var seqOpts = { availability: availability };
    if (remaining != null) seqOpts.picksRemaining = remaining;
    var tSeq = Date.now();
    for (var qi = 0; qi < A.QUEUE_DEPTH && seqPool.length; qi++) {
      var r = qi === 0 ? res : HC.advise(seqPool, roster, cur, next, [], 3, seqOpts);
      var pickd = r && r.recommendation;
      if (!pickd) break;
      if (onesie[pickd.pos] != null && onesie[pickd.pos] >= 1) {
        // a second QB/TE/K/DEF: drop him from the pool and ask again
        seqPool = seqPool.filter(function (p) { return p.name !== pickd.name; });
        qi--; continue;
      }
      if (onesie[pickd.pos] != null) onesie[pickd.pos]++;
      seq.push(pickd);
      seqPool = seqPool.filter(function (p) { return p.name !== pickd.name; });
    }
    A.seqMs = Date.now() - tSeq;

    /* Re-read our roster from the Results tab right after each of our picks.
     *
     * The header-derived pick log is the fast path, but it has now been
     * wrong in three different ways across five mocks, and every time the
     * roster count came out LOW -- which is the one direction that matters,
     * because the gate that finally permits a kicker and a defense is
     * "picks remaining <= 2". Two mocks ended with neither. The Results tab
     * is authoritative and a read costs about two seconds, once a round. */
    /* Trigger: the pick counter has moved past one of OUR pick numbers.
     * Not "up-in went 0 -> N": Yahoo autodrafts the instant our turn opens,
     * so a pass rarely ever observes up-in at zero. */
    if (slotM && A.numTeams && A.lastCur != null && cur > A.lastCur && !A.reseeding) {
      var crossed = mySnakePicks(A.numTeams, +slotM[1], rounds).some(function (pk) {
        return pk >= A.lastCur && pk < cur;
      });
      if (crossed) {
        A.reseeding = true;
        A.reseedStartedAt = Date.now();
        Promise.resolve(A.seedRosterFromResults())
          .then(function () { A.reseeding = false; A.reseeds = (A.reseeds || 0) + 1; },
                function () { A.reseeding = false; });
      }
    }
    A.lastCur = cur;

    /* Keep the queue EXACTLY the current top N, in order -- and read the
     * queue from YAHOO, not from our own memory of what we clicked.
     *
     * Two generations of this were wrong. The first only ever added, so
     * queue[0] stayed whatever was queued in round two. The second tracked
     * its own `queued` map and un-starred by clicking `.ys-addqueue[data-id]`
     * -- but once a player is queued Yahoo swaps that element's class to
     * `.ys-removequeue`, so the un-star never found anything, the map forgot
     * him, and Yahoo kept him. Live, that left Bo Nix and Matthew Stafford at
     * the top of the queue with Josh Allen already rostered, and drafted
     * Jaxson Dart at pick 92 while the advisor wanted a receiver.
     *
     * So every pass reads Yahoo's queue panel (the `.ys-removequeue`
     * elements outside the players table, in document order), removes what
     * is not wanted, and adds what is missing. Additions are ONE per pass:
     * several star clicks in one pass reach the server in arbitrary order
     * and the queue comes back shuffled. The passes run every ~1.5 s, so the
     * queue is full and correctly ordered within a few seconds anyway. */
    var want = seq.length ? seq
      : [res.recommendation].concat(res.alternatives).filter(Boolean).slice(0, A.QUEUE_DEPTH);
    var wantIds = [], wantName = {};
    want.forEach(function (w) {
      var yid = yidOf[w.name];
      if (yid) { wantIds.push(yid); wantName[yid] = w.name; }
    });

    A._reconcileT0 = Date.now();
    var real = readYahooQueue();
    var added = 0, removed = 0;
    /* Every star click is a synchronous React re-render of the room. Budget
     * ONE click per pass (two only when the queue is empty), and let the
     * passes -- one a second -- do the rest. A pass that clicked four stars
     * cost a full second of main thread. */
    // ...except when queue[0] is not the recommendation: Yahoo auto-picks
    // the instant our turn opens, so the top entry must be right at all
    // times; spend two clicks (evict + add) to fix it in one pass
    var clickBudget = (!real.length || real[0] !== wantIds[0]) ? 2 : 1;
    /* Yahoo APPENDS a newly starred player. So when the recommendation is
     * not queued (his predecessor just went), adding him puts him LAST, and
     * a two-click budget then evicts the entries ahead of him two per pass
     * -- for several passes the queue holds entries 2..n and not the one
     * that matters (seen by the user in mock 10510897: "the next players
     * match, the highlighted one is missing"). Spend what it takes, once:
     * evict everything ahead of the recommendation and add him in the same
     * pass. The rest refills one per pass. */
    if (wantIds.length) {
      var topAt = real.indexOf(wantIds[0]);
      if (topAt < 0) clickBudget = Math.max(clickBudget, real.length + 1);
      else if (topAt > 0) clickBudget = Math.max(clickBudget, topAt + 1);
      clickBudget = Math.min(clickBudget, A.QUEUE_DEPTH + 1);
    }
    function spend() { if (clickBudget <= 0) return false; clickBudget--; return true; }
    /* 1. drop anything Yahoo has that we no longer want -- but be slow to
     *    evict. A player who slipped from 4th to 6th in our ranking is
     *    harmless further down the queue; removing him and re-adding one
     *    entry per pass leaves the queue thin exactly when picks come
     *    fastest. Evict only players outside twice the queue depth, and
     *    anyone no longer on the board. */
    var tolerated = {};
    want.concat([res.recommendation].concat(res.alternatives).filter(Boolean))
      .slice(0, A.QUEUE_DEPTH * 2).forEach(function (w) {
        if (yidOf[w.name]) tolerated[yidOf[w.name]] = 1;
      });
    var onBoard = {};
    rows.forEach(function (r) { onBoard[r.yid] = 1; });
    real.forEach(function (yid) {
      if (wantIds.indexOf(yid) >= 0) return;
      if (tolerated[yid] && onBoard[yid]) return;
      var b = starButton('ys-removequeue', yid);
      if (b && spend()) { b.click(); removed++; }
    });
    // 2. drop anything that is out of order relative to our ranking, so the
    //    re-add below restores queue[0] = the live recommendation
    var present = real.filter(function (yid) { return wantIds.indexOf(yid) >= 0; });
    // a tolerated extra sitting ABOVE a wanted player would be drafted first:
    // evict it in that case
    var firstWantedAt = real.findIndex(function (yid) { return wantIds.indexOf(yid) >= 0; });
    real.forEach(function (yid, i) {
      if (wantIds.indexOf(yid) >= 0) return;
      if (firstWantedAt >= 0 && i < firstWantedAt) {
        var bb = starButton('ys-removequeue', yid);
        if (bb && spend()) { bb.click(); removed++; }
      }
    });
    var lastRank = -1, keep = [];
    present.forEach(function (yid) {
      var rank = wantIds.indexOf(yid);
      if (rank > lastRank) { lastRank = rank; keep.push(yid); return; }
      var b = starButton('ys-removequeue', yid);
      if (b && spend()) { b.click(); removed++; } else { keep.push(yid); }
    });
    // a kept entry ahead of a missing higher-ranked one is also out of order
    // (queue[0] would not be the recommendation); drop from that point on
    var firstMissing = wantIds.length;
    for (var wi = 0; wi < wantIds.length; wi++) {
      if (keep.indexOf(wantIds[wi]) < 0) { firstMissing = wi; break; }
    }
    keep = keep.filter(function (yid) {
      if (wantIds.indexOf(yid) < firstMissing) return true;
      var b = starButton('ys-removequeue', yid);
      if (b && spend()) { b.click(); removed++; return false; }
      return true;
    });
    // 3. add the missing wanted players in order: one per pass while the
    //    queue is healthy (order safety), two when it has run thin -- an
    //    end-game of autodrafters moves a pick every two seconds, and a
    //    queue with one name in it is one pick from empty
    for (var ai = 0; ai < wantIds.length && clickBudget > 0; ai++) {
      if (keep.indexOf(wantIds[ai]) >= 0) continue;
      var sb = starButton('ys-addqueue', wantIds[ai]);
      if (sb && spend()) { sb.click(); added++; }
    }
    A.reconcileMs = Date.now() - (A._reconcileT0 || Date.now());
    A.queued = {};
    keep.forEach(function (yid) { A.queued[yid] = wantName[yid]; });
    A.yahooQueue = real.map(function (yid) { return wantName[yid] || yid; });
    A.queueTop = want.length ? want[0].name : null;
    // the exact list the queue holds, in order, for the overlay to show
    var prevPlan = (A.plan || []).map(function (w) { return w.name; });
    A.plan = want.map(function (w) { return { name: w.name, pos: w.pos, vor: w.vor }; });
    /* Show the adjustment, not just its result: which plan entries were
     * taken off the board since the last pass, and what replaced them. */
    var nowPlan = A.plan.map(function (w) { return w.name; });
    var gone = prevPlan.filter(function (n) { return nowPlan.indexOf(n) < 0; });
    var came = nowPlan.filter(function (n) { return prevPlan.indexOf(n) < 0; });
    if (gone.length || came.length) {
      A.planChange = { at: cur, gone: gone, came: came, ts: Date.now() };
    }
    var lastPk = Object.keys(A.picks).map(Number).filter(function (k) { return k < cur; })
      .sort(function (a, b) { return b - a; })[0];
    if (lastPk) { var lp = A.picks[lastPk]; A.lastBoardPick = { pick: lastPk, name: lp.name, pos: lp.pos, drafter: lp.drafter, dt: lp.dt }; }

    enableAutodraft();
    draftClick(st, res, yidOf, slotM ? +slotM[1] : null, cur);

    A.last = {
      pick: cur, round: st.round, upIn: st.upIn, clock: st.clock,
      onClock: st.onClock, rec: res.recommendation && res.recommendation.name,
      recPos: res.recommendation && res.recommendation.pos,
      target: res.target_position,
      rosterCount: roster.length, picksRemaining: remaining,
      poolSize: pool.length, unmatched: unmatched,
      queuedAdded: added, queuedRemoved: removed, queueTop: A.queueTop,
      yq: A.yahooQueue.slice(0, 3).join('>'),
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
          /* Yahoo's projections first: the position-paged scrape only works
           * while the room is live (draft 7 could not be graded on Yahoo's
           * scale because the scrape was attempted after the end). */
          Promise.resolve(window.__hcYahooProj ? window.__hcYahooProj() : null)
            .then(function () { return window.__hcHarvest(); })
            .then(function (h) {
            try {
              localStorage.setItem('hcFinalHarvest', JSON.stringify(h));
              A.finalHarvest = { teams: Object.keys(h.teams || {}).length,
                                 me: h.me, at: Date.now() };
            } catch (e) {}
            // the league-wide report: every team graded, the near misses,
            // the story of the draft (bridge/report.js)
            try { if (window.__hcReport) A.report = window.__hcReport(h); } catch (e) { A.reportError = String(e); }
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

  // Seed the roster from the Results tab as soon as the room is readable:
  // arming late (or after a tab teardown) otherwise leaves the roster empty,
  // every position looks unfilled, and the queue fills with quarterbacks.
  (function seedSoon() {
    var tries = 0;
    function attempt() {
      if (window.__hcHarvest && document.querySelector('.ys-player[data-id]')) {
        /* Nothing of ours exists before our first pick, and the harvest
         * holds the Results tab open for seconds -- in draft 12 it was
         * still reading when pick 7 (ours) came up, no pass ran, and Yahoo
         * took its own top player. Pre-draft or first round before our
         * slot: the roster is empty by definition, skip the read. */
        var st0 = null;
        try { st0 = window.__hcReaders.readStatus(); } catch (e) { st0 = { pick: 1e9 }; }  // unreadable: seed anyway
        var m0 = location.pathname.match(/\/draftclient\/f1\/(\d+)\/(\d+)/);
        var slot0 = m0 ? +m0[2] : 0;
        if (!st0 || !st0.pick || (slot0 && st0.pick <= slot0)) {
          A.seededAtLoad = 'skipped:before-first-pick';
          return;
        }
        Promise.resolve(A.seedRosterFromResults()).then(function () { A.seededAtLoad = true; });
        return;
      }
      if (++tries < 200) {
        var ch = new MessageChannel();
        ch.port1.onmessage = attempt;
        ch.port2.postMessage(0);
      }
    }
    attempt();
  })();

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
      var t0 = Date.now();
      try {
        if (window.__hcProf) window.__hcProf('tick', tick); else tick();
        if (window.__hcProf) window.__hcProf('persist', persist); else persist();
      } catch (e) { A.lastError = String(e); }
      /* Measure every pass and back off when the page cannot afford it.
       * The draft client shares this thread; a pass that takes 300 ms every
       * second is a third of the CPU, and that is what "the page keeps
       * going unresponsive" looks like from the outside. */
      var ms = Date.now() - t0;
      A.passMs = ms;
      A.passMax = Math.max(A.passMax || 0, ms);
      A.passTotal = (A.passTotal || 0) + ms; A.passCount = (A.passCount || 0) + 1;
      // a pass that clicks costs ~200-400 ms of Yahoo's re-render by design;
      // back off only when it is worse than that, and never past 4 s, or the
      // queue refills too slowly after our own pick
      var near = A.last && A.last.upIn != null && A.last.upIn <= 2;
      if (near) A.RATE_MS = 1000;   // our pick is imminent: the queue must be right now
      else if (ms > 600 && A.RATE_MS < 4000) A.RATE_MS = Math.min(4000, A.RATE_MS * 2);
      else if (ms < 250 && A.RATE_MS > 1000) A.RATE_MS = Math.max(1000, A.RATE_MS / 2);
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
      'roster=' + (l.rosterCount == null ? '?' : l.rosterCount)
        + (l.picksRemaining != null ? '/left' + l.picksRemaining : ''),
      'pool=' + (l.poolSize == null ? '?' : l.poolSize),
      'unmatched=' + (l.unmatched == null ? '?' : l.unmatched),
      'queued=' + ((A.yahooQueue || []).length) + '/' + Object.keys(A.queued).length,
      'qtop=' + (A.queueTop || '-'),
      'yq=' + ((A.yahooQueue || []).slice(0, 2).join('>') || '-'),
      'autodraft=' + (A.autodraftOn ? 'on' : 'off') + (A.autodraftClicks ? '(clicked' + A.autodraftClicks + ')' : ''),
      'observed=' + A.log.length,
      'picklog=' + Object.keys(A.picks).length,
      'restored=' + (A.restored || 0),
      'alive=' + (A.observer ? 'yes' : 'no'),
      // staleness is the failure that looks like success: report it loudly
      'lastTick=' + (A.last ? Math.round((Date.now() - A.last.ts) / 1000) + 's' : 'NEVER'),
      'pass=' + (A.passMs == null ? '?' : A.passMs + 'ms') + '/max' + (A.passMax || 0)
        + '/avg' + (A.passCount ? Math.round(A.passTotal / A.passCount) : 0) + '/every' + A.RATE_MS,
      'prof=[' + (window.__hcProfile ? window.__hcProfile() : '-') + ' pre:' + (A.preMs == null ? '?' : A.preMs + 'ms') + ' reconcile:' + (A.reconcileMs == null ? '?' : A.reconcileMs + 'ms') + ' seq:' + (A.seqMs == null ? '?' : A.seqMs + 'ms') + ']',
      'dialogs=' + ((window.__hcDialogs || []).length),
      A.blind ? 'BLIND=' + A.blind : '',
      A.blindRecoveries ? 'recovered=' + A.blindRecoveries : '',
      A.filterFixes ? 'filterfix=' + A.filterFixes : '',
      A.report ? 'report=ready' : (A.reportError ? 'report=ERR ' + A.reportError.slice(0, 40) : ''),
      'draftclick=' + (A.draftClicks || 0) + (A.draftMiss ? '(' + A.draftMiss + (A.draftDiag ? ' cells' + A.draftDiag.cells + '/table' + A.draftDiag.inTable + '/btns' + A.draftDiag.draftButtons : '') + ')' : '')
        + (A.draftLog && A.draftLog.length ? '[' + A.draftLog[A.draftLog.length - 1] + ']' : ''),
      'harvested=' + (A.finalHarvest ? A.finalHarvest.teams + 'teams' : 'no'),
      'avail=' + (A.availabilityAt != null ? 'opp@' + A.availabilityAt : 'adp'),
      'autodrafters=' + ((A.autodraftSlots || []).map(function (x) {
        return (A.assumedSlots || []).indexOf(x) >= 0 ? x + '?' : x; }).join(',') || '-'),
      A.DRAFT_DELAY ? 'window=' + A.DRAFT_DELAY + 's' + (A.draftWindowLeft ? '(' + A.draftWindowLeft + ' left)' : '') : '',
      'seed=' + (A.seedRoster ? A.seedRoster.length : 0) + (A.reseeds ? '(x' + A.reseeds + ')' : ''),
      A.lastError ? 'ERR=' + A.lastError.slice(0, 60) : ''
    ].filter(Boolean).join(' ');
  };

  /* Did the ROOM take what the advisor recommended?
   *
   * Four drafts were graded before anyone checked this, and every one of
   * them was drafting from a stale queue. The advice being right is not
   * evidence the pick was right; compare them, pick by pick. */
  A.audit = function () {
    var m = location.pathname.match(/\/draftclient\/f1\/(\d+)\/(\d+)/);
    if (!m) return 'not in a draft room';
    var slot = +m[2], n = A.numTeams || 12, out = [], ok = 0, bad = 0;
    var norm = function (s) { return String(s || '').toLowerCase().replace(/[^a-z]/g, ''); };
    var last = function (s) { return norm(String(s || '').split(' ').slice(-1)[0]); };
    mySnakePicks(n, slot, 20).forEach(function (pk, i) {
      var got = A.picks[pk];
      if (!got) return;
      // the advice standing when the pick was made: the latest entry at or
      // before it, within the same round (Yahoo autodrafts the instant our
      // turn opens, so an entry AT our pick number often never exists)
      var adv = null;
      for (var j = A.log.length - 1; j >= 0; j--) {
        if (A.log[j].pick <= pk && A.log[j].pick > pk - n) { adv = A.log[j]; break; }
      }
      var rec = adv ? adv.rec : null, qtop = adv ? adv.queueTop : null;
      var match = rec && (norm(rec).indexOf(last(got.name)) >= 0
                          || norm(got.name).indexOf(last(rec)) >= 0);
      if (match) ok++; else bad++;
      out.push('r' + (i + 1) + ' pk' + pk + ' rec=' + (rec || '?')
        + (qtop && qtop !== rec ? ' qtop=' + qtop : '')
        + ' got=' + got.name + '/' + got.pos + (match ? ' ok' : ' MISMATCH'));
    });
    return (out.length ? out.join('\n') + '\n' : 'no picks recorded\n')
      + 'matched ' + ok + '/' + (ok + bad);
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
