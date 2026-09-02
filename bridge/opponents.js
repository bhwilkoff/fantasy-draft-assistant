/* Opponent-aware availability, in the room.
 *
 * Port of engine/opponents.py. "Will he last until my next pick?" is not a
 * question about ADP; it is a question about the specific drafters picking
 * between now and then, and what their rosters already hold. A team with
 * two running backs is not taking a third in round five; three teams that
 * still need a tight end will not let the last startable one through.
 *
 * The autopilot records every pick with the drafter who made it, so each
 * opponent's roster is known. We simulate the intervening picks a few
 * hundred times -- each opponent drafts by noisy ADP but refuses positions
 * he has filled -- and read off an empirical survival probability per
 * player. The advisor consumes it in place of the Normal(ADP) model.
 */
(function () {
  'use strict';

  var DEFAULT_CAP = { QB: 2, RB: 6, WR: 6, TE: 2, K: 1, DEF: 1 };
  var LATE_ONLY = { K: 0.85, DEF: 0.85 };

  // small seeded PRNG so a pass is reproducible for a given board
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function gauss(rnd) {
    var u = 0, v = 0;
    while (u === 0) u = rnd();
    while (v === 0) v = rnd();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  function owner(overall, numTeams) {
    var rnd = Math.floor((overall - 1) / numTeams) + 1;
    var idx = (overall - 1) % numTeams;
    return rnd % 2 === 1 ? idx + 1 : numTeams - idx;
  }

  /* From the autopilot's pick log ({pickNo: {pos, drafter}}), the position
   * counts of whoever owns each pick between now and our next turn. */
  function inferOpponentRosters(picks, numTeams, currentPick, targetPick) {
    var bySlot = {};
    Object.keys(picks).forEach(function (k) {
      var e = picks[k];
      var slot = owner(+k, numTeams);
      bySlot[slot] = bySlot[slot] || {};
      if (e.pos) bySlot[slot][e.pos] = (bySlot[slot][e.pos] || 0) + 1;
    });
    var out = {};
    for (var pk = currentPick; pk < targetPick; pk++) {
      var c = bySlot[owner(pk, numTeams)] || {};
      var copy = {};
      Object.keys(c).forEach(function (p) { copy[p] = c[p]; });
      out[pk] = copy;
    }
    return out;
  }

  /* Which slots are Yahoo's autodraft rather than a person? Autodraft picks
   * land within a second or two of the turn opening; people burn clock. A
   * slot whose picks have (so far) all landed within AUTODRAFT_SECONDS of the
   * previous pick, over at least two observed picks, is treated as autodraft
   * -- and autodraft is the most predictable drafter there is: it takes the
   * best Yahoo-ranked (XRank) player at a position it can still use. */
  var AUTODRAFT_SECONDS = 4;
  function inferAutodraftSlots(picks, numTeams, mySlot) {
    var bySlot = {};
    Object.keys(picks).forEach(function (k) {
      var e = picks[k];
      if (e.dt == null) return;
      var slot = owner(+k, numTeams);
      (bySlot[slot] = bySlot[slot] || []).push(e.dt);
    });
    var out = [];
    Object.keys(bySlot).forEach(function (slot) {
      if (+slot === mySlot) return;
      var dts = bySlot[slot];
      if (dts.length < 2) return;
      var fast = dts.filter(function (d) { return d <= AUTODRAFT_SECONDS; }).length;
      if (fast === dts.length) out.push(+slot);
    });
    return out.sort(function (a, b) { return a - b; });
  }

  function simulateAvailability(pool, currentPick, targetPick, opponentRosters, opts) {
    opts = opts || {};
    var cap = opts.cap || DEFAULT_CAP;
    var autodraft = {};
    (opts.autodraftSlots || []).forEach(function (s) { autodraft[s] = 1; });
    var hasXrank = pool.some(function (p) { return p.xrank != null; });
    var numTeams = opts.numTeams || 12, totalRounds = opts.totalRounds || 17;
    var trials = opts.trials || 200, noise = opts.noise == null ? 6.0 : opts.noise;
    var rnd = mulberry32((opts.seed == null ? currentPick * 7919 : opts.seed) >>> 0);

    var out = {};
    if (targetPick <= currentPick) {
      pool.forEach(function (p) { out[p.name] = 1.0; });
      return out;
    }
    var ranked = pool.filter(function (p) { return p.adp; })
      .slice().sort(function (a, b) { return a.adp - b.adp; });
    var survived = {};
    pool.forEach(function (p) { survived[p.name] = p.adp ? 0 : trials; });

    for (var t = 0; t < trials; t++) {
      var taken = {};
      for (var pk = currentPick; pk < targetPick; pk++) {
        var counts = opponentRosters[pk] || {};
        var roundsDone = Math.floor((pk - 1) / numTeams);
        var isAuto = hasXrank && autodraft[owner(pk, numTeams)];
        var best = null, bestKey = Infinity, seen = 0;
        for (var i = 0; i < ranked.length && seen < 40; i++) {
          var p = ranked[i];
          if (taken[p.name]) continue;
          var pos = p.pos;
          if ((counts[pos] || 0) >= (cap[pos] == null ? 99 : cap[pos])) continue;
          if (LATE_ONLY[pos] && roundsDone < LATE_ONLY[pos] * totalRounds) continue;
          seen++;
          // autodraft: Yahoo's rank, no noise; a person: noisy ADP
          var key = isAuto ? (p.xrank == null ? 9999 : p.xrank)
                           : p.adp + gauss(rnd) * noise;
          if (key < bestKey) { bestKey = key; best = p; }
        }
        if (!best) {
          // nothing eligible: take the best remaining regardless
          for (var j = 0; j < ranked.length; j++) {
            if (!taken[ranked[j].name]) { best = ranked[j]; break; }
          }
        }
        if (!best) break;
        taken[best.name] = 1;
      }
      for (var k = 0; k < ranked.length; k++) {
        if (!taken[ranked[k].name]) survived[ranked[k].name]++;
      }
    }
    Object.keys(survived).forEach(function (n) { out[n] = survived[n] / trials; });
    return out;
  }

  window.__hcOpp = {
    inferOpponentRosters: inferOpponentRosters,
    inferAutodraftSlots: inferAutodraftSlots,
    simulateAvailability: simulateAvailability,
    owner: owner,
    DEFAULT_CAP: DEFAULT_CAP
  };
})();
