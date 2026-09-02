/* One-call re-arm for a Yahoo draft room.
 *
 * Yahoo periodically tears down and recreates the draft-client tab, which
 * destroys anything injected. Re-arming used to take four separate script
 * loads; this loads the whole stack in dependency order from one URL so a
 * recovery is a single action:
 *
 *   var s=document.createElement('script');
 *   s.src='https://bhwilkoff.github.io/fantasy-draft-assistant/bridge/arm.js?v='+Date.now();
 *   document.head.appendChild(s);
 *
 * Set window.__hcNoAutopilot = true beforehand to load the advisory overlay
 * without the autopilot (that is the LIVE-DRAFT configuration -- autopilot is
 * for unattended mock runs only).
 */
(function () {
  'use strict';
  var BASE = 'https://bhwilkoff.github.io/fantasy-draft-assistant/';
  var v = '?v=' + Date.now();

  function load(list, done) {
    if (!list.length) return done();
    var s = document.createElement('script');
    s.src = BASE + list[0] + v;
    s.onload = function () { load(list.slice(1), done); };
    s.onerror = function () {
      console.error('[harvey-cup] failed to load ' + list[0]);
      load(list.slice(1), done);
    };
    document.head.appendChild(s);
  }

  // Remove a previous overlay so re-arming is idempotent.
  var old = document.getElementById('hc-advisor');
  if (old) old.remove();
  try { delete window.__harveyCupBridge; } catch (e) { window.__harveyCupBridge = undefined; }
  if (window.__hcAuto && window.__hcAuto.stop) window.__hcAuto.stop();
  try { delete window.__hcAuto; } catch (e) { window.__hcAuto = undefined; }

  var chain = ['web/league.js', 'web/advisor.js', 'bridge/yahoo-draft-bridge.user.js',
               'bridge/harvest.js', 'bridge/grade.js', 'bridge/supervise.js',
               'bridge/opponents.js'];
  load(chain, function () {
    if (window.__hcNoAutopilot) {
      window.__hcArmed = true;
      console.log('[harvey-cup] advisor armed (no autopilot)');
      return;
    }
    // autopilot needs the bridge's matcher index, which appears only after
    // players.json resolves; poll briefly rather than racing it.
    // setInterval is throttled in hidden tabs, so poll via MessageChannel --
    // the one macrotask source Chrome does not throttle in the background.
    /* Load the autopilot the moment the bridge publishes its matcher index
     * -- event-driven, not polled. Polling via MessageChannel spins the main
     * thread (a yield returns in microseconds, so a 90-second wait is a
     * 90-second busy loop) and starved the draft client badly enough that
     * script evaluation timed out; polling via setTimeout is throttled to
     * once a minute in a long-hidden tab. A property setter costs nothing
     * and fires exactly once, when players.json has resolved. */
    function armAutopilot() {
      if (window.__hcArmed) return;
      load(['bridge/autopilot.js'], function () {
        window.__hcArmed = true;
        console.log('[harvey-cup] advisor + autopilot armed');
      });
    }
    if (window.__hcIndex) {
      armAutopilot();
    } else {
      var idx;
      try {
        Object.defineProperty(window, '__hcIndex', {
          configurable: true, enumerable: true,
          get: function () { return idx; },
          set: function (v) {
            idx = v;
            // turn it back into a plain property before anything else runs
            try { delete window.__hcIndex; } catch (e) {}
            window.__hcIndex = v;
            if (v) armAutopilot();
          }
        });
      } catch (e) {
        window.__hcArmError = 'could not hook __hcIndex: ' + e;
      }
      // belt and braces for the throttled case: one slow timer, no loop
      setTimeout(function () {
        if (!window.__hcArmed && window.__hcIndex) armAutopilot();
        else if (!window.__hcArmed) window.__hcArmError = 'data never loaded; autopilot not armed';
      }, 90000);
    }
  });
})();
