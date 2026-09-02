// ==UserScript==
// @name         Harvey Cup Draft Advisor (loader)
// @namespace    https://github.com/bhwilkoff/fantasy-draft-assistant
// @version      2.0.0
// @description  Loads the live draft advisor from GitHub Pages every time, so fixes deploy without reinstalling
// @match        https://football.fantasysports.yahoo.com/draftclient/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/* Install THIS instead of yahoo-draft-bridge.user.js.
 *
 * The full bridge is 30 KB of code that changes whenever Yahoo redeploys or
 * a mock finds a defect; installing it freezes one version in Tampermonkey.
 * This loader is ten lines that never need to change: it pulls bridge/arm.js
 * from GitHub Pages with a cache-buster every time the draft room opens, and
 * arm.js loads the rest in the right order. Push to main, and the next
 * draft room gets the fix.
 *
 * It arms the ADVISORY overlay only. The autopilot (which queues picks by
 * itself) is for mock rooms and is never loaded from here; to run it in a
 * mock, paste the step-2 line from docs/LIVE-DRAFT-PLAYBOOK.md in the console.
 */
(function () {
  'use strict';
  /* MOCK ROOMS ONLY: run `localStorage.setItem('hcMockAutopilot','1')` once
   * in the console and the loader also arms the autopilot, so a mock is a
   * single step. Remove the flag before a real draft:
   * `localStorage.removeItem('hcMockAutopilot')`. The flag is per-origin,
   * so it cannot leak anywhere but Yahoo draft rooms, and the overlay's
   * footer shows "autopilot" when it is on. */
  var mock = false;
  try { mock = localStorage.getItem('hcMockAutopilot') === '1'; } catch (e) {}
  window.__hcNoAutopilot = !mock;
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
