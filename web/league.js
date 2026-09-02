/* League detection + scoring + replacement levels, in the browser.
 *
 * Originally the engine baked Harvey Cup's rules into data/players.json and
 * shipped finished VOR numbers. That was wrong for two reasons, and a Yahoo
 * mock room exposed both: mock rooms run YAHOO DEFAULT settings
 * (QB/WR/WR/RB/RB/TE/W-R-T/K/DEF, half PPR, 4pt passing TDs), so the overlay
 * was confidently optimising for a different game than the one on screen.
 * And a league can change its settings between now and draft day.
 *
 * So the data plane ships RAW STATS, and scoring plus replacement level are
 * derived at runtime from whatever the room actually says.
 */
(function (root) {
  'use strict';

  /* Shared, near-zero-cost profiler for the browser side. Every heavy
   * function wraps its body in root.__hcProf(name, fn); __hcProfile()
   * returns "name: calls/total ms/max ms" so a frozen room can be diagnosed
   * from one status call instead of guessed at. */
  if (!root.__hcProf) {
    var acc = {};
    root.__hcProf = function (name, fn) {
      var t0 = Date.now();
      try { return fn(); }
      finally {
        var ms = Date.now() - t0;
        var a = acc[name] || (acc[name] = { n: 0, ms: 0, max: 0 });
        a.n++; a.ms += ms; if (ms > a.max) a.max = ms;
      }
    };
    root.__hcProfile = function () {
      return Object.keys(acc).sort(function (x, y) { return acc[y].ms - acc[x].ms; })
        .map(function (k) { return k + ':' + acc[k].n + '/' + acc[k].ms + 'ms/max' + acc[k].max; })
        .join(' ');
    };
    root.__hcProfileReset = function () { acc = {}; };
  }

  var SCORING_PRESETS = {
    yahoo_default: {
      name: 'Yahoo default',
      pass_yd: 1 / 25, pass_td: 4, pass_int: -1,
      rush_yd: 1 / 10, rush_td: 6,
      rec: 0.5, rec_yd: 1 / 10, rec_td: 6,
      two_pt: 2, fum_lost: -2
    },
    harvey_cup: {
      name: 'Harvey Cup',
      pass_yd: 1 / 25, pass_td: 6, pass_int: -1,
      rush_yd: 1 / 10, rush_td: 6,
      rec: 1.0, rec_yd: 1 / 10, rec_td: 6,
      two_pt: 2, fum_lost: -2
    }
  };

  // Kicker distance buckets are the same shape in both; only FG value differs
  // by league, and the spread is a couple of points a season.
  var KICKER = { fg_u40: 3, fg_40_49: 4, fg_50p: 5, pat: 1 };

  function scorePlayer(p, scoring) {
    var s = p.stats || {};
    if (p.pos === 'K') {
      if (s.fg_made_u40 == null) return p.espn_points || 0;
      return s.fg_made_u40 * KICKER.fg_u40
        + (s.fg_made_40_49 || 0) * KICKER.fg_40_49
        + (s.fg_made_50p || 0) * KICKER.fg_50p
        + (s.pat_made || 0) * KICKER.pat;
    }
    if (p.pos === 'DEF') return p.espn_points || 0;
    return (s.pass_yd || 0) * scoring.pass_yd
      + (s.pass_td || 0) * scoring.pass_td
      + (s.pass_int || 0) * scoring.pass_int
      + (s.rush_yd || 0) * scoring.rush_yd
      + (s.rush_td || 0) * scoring.rush_td
      + (s.rec || 0) * scoring.rec
      + (s.rec_yd || 0) * scoring.rec_yd
      + (s.rec_td || 0) * scoring.rec_td
      + (s.fum_lost || 0) * scoring.fum_lost
      + ((s.pass_2pt || 0) + (s.rush_2pt || 0) + (s.rec_2pt || 0)) * scoring.two_pt;
  }

  /* "QB, WR, WR, RB, RB, TE, W/R/T, K, DEF" (or Harvey Cup's
   * "QB, WR, WR, WR, RB, RB, TE, W/T, W/R, K, DEF, BN, BN, ...")
   * -> { base: {QB:1,...}, flex: [ {slot:'W/R/T', eligible:[...]} ], bench: n } */
  function parseRoster(text) {
    var base = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 };
    var flex = [], bench = 0;
    (text || '').split(',').forEach(function (raw) {
      var t = raw.trim().toUpperCase().replace(/\s+/g, '');
      if (!t) return;
      if (t === 'BN' || t === 'BENCH') { bench++; return; }
      if (t === 'IR' || t === 'IR+') return;
      if (t === 'D/ST' || t === 'DST' || t === 'DEF') { base.DEF++; return; }
      if (base[t] !== undefined) { base[t]++; return; }
      // anything with a slash is a flex; its letters name the eligible spots.
      // The draft room's Results tab renders the slashes as decoration, so
      // the slot's text is "WRT" (or "WT", "QWRT") -- accept a bare run of
      // flex letters too, or the flex silently disappears from the lineup
      // (observed live: rosterSize 14, no flex, in a 15-slot room).
      var bare = /^[QWRT]{2,4}$/.test(t) && base[t] === undefined;
      if (t.indexOf('/') >= 0 || bare) {
        var elig = [];
        (bare ? t.split('') : t.split('/')).forEach(function (part) {
          if (part === 'W') elig.push('WR');
          else if (part === 'R') elig.push('RB');
          else if (part === 'T') elig.push('TE');
          else if (part === 'Q') elig.push('QB');
          else if (base[part] !== undefined) elig.push(part);
        });
        if (elig.length) flex.push({ slot: t, eligible: elig });
      }
    });
    return { base: base, flex: flex, bench: bench,
             starters: Object.keys(base).reduce(function (a, k) {
               return a + base[k]; }, 0) + flex.length };
  }

  /* Fill every lineup in the league greedily and read replacement off the
   * last player actually started. This is the only league-specific number in
   * fantasy valuation and the reason we refuse to hardcode "WR36". */
  function replacementLevels(players, roster, numTeams) {
    var pools = {}, idx = {};
    ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].forEach(function (pos) {
      pools[pos] = players.filter(function (p) { return p.pos === pos; })
        .sort(function (a, b) { return b.points - a.points; });
      idx[pos] = 0;
    });
    Object.keys(roster.base).forEach(function (pos) {
      idx[pos] += roster.base[pos] * numTeams;
    });
    // interleave flex slots across the league, best-available each time
    var order = [];
    for (var t = 0; t < numTeams; t++) {
      roster.flex.forEach(function (f) { order.push(f); });
    }
    order.forEach(function (f) {
      var best = null, bestPts = -1e9;
      f.eligible.forEach(function (pos) {
        var i = idx[pos];
        if (pools[pos] && i < pools[pos].length && pools[pos][i].points > bestPts) {
          bestPts = pools[pos][i].points; best = pos;
        }
      });
      if (best) idx[best]++;
    });
    var levels = {}, counts = {};
    Object.keys(pools).forEach(function (pos) {
      var pool = pools[pos];
      var i = Math.min(idx[pos], pool.length - 1);
      levels[pos] = pool.length ? pool[i].points : 0;
      counts[pos] = idx[pos];
    });
    return { levels: levels, counts: counts };
  }

  function assignTiers(players) {
    ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].forEach(function (pos) {
      var pool = players.filter(function (p) { return p.pos === pos; })
        .sort(function (a, b) { return b.points - a.points; });
      if (pool.length < 3) { pool.forEach(function (p) { p.tier = 1; }); return; }
      var head = pool.slice(0, 40), gaps = [];
      for (var i = 0; i < head.length - 1; i++) gaps.push(head[i].points - head[i + 1].points);
      var sorted = gaps.slice().sort(function (a, b) { return a - b; });
      var threshold = Math.max(sorted[Math.floor(sorted.length / 2)] * 2, 1);
      var tier = 1;
      for (var j = 0; j < pool.length; j++) {
        pool[j].tier = tier;
        if (j < pool.length - 1 && pool[j].points - pool[j + 1].points >= threshold && j < 60) tier++;
      }
    });
  }

  /* Re-derive points, replacement and VOR for a given league. Mutates and
   * returns the player array so the advisor can consume it unchanged. */
  function applyLeague(players, opts) {
    var scoring = opts.scoring || SCORING_PRESETS.harvey_cup;
    var roster = opts.roster;
    var numTeams = opts.numTeams || 12;
    players.forEach(function (p) {
      // injury_factor is computed once in engine/build.py from the reported
      // status; re-scoring for a different league must not silently drop it.
      var f = (p.injury_factor == null) ? 1 : p.injury_factor;
      p.points_raw = Math.round(scorePlayer(p, scoring) * 100) / 100;
      p.points = Math.round(p.points_raw * f * 100) / 100;
    });
    var rep = replacementLevels(players, roster, numTeams);
    players.forEach(function (p) {
      p.replacement = Math.round((rep.levels[p.pos] || 0) * 100) / 100;
      p.vor = Math.round((p.points - p.replacement) * 100) / 100;
    });
    // ceiling/floor scale with the player's own uncertainty, which
    // engine/upside.py computed once; re-derive against the new points.
    players.forEach(function (p) {
      var sf = p.sigma_frac == null ? 0.35 : p.sigma_frac;
      p.ceiling = Math.round(p.points * Math.exp(0.95 * sf) * 10) / 10;
      p.floor = Math.round(p.points * Math.exp(-0.95 * sf) * 10) / 10;
      p.ceiling_vor = Math.round((p.ceiling - p.replacement) * 10) / 10;
      p.floor_vor = Math.round((p.floor - p.replacement) * 10) / 10;
    });
    players.sort(function (a, b) { return b.vor - a.vor; });
    players.forEach(function (p, i) { p.vor_rank = i + 1; });
    assignTiers(players);
    var withAdp = players.filter(function (p) { return p.adp; })
      .sort(function (a, b) { return a.adp - b.adp; });
    withAdp.forEach(function (p, i) { p.adp_rank = i + 1; });
    players.forEach(function (p) {
      p.edge = p.adp_rank ? (p.adp_rank - p.vor_rank) : null;
    });
    return { players: players, replacement: rep.levels, counts: rep.counts,
             scoring: scoring, roster: roster, numTeams: numTeams };
  }

  root.HarveyLeague = {
    SCORING_PRESETS: SCORING_PRESETS,
    scorePlayer: scorePlayer, parseRoster: parseRoster,
    replacementLevels: replacementLevels, applyLeague: applyLeague,
    assignTiers: assignTiers
  };
})(typeof window !== 'undefined' ? window : globalThis);
