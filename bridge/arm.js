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
               'bridge/harvest.js', 'bridge/grade.js', 'bridge/supervise.js'];
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
    var tries = 0;
    function poll() {
      if (window.__hcIndex) {
        load(['bridge/autopilot.js'], function () {
          window.__hcArmed = true;
          console.log('[harvey-cup] advisor + autopilot armed');
        });
        return;
      }
      if (++tries > 400) {
        console.warn('[harvey-cup] data never loaded; autopilot not armed');
        return;
      }
      var ch = new MessageChannel();
      ch.port1.onmessage = poll;
      ch.port2.postMessage(0);
    }
    poll();
  });
})();
