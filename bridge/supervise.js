/* One call that inspects the draft room and does whatever it needs.
 *
 * Monitoring a 210-pick draft by hand meant a different ad-hoc snippet for
 * every failure mode -- re-arm, unfreeze, switch back to Players, harvest,
 * grade -- and each check cost a round trip while the draft moved on. This
 * collapses all of it into `__hcSupervise()`, which returns a single line
 * describing what it found and what it did.
 *
 * It is deliberately conservative: it never navigates (navigation is what
 * loses the room), and it never re-arms something that is already healthy.
 */
(function () {
  'use strict';
  var BASE = 'https://bhwilkoff.github.io/fantasy-draft-assistant/';

  function loadScript(rel, cb) {
    var s = document.createElement('script');
    s.src = BASE + rel + '?v=' + Date.now();
    s.onload = function () { if (cb) cb(true); };
    s.onerror = function () { if (cb) cb(false); };
    document.head.appendChild(s);
  }

  function playersView() {
    var b = [].slice.call(document.querySelectorAll('button,a,div,span,li'))
      .filter(function (x) { return x.children.length === 0; })
      .find(function (x) { return (x.innerText || '').trim() === 'Players'; });
    if (b) { b.click(); return true; }
    return false;
  }

  /* Read the page WITHOUT forcing a layout.
   *
   * `document.body.innerText` triggers a full reflow, and on this draft
   * client that is slow enough that the CDP evaluate calling it times out --
   * which looks exactly like "the renderer is frozen" and sent me chasing
   * ghosts. `textContent` needs no layout at all; we lose the line breaks,
   * which none of these checks depend on. Player counting stays a selector
   * query, which is also layout-free. */
  function pageState() {
    var host = document.querySelector('#root, #app, [data-reactroot]') || document.body;
    var text = (host && host.textContent) || '';
    var players = document.querySelectorAll('.ys-player[data-id]').length;
    var m = null, re = /Round\s+(\d+),\s*Pick\s+(\d+)/gi, mm;
    while ((mm = re.exec(text)) !== null) {
      if (!m || +mm[2] > m.pick) m = { round: +mm[1], pick: +mm[2] };
    }
    return {
      players: players,
      pick: m ? m.pick : null,
      round: m ? m.round : null,
      complete: /Draft Complete|draft (is )?(complete|over|has ended)/i.test(text),
      unloadable: /Unable to load/i.test(text),
      notMember: /not currently a member/i.test(text),
      inRoom: /\/draftclient\//.test(location.pathname)
    };
  }

  window.__hcSupervise = function () {
    var st = pageState();
    var A = window.__hcAuto;
    var notes = [];

    if (!st.inRoom) return 'NOT IN A DRAFT ROOM (path=' + location.pathname + ')';
    if (st.unloadable) return 'ROOM REFUSED TO LOAD -- re-enter via the waiting room';
    if (st.notMember) return 'DROPPED FROM ROOM -- rejoin required';

    // 1. player table missing => wrong view; fix it, that is usually all it is
    if (!st.players) {
      notes.push(playersView() ? 'switched back to Players view'
                               : 'no player table and no Players tab found');
    }

    // 2. stack not armed, or armed and gone stale
    var armed = !!(window.__hcIndex && window.HarveyCup && window.__hcReaders);
    var age = (A && A.last) ? Math.round((Date.now() - A.last.ts) / 1000) : null;
    var stale = (age !== null && age > 45);

    if (!armed) {
      notes.push('stack not armed -> arming');
      loadScript('bridge/arm.js');
      return 'ARMING (was not armed). ' + notes.join('; ');
    }
    if (!A || !A.observer) {
      notes.push('autopilot missing -> loading');
      loadScript('bridge/autopilot.js');
    } else if (stale) {
      notes.push('autopilot stale (' + age + 's) -> restarting');
      try { A.stop(); } catch (e) {}
      try { delete window.__hcAuto; } catch (e) { window.__hcAuto = undefined; }
      loadScript('bridge/autopilot.js');
    }

    // 3. league sanity -- a wrong roster size or team count silently ruins
    //    every gate downstream, so surface it rather than assume
    var L = window.__hcLeague || {};
    var size = (window.HarveyCup && window.HarveyCup.getRosterSize)
      ? window.HarveyCup.getRosterSize() : null;
    var leagueOk = L.numTeams >= 4 && L.numTeams <= 20 && size >= 5 && size <= 40;
    if (!leagueOk) notes.push('LEAGUE LOOKS WRONG teams=' + L.numTeams + ' rosterSize=' + size);

    // 4. draft finished => capture everything while the room is still alive
    if (st.complete && !window.__hcFinalGrade) {
      notes.push('draft complete -> harvesting');
      Promise.resolve(window.__hcYahooProj())
        .then(function () { return window.__hcHarvest(); })
        .then(function () {
          try {
            window.__hcFinalGrade = window.__hcGrade();
            localStorage.setItem('hcFinalGrade', JSON.stringify(window.__hcFinalGrade));
          } catch (e) { window.__hcFinalGradeError = String(e); }
        });
      return 'DRAFT COMPLETE -- harvesting and grading. ' + notes.join('; ');
    }

    var s = A && window.__hcStatus ? window.__hcStatus() : '(no status)';
    return 'OK pick=' + st.pick + ' rd=' + st.round
      + ' | ' + s
      + (notes.length ? ' || ACTIONS: ' + notes.join('; ') : '');
  };
})();
