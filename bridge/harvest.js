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

  /* Synchronous busy-wait, deliberately, instead of `await sleep(ms)`.
   *
   * Chrome throttles setTimeout in a hidden tab to roughly once a MINUTE, so
   * an async harvester that waits 450ms between fourteen teams takes fourteen
   * minutes instead of six seconds -- it looks like a hang. Blocking the main
   * thread for a few hundred milliseconds is fine here: nothing else on the
   * page needs to run while we page through the Results tab, and it makes the
   * harvest work identically whether the tab is visible or not. */
  function settle(ms) {
    var end = Date.now() + ms;
    while (Date.now() < end) { /* spin */ }
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
        out.push({ name: name, pos: pos, team: team, slot: slot,
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

  window.__hcHarvest = function () {
    clickByText('Results');
    settle(500);
    clickByText('Teams');
    settle(500);

    var sel = teamSelect();
    if (!sel) return { error: 'team <select> not found on Results tab' };

    var options = [].slice.call(sel.options)
      .map(function (o) { return { value: o.value, label: T(o) }; })
      .filter(function (o) { return o.label; });

    var teams = {}, slots = null;
    for (var i = 0; i < options.length; i++) {
      setSelect(sel, options[i].value);
      settle(350);
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
