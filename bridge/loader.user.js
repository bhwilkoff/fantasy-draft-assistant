// ==UserScript==
// @name         Harvey Cup Draft Advisor (loader)
// @namespace    https://github.com/bhwilkoff/fantasy-draft-assistant
// @version      2.3.0
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
 * this script clicks "Enter Draft" the instant the link appears (a
 * MutationObserver, which fires even in a background tab), and on a
 * "Error connecting to draft server" page it retries every ten seconds
 * until the room opens. The stack then arms the moment the player table
 * renders, before pick one.
 */
(function () {
  'use strict';
  /* The real league is a setting, not a constant: localStorage.hcRealLeague
   * holds its id (set once in any Yahoo page's console); Harvey Cup's id is
   * the fallback. */
  var realId = '539156';
  try { realId = (localStorage.getItem('hcRealLeague') || '539156').replace(/\D/g, '') || '539156'; } catch (e) {}
  var REAL_LEAGUE = new RegExp('\\/draftclient\\/f1\\/' + realId + '\\/');
  var here = location.pathname;

  function flag(k) { try { return localStorage.getItem(k) === '1'; } catch (e) { return false; } }

  /* ---- waiting room (mocks): into the client the instant Yahoo allows ---- */
  if (/\/f1\/mock_waiting/.test(here)) {
    if (!flag('hcMockAutopilot')) return;
    /* Measured in mock 10515116: the draft client refuses a direct URL
     * ("Error connecting to draft server") until the waiting room offers
     * its "Enter Draft" link, about twenty seconds before the start. So
     * watch for that link and click it at once. A MutationObserver fires
     * in a background tab; timers there are throttled to once a minute,
     * which is how mock 15 lost pick 2. The interval is only a fallback. */
    var entered = false;
    function tryEnter() {
      if (entered) return true;
      var a = [].slice.call(document.querySelectorAll('a, button')).find(function (x) {
        return (x.textContent || '').trim() === 'Enter Draft';
      });
      if (!a) return false;
      entered = true;
      try { localStorage.setItem('hcEnterUntil', String(Date.now() + 20 * 60 * 1000)); } catch (e) {}
      a.removeAttribute('target');
      a.click();
      return true;
    }
    if (tryEnter()) return;
    var wmo = new MutationObserver(function () { if (tryEnter()) wmo.disconnect(); });
    wmo.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    setInterval(tryEnter, 1000);
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
