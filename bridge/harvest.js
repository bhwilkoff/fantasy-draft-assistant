/* Harvest every team's roster from a Yahoo draft room's Results tab.
 *
 * The first version walked every .ys-player on the page, which also swept in
 * the AVAILABLE-players table and produced nonsense (numTeams 210, a team
 * called "Draft"). The Results tab is the right source: it has a <select> of
 * team names and, per team, a clean Slot/Player/Bye/Pick table.
 *
 * Async because switching teams re-renders. Usage:
 *   await window.__hcHarvest()
 */
(function () {
  'use strict';

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


  /* Yielding in a hidden tab, which is harder than it looks.
   *
   * setTimeout is throttled to roughly once a MINUTE when the tab is hidden,
   * so `await sleep(450)` across fourteen teams takes fourteen minutes.
   * requestAnimationFrame is worse -- it stops entirely. And a synchronous
   * busy-wait is self-defeating: it blocks the main thread, so React can
   * never perform the re-render we are waiting for.
   *
   * MessageChannel is the one macrotask source Chrome does NOT throttle in
   * background tabs, so we yield through it. React flushes discrete events
   * (like `change`) synchronously, so a couple of yields is usually plenty;
   * we poll for the DOM to actually change rather than guessing a duration. */
  function tick() {
    return new Promise(function (resolve) {
      var ch = new MessageChannel();
      ch.port1.onmessage = function () { resolve(); };
      ch.port2.postMessage(0);
    });
  }
  async function yieldTimes(n) {
    for (var i = 0; i < n; i++) await tick();
  }
  /* Wait until `read()` returns something different from `prev`, or give up. */
  async function until(read, prev, tries) {
    for (var i = 0; i < (tries || 40); i++) {
      var v = read();
      if (v && v !== prev) return v;
      await tick();
    }
    return read();
  }

  function clickByText(text) {
    var e = [].slice.call(document.querySelectorAll('button,a,div,span,li'))
      .filter(function (x) { return x.children.length === 0; })
      .find(function (x) { return T(x) === text; });
    if (e) { e.click(); return true; }
    return false;
  }

  /* The team <select> is the one whose options are not obviously a filter
   * (positions, rounds). We take the select with the most options that are
   * not position codes. */
  function teamSelect() {
    var best = null, bestN = 0;
    [].slice.call(document.querySelectorAll('select')).forEach(function (s) {
      var opts = [].slice.call(s.options).map(function (o) { return T(o); });
      // The Players view's position filter ("All Positions", "Quarterbacks",
      // "Kickers", ...) has six non-code options and was once mistaken for
      // the team list when the Results tab had not rendered yet -- the
      // final harvest of mock 10430207 came back as one team called
      // "Kickers". Exclude anything that looks like a position or a
      // stat-view filter outright.
      if (opts.some(function (o) {
        return /All Positions|Quarterbacks|Running Backs|Wide Receivers|Tight Ends|Kickers|Team Defenses|Season|Projected|Actual|Yahoo/i.test(o);
      })) return;
      var teamish = opts.filter(function (o) {
        return o && !/^(QB|RB|WR|TE|K|DEF|D\/ST|ALL|Round \d+|\d+)$/i.test(o);
      });
      if (teamish.length > bestN) { bestN = teamish.length; best = s; }
    });
    return bestN >= 4 ? best : null;
  }

  /* React controls the select's value, so assigning .value directly is
   * ignored on re-render. Poke the native setter, then fire `change`. */
  function setSelect(sel, value) {
    var proto = Object.getPrototypeOf(sel);
    var setter = Object.getOwnPropertyDescriptor(proto, 'value');
    if (setter && setter.set) setter.set.call(sel, value);
    else sel.value = value;
    sel.dispatchEvent(new Event('input', { bubbles: true }));
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function rosterTable() {
    return [].slice.call(document.querySelectorAll('table')).find(function (t) {
      var head = [].slice.call((t.rows[0] || {}).cells || [])
        .map(function (c) { return T(c); });
      return head.indexOf('Slot') >= 0 && head.indexOf('Player') >= 0;
    });
  }

  function readRoster() {
    var t = rosterTable();
    if (!t) return [];
    var head = [].slice.call((t.rows[0] || {}).cells || []).map(function (c) { return T(c); });
    var pickCol = head.indexOf('Pick');
    var out = [];
    [].slice.call(t.rows).slice(1).forEach(function (tr) {
      var pe = tr.querySelector('.ys-player[data-id]');
      var cells = [].slice.call(tr.cells).map(function (c) { return T(c); });
      var slot = cells[0] || null;
      var pick = (pickCol >= 0 && cells[pickCol]) ? parseInt(cells[pickCol], 10) : null;
      if (!pe) return;
      var parts = cellParts(pe);
      var name = parts[0], pos = null, team = null;
      parts.slice(1).filter(function (s) { return !/^Bye/i.test(s); }).forEach(function (s) {
        if (/^(QB|RB|WR|TE|K|DEF|D\/ST)$/i.test(s)) pos = s.toUpperCase().replace('D/ST', 'DEF');
        else if (/^[A-Za-z]{2,3}$/.test(s) && pos && !team) team = s;
      });
      if (!pos && /^(QB|RB|WR|TE|K|DEF)$/i.test(slot || '')) pos = slot.toUpperCase();
      if (name && pos) {
        /* NO projected-points column exists here. The Results roster table is
         * Slot | Player | Grade | Bye | Pick. An earlier version scanned for
         * "the first number between 40 and 600" and happily read the PICK
         * NUMBER as projected points -- which silently ranked teams by how
         * late they drafted. Yahoo's projections come from the Players table
         * instead; see harvestYahooProjections(). */
        out.push({ name: name, pos: pos, team: team, slot: slot,
                   pick: (pick && !isNaN(pick)) ? pick : null,
                   yid: pe.getAttribute('data-id') });
      }
    });
    return out;
  }

  function rosterSlots() {
    var t = rosterTable();
    if (!t) return null;
    return [].slice.call(t.rows).slice(1)
      .map(function (tr) { return T(tr.cells[0] || {}); })
      .filter(Boolean).join(',');
  }

  /* Yahoo's own projected points, from the Players table (which HAS a
   * "Proj Pts" column). Keyed by the room's player id so it joins to rosters
   * exactly, with no name matching. Toggling the "Drafted" filter is what
   * exposes already-drafted players. */
  window.__hcYahooProj = async function () {
    /* Yahoo's own projected points, from the Players table's "Proj Pts"
     * column, keyed by the room's player id so it joins to rosters with no
     * name matching at all.
     *
     * The table renders only ~100 rows, which covered just 69% of drafted
     * players -- and partial coverage is worse than none, because grading
     * some players on Yahoo's scale and the rest on ours ranks teams with
     * different rulers. So page through the POSITION filter (each position
     * is well under one page) with "Drafted" enabled, which reaches
     * everyone. */
    var map = {};

    function positionSelect() {
      return [].slice.call(document.querySelectorAll('select')).find(function (s) {
        return [].slice.call(s.options).some(function (o) {
          return /All Positions/i.test(T(o)); });
      });
    }
    function setSel(sel, value) {
      var d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(sel), 'value');
      if (d && d.set) d.set.call(sel, value); else sel.value = value;
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    function scrape() {
      var t = null, best = 0;
      [].slice.call(document.querySelectorAll('table')).forEach(function (x) {
        var n = x.querySelectorAll('.ys-player[data-id]').length;
        if (n > best) { best = n; t = x; }
      });
      if (!t) return 0;
      var head = [].slice.call((t.rows[0] || {}).cells || [])
        .map(function (c) { return T(c); });
      var col = head.indexOf('Proj Pts');
      if (col < 0) return 0;
      var added = 0;
      [].slice.call(t.rows).slice(1).forEach(function (tr) {
        var pe = tr.querySelector('.ys-player[data-id]');
        if (!pe || !tr.cells[col]) return;
        var v = parseFloat(T(tr.cells[col]).replace(/[^0-9.\-]/g, ''));
        if (!isNaN(v)) { map[pe.getAttribute('data-id')] = v; added++; }
      });
      return added;
    }

    clickByText('Players');
    await yieldTimes(30);
    // The toggle shows a check icon when on. Set it by STATE, not by a
    // blind click: a click that lands twice, or once on a stale button,
    // leaves the table showing drafted players as available.
    function draftedBtn() {
      var btn = [].slice.call(document.querySelectorAll('button'))
        .find(function (b) { return T(b) === 'Drafted'; });
      if (btn) return btn;
      var e = [].slice.call(document.querySelectorAll('div,span'))
        .filter(function (x) { return x.children.length === 0 && T(x) === 'Drafted'; })[0];
      return e ? (e.closest('button') || e) : null;
    }
    function draftedOn() { var b = draftedBtn(); return !!(b && b.querySelectorAll('svg').length); }
    async function setDrafted(on) {
      for (var k = 0; k < 3 && draftedOn() !== on; k++) {
        var b = draftedBtn(); if (!b) return; b.click(); await yieldTimes(40);
      }
    }
    await setDrafted(true);          // include already-drafted players

    var sel = positionSelect();
    if (!sel) {
      scrape();
    } else {
      var wanted = ['Quarterbacks', 'Wide Receivers', 'Running Backs',
                    'Tight Ends', 'Kickers', 'Team Defenses'];
      var opts = [].slice.call(sel.options);
      for (var i = 0; i < wanted.length; i++) {
        var o = opts.find(function (x) { return T(x) === wanted[i]; });
        if (!o) continue;
        setSel(sel, o.value);
        await yieldTimes(60);
        scrape();
      }
      var all = opts.find(function (x) { return /All Positions/i.test(T(x)); });
      if (all) { setSel(sel, all.value); await yieldTimes(40); }
    }

    await setDrafted(false);         // back to the live board
    window.__hcYahooProjMap = map;
    return map;
  };

  window.__hcHarvest = async function (opts) {
    opts = opts || {};
    clickByText('Results');
    await yieldTimes(30);
    clickByText('Teams');
    // wait for the team list to actually render, not a fixed number of
    // yields -- a busy client takes longer than thirty of them
    var sel = null;
    for (var w = 0; w < 400 && !sel; w++) {
      sel = teamSelect();
      if (!sel) { await yieldTimes(10); if (w % 40 === 39) clickByText('Teams'); }
    }
    if (!sel) return { error: 'team <select> not found on Results tab' };

    var options = [].slice.call(sel.options)
      .map(function (o) { return { value: o.value, label: T(o) }; })
      .filter(function (o) { return o.label; });

    var m0 = location.pathname.match(/\/draftclient\/f1\/(\d+)\/(\d+)/);
    var mySlot0 = m0 ? +m0[2] : null;
    var teams = {}, slots = null, prevSig = null;
    for (var i = 0; i < options.length; i++) {
      // the list is in draft order, so our team is the option at our slot
      if (opts.onlyMe && mySlot0 && i !== mySlot0 - 1) continue;
      setSelect(sel, options[i].value);
      // wait for the table to actually become a DIFFERENT roster, rather
      // than reading the previous team's rows again
      await until(function () {
        var t = rosterTable();
        return t ? t.innerText.slice(0, 400) : null;
      }, prevSig, 60);
      var t = rosterTable();
      prevSig = t ? t.innerText.slice(0, 400) : null;
      var r = readRoster();
      if (r.length) {
        // two managers can share a display label (two "anthony" in mock
        // 10430908 collapsed to one team); keep both by suffixing the second
        var label = options[i].label;
        if (teams[label]) label = label + ' (' + options[i].value + ')';
        teams[label] = r;
        if (!slots) {
          slots = rosterSlots();
          // publish it so the bridge can stop guessing the roster shape
          if (slots) window.__hcRosterText = slots.replace(/\n/g, '/');
        }
      }
    }

    var m = location.pathname.match(/\/draftclient\/f1\/(\d+)\/(\d+)/);
    var slot = m ? +m[2] : null;
    // Our team is the option at our draft slot; the list is in draft order.
    var me = (slot && options[slot - 1]) ? options[slot - 1].label : null;

    // attach Yahoo's projections, keyed by the room's own player ids
    var proj = window.__hcYahooProjMap || {};
    Object.keys(teams).forEach(function (t) {
      teams[t].forEach(function (p) {
        if (proj[p.yid] != null) p.yahooProj = proj[p.yid];
      });
    });

    var payload = {
      room: m ? m[1] : null, slot: slot, me: me,
      numTeams: options.length,
      roster: slots,
      teams: teams,
      harvestedAt: Date.now()
    };

    try {
      var body = JSON.stringify(Object.assign({ source: 'harvest', pick: 99999 }, payload));
      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({ method: 'POST', url: 'http://127.0.0.1:8830/state',
          headers: { 'Content-Type': 'application/json' }, data: body });
      } else {
        fetch('http://127.0.0.1:8830/state', { method: 'POST', mode: 'cors',
          headers: { 'Content-Type': 'application/json' }, body: body })
          .catch(function () {});
      }
    } catch (e) {}

    window.__hcHarvested = payload;
    return payload;
  };
})();
