/* Harvest every team's roster from a finished (or in-progress) Yahoo draft.
 *
 * Produces the payload tools/score_mock.py grades:
 *   {room, me, roster, numTeams, teams: {"Team": [{name,pos,team}, ...]}}
 *
 * Identifying WHICH team is ours is the subtle part. The draft-order strip
 * renders us as the literal string "You", while the pick feed uses our real
 * team name -- so the two cannot be joined on the label. Instead we compute
 * the overall pick numbers our slot owns in a snake draft (the slot is in the
 * URL) and read off whichever team name actually appears at those picks.
 *
 * Call: window.__hcHarvest()  ->  the payload, also POSTed to the relay.
 */
(function () {
  'use strict';

  function T(e) { return (e && e.innerText ? e.innerText : '').trim(); }

  function parsePlayerCell(pe) {
    var parts = T(pe).split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    if (!parts.length) return null;
    var name = parts[0], pos = null, team = null;
    parts.slice(1).filter(function (s) { return !/^Bye/i.test(s); }).forEach(function (s) {
      if (/^(QB|RB|WR|TE|K|DEF|D\/ST)$/i.test(s)) pos = s.toUpperCase().replace('D/ST', 'DEF');
      else if (/^[A-Za-z]{2,3}$/.test(s) && pos && !team) team = s;
    });
    return pos ? { name: name, pos: pos, team: team,
                   yid: pe.getAttribute('data-id') } : null;
  }

  function draftOrder() {
    var cur = document.querySelector('.ys-draftorder-current');
    if (!cur || !cur.parentElement) return [];
    return [].slice.call(cur.parentElement.children)
      .map(function (c) { return T(c).split('\n')[0]; })
      .filter(Boolean);
  }

  function rosterText() {
    var m = (document.body.innerText || '').match(/Roster Positions\s*\n\s*([^\n]+)/i);
    if (m) return m[1];
    return null;
  }

  /* Walk the pick feed. Each pick row contains exactly one .ys-player, a pick
   * number, and the drafting team's name. We climb from the player element to
   * the nearest ancestor that still holds only that one player -- past it we
   * are in the feed and would absorb the neighbouring pick's team name. */
  function readPicks() {
    var out = [];
    [].slice.call(document.querySelectorAll('.ys-player[data-id]')).forEach(function (pe) {
      var row = pe.parentElement, chosen = null;
      for (var i = 0; row && i < 6; i++, row = row.parentElement) {
        if (row.querySelectorAll('.ys-player[data-id]').length > 1) break;
        chosen = row;
      }
      if (!chosen) return;
      var txt = T(chosen);
      var pm = txt.match(/(?:^|\n)\s*(\d{1,3})\s*(?:\n|$)/);
      var player = parsePlayerCell(pe);
      if (!player) return;
      // team name = a line that is not the pick number and not part of the
      // player cell
      var playerLines = T(pe).split('\n').map(function (s) { return s.trim(); });
      var lines = txt.split('\n').map(function (s) { return s.trim(); })
        .filter(function (s) {
          return s && playerLines.indexOf(s) < 0 && !/^\d{1,3}$/.test(s)
                 && !/^Bye/i.test(s) && s.length < 40;
        });
      out.push({ pick: pm ? +pm[1] : null, team: lines[0] || null, player: player });
    });
    return out.filter(function (p) { return p.team; });
  }

  function snakePicks(slot, numTeams, rounds) {
    var out = [];
    for (var r = 1; r <= rounds; r++) {
      out.push(r % 2 === 1 ? (r - 1) * numTeams + slot
                           : (r - 1) * numTeams + (numTeams - slot + 1));
    }
    return out;
  }

  window.__hcHarvest = function () {
    var mSlot = location.pathname.match(/\/draftclient\/f1\/(\d+)\/(\d+)/);
    var mlid = mSlot ? mSlot[1] : null;
    var slot = mSlot ? +mSlot[2] : null;

    var order = draftOrder();
    var numTeams = order.length || 12;
    var picks = readPicks();

    var teams = {};
    picks.forEach(function (p) {
      (teams[p.team] = teams[p.team] || []).push(p.player);
    });

    // which team is us? read the names at the picks our slot owns
    var me = null;
    if (slot) {
      var mine = snakePicks(slot, numTeams, 20);
      var votes = {};
      picks.forEach(function (p) {
        if (p.pick && mine.indexOf(p.pick) >= 0 && p.team) {
          votes[p.team] = (votes[p.team] || 0) + 1;
        }
      });
      var best = 0;
      Object.keys(votes).forEach(function (k) {
        if (votes[k] > best) { best = votes[k]; me = k; }
      });
    }

    var payload = {
      room: mlid, slot: slot, me: me, numTeams: numTeams,
      roster: rosterText() || (window.__hcLeagueSummary
        && window.__hcLeagueSummary.rosterText) || null,
      order: order, teams: teams,
      pickCount: picks.length,
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
