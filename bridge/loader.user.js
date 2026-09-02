// ==UserScript==
// @name         Harvey Cup Draft Advisor (loader)
// @namespace    https://github.com/bhwilkoff/fantasy-draft-assistant
// @version      2.2.0
// @updateURL    https://bhwilkoff.github.io/fantasy-draft-assistant/bridge/loader.user.js
// @downloadURL  https://bhwilkoff.github.io/fantasy-draft-assistant/bridge/loader.user.js
// @description  Loads the live draft advisor from GitHub Pages every time, so fixes deploy without reinstalling
// @match        https://football.fantasysports.yahoo.com/draftclient/*
// @match        https://football.fantasysports.yahoo.com/f1/mock_waiting*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/* Install THIS instead of yahoo-draft-bridge.user.js.
 *
 * The full bridge is 30 KB of code that changes whenever Yahoo redeploys or
 * a mock finds a defect; installing it freezes one version in Tampermonkey.
 * This loader never needs to change by hand: it pulls bridge/arm.js from
 * GitHub Pages with a cache-buster every time a draft room opens, and
 * arm.js loads the rest in the right order. Push to main, and the next
 * draft room gets the fix. Tampermonkey updates the loader itself from
 * the @updateURL.
 *
 * WHO DRAFTS. The autopilot (queue + the Draft click) arms when:
 *   - a MOCK room and localStorage.hcMockAutopilot is '1', or
 *   - the HARVEY CUP room (league 539156) and localStorage.hcRealAutopilot
 *     is '1'. That is the plan for the real draft: the autopilot makes the
 *     picks, the human watches the panel and can click Draft first during
 *     the override window (localStorage.hcDraftDelay seconds, default 20
 *     in the real room, 0 in mocks).
 * Set a flag once in the console: localStorage.setItem('hcRealAutopilot','1').
 * The flags are per-origin, so they cannot leak anywhere but Yahoo draft
 * rooms; the overlay's footer shows "autopilot" when it is on.
 *
 * NEVER MISS THE START. On the mock waiting room, with the mock flag set,
 * this script enters the draft client as soon as Yahoo's draft server will
 * have it (from three minutes before the countdown ends, or at once if the
 * countdown is gone -- rooms have started before their own clock said so),
 * and on a "Error connecting to draft server" page it retries every ten
 * seconds until the room opens. The stack then arms the moment the player
 * table renders, well before pick one.
 */
(function () {
  'use strict';
  var REAL_LEAGUE = /\/draftclient\/f1\/539156\//;
  var here = location.pathname;

  function flag(k) { try { return localStorage.getItem(k) === '1'; } catch (e) { return false; } }

  /* ---- waiting room: get into the client early (mocks) ---- */
  if (/\/f1\/mock_waiting/.test(here)) {
    if (!flag('hcMockAutopilot')) return;
    var mlid = (location.search.match(/mlid=(\d+)/) || [])[1];
    if (!mlid) return;
    function slotOf() {
      var m = (document.body.innerText || '').match(/You will draft (\d+)(?:st|nd|rd|th)/i);
      return m ? +m[1] : null;
    }
    function secondsLeft() {
      var m = (document.body.innerText || '').match(/Starts In\s*(\d{1,2}):(\d{2})/i);
      return m ? (+m[1]) * 60 + (+m[2]) : null;
    }
    function go() {
      var slot = slotOf();
      if (!slot) return false;
      try { localStorage.setItem('hcEnterUntil', String(Date.now() + 20 * 60 * 1000)); } catch (e) {}
      location.href = '/draftclient/f1/' + mlid + '/' + slot;
      return true;
    }
    function check() {
      var left = secondsLeft();
      var started = /Draft has Started|Enter Draft/i.test(document.body.innerText || '');
      if (started || left == null || left <= 180) { if (go()) return; }
      setTimeout(check, 5000);   // throttled to a minute in a hidden tab; still fine
    }
    setTimeout(check, 1500);
    return;
  }

  /* ---- draft client ---- */
  var real = REAL_LEAGUE.test(here);
  var mock = !real && flag('hcMockAutopilot');
  var realAuto = real && flag('hcRealAutopilot');
  window.__hcNoAutopilot = !(mock || realAuto);

  // the room is not open yet: retry (only while an entry attempt is live,
  // never on the "Unable to load" page of a finished draft)
  function notOpen() {
    return /Error connecting to draft server/i.test(document.body.innerText || '');
  }
  var until = 0;
  try { until = +(localStorage.getItem('hcEnterUntil') || 0); } catch (e) {}
  if (until > Date.now()) {
    setTimeout(function () { if (notOpen()) location.reload(); }, 10000);
  }

  function arm() {
    if (window.__hcArmed) return;
    var s = document.createElement('script');
    s.src = 'https://bhwilkoff.github.io/fantasy-draft-assistant/bridge/arm.js?v=' + Date.now();
    document.head.appendChild(s);
  }
  // the draft client renders after load; wait for its player table, without
  // timers (throttled in a hidden tab) -- a MutationObserver fires on render
  if (document.querySelector('.ys-player[data-id]')) { arm(); return; }
  var mo = new MutationObserver(function () {
    if (document.querySelector('.ys-player[data-id]')) { mo.disconnect(); arm(); }
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
})();
