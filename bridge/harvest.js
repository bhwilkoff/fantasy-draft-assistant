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

  function T(e) { return (e && e.innerText ? e.innerText : '').trim(); }

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
    var out = [];
    [].slice.call(t.rows).slice(1).forEach(function (tr) {
      var pe = tr.querySelector('.ys-player[data-id]');
      var cells = [].slice.call(tr.cells).map(function (c) { return T(c); });
      var slot = cells[0] || null;
      if (!pe) return;
      var parts = T(pe).split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
      var name = parts[0], pos = null, team = null;
      parts.slice(1).filter(function (s) { return !/^Bye/i.test(s); }).forEach(function (s) {
        if (/^(QB|RB|WR|TE|K|DEF|D\/ST)$/i.test(s)) pos = s.toUpperCase().replace('D/ST', 'DEF');
        else if (/^[A-Za-z]{2,3}$/.test(s) && pos && !team) team = s;
      });
      if (!pos && /^(QB|RB|WR|TE|K|DEF)$/i.test(slot || '')) pos = slot.toUpperCase();
      if (name && pos) {
        /* Yahoo prints its OWN projected points in this table. Capture it:
         * grading a draft with the same projections we drafted on is
         * circular and would make us win by construction. Yahoo's number is
         * independent of our ESPN-derived board, so beating the room on
         * Yahoo's own arithmetic is a result that means something. */
        var yProj = null;
        for (var ci = 1; ci < cells.length; ci++) {
          var v = parseFloat(String(cells[ci]).replace(/[^0-9.\-]/g, ''));
          // the points column is a plausible season total, unlike bye week
          // (1-18) or pick number
          if (!isNaN(v) && v >= 40 && v <= 600) { yProj = v; break; }
        }
        out.push({ name: name, pos: pos, team: team, slot: slot,
                   yahooProj: yProj, yid: pe.getAttribute('data-id') });
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

  window.__hcHarvest = async function () {
    clickByText('Results');
    await yieldTimes(30);
    clickByText('Teams');
    await yieldTimes(30);

    var sel = teamSelect();
    if (!sel) return { error: 'team <select> not found on Results tab' };

    var options = [].slice.call(sel.options)
      .map(function (o) { return { value: o.value, label: T(o) }; })
      .filter(function (o) { return o.label; });

    var teams = {}, slots = null, prevSig = null;
    for (var i = 0; i < options.length; i++) {
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
        teams[options[i].label] = r;
        if (!slots) slots = rosterSlots();
      }
    }

    var m = location.pathname.match(/\/draftclient\/f1\/(\d+)\/(\d+)/);
    var slot = m ? +m[2] : null;
    // Our team is the option at our draft slot; the list is in draft order.
    var me = (slot && options[slot - 1]) ? options[slot - 1].label : null;

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
