/* Grade a harvested draft in the browser and return a compact table.
 *
 * Shipping fourteen rosters back out of the page hits the tool-output size
 * limit, and the localhost relay is unreachable from an https page without
 * the userscript's GM_xmlhttpRequest. But the page already holds the entire
 * projection set (window.__hcIndex) and the scoring code (HarveyLeague), so
 * the cheapest place to grade is right here -- return fourteen numbers
 * instead of two hundred and ten rows.
 *
 * Scored under the ROOM's rules, not Harvey Cup's: grading a Yahoo mock with
 * our own full-PPR, 6-point-TD rulebook would flatter us for optimising a
 * game nobody else in the room was playing.
 *
 * Mirrors tools/score_mock.py; that file stays the offline authority.
 */
(function () {
  'use strict';

  function bestLineup(roster, base, flex) {
    var by = {};
    roster.forEach(function (p) { (by[p.pos] = by[p.pos] || []).push(p); });
    Object.keys(by).forEach(function (k) {
      by[k].sort(function (a, b) { return b._pts - a._pts; });
    });
    var used = {}, total = 0, starters = [];
    Object.keys(base).forEach(function (pos) {
      var got = 0;
      (by[pos] || []).forEach(function (p) {
        if (got >= base[pos] || used[p._id]) return;
        used[p._id] = 1; total += p._pts; starters.push(p); got++;
      });
    });
    flex.forEach(function (elig) {
      var pool = [];
      elig.forEach(function (pos) {
        (by[pos] || []).forEach(function (p) { if (!used[p._id]) pool.push(p); });
      });
      if (pool.length) {
        var b = pool.reduce(function (a, c) { return c._pts > a._pts ? c : a; });
        used[b._id] = 1; total += b._pts; starters.push(b);
      }
    });
    return { total: total, starters: starters };
  }

  /* source: 'yahoo'  -> grade with Yahoo's own projected points (INDEPENDENT
   *                      of the board we drafted on; this is the honest test)
   *          'ours'   -> grade with our projections re-scored for the room
   *                      (circular, useful only as a cross-check) */
  window.__hcGrade = function (harvest, source) {
    source = source || 'yahoo';
    harvest = harvest || window.__hcHarvested;
    if (!harvest || !harvest.teams) return { error: 'nothing harvested' };
    var L = window.HarveyLeague, HC = window.HarveyCup, idx = window.__hcIndex;
    if (!L || !HC || !idx) return { error: 'stack not armed' };

    var rosterText = (harvest.roster || '').replace(/\n/g, '/');
    var parsed = L.parseRoster(rosterText);
    var scoring = (window.__hcLeagueSummary
      && /harvey/i.test(window.__hcLeagueSummary.scoring))
      ? L.SCORING_PRESETS.harvey_cup : L.SCORING_PRESETS.yahoo_default;

    /* Never mix scales. If Yahoo projections do not cover essentially every
     * drafted player, grading some players on Yahoo's numbers and others on
     * ours produces a ranking that means nothing -- a team with more
     * fallbacks is measured with a different ruler. Fall back wholesale. */
    var cov = 0, tot = 0;
    Object.keys(harvest.teams).forEach(function (t) {
      harvest.teams[t].forEach(function (p) {
        tot++; if (p.yahooProj != null) cov++; });
    });
    var coverage = tot ? cov / tot : 0;
    if (source === 'yahoo' && coverage < 0.95) {
      source = 'ours';
      var degraded = 'yahoo coverage ' + Math.round(coverage * 100)
                   + '% (<95%) -- graded with our projections instead, '
                   + 'consistently, rather than mixing two scales';
    }

    var uid = 0, rows = [], unresolved = [];
    Object.keys(harvest.teams).forEach(function (team) {
      var roster = [];
      harvest.teams[team].forEach(function (pk) {
        var m = HC.lookup(idx, pk.name, pk.pos, pk.team);
        if (!m.player) { unresolved.push(pk.name + '/' + pk.pos); return; }
        var q = {};
        for (var k in m.player) q[k] = m.player[k];
        q._id = ++uid;
        if (source === 'yahoo' && pk.yahooProj != null) {
          q._pts = pk.yahooProj;
          q._src = 'yahoo';
        } else {
          q._pts = L.scorePlayer(q, scoring) * (q.injury_factor == null ? 1 : q.injury_factor);
          q._src = 'ours';
        }
        roster.push(q);
      });
      var r = bestLineup(roster, parsed.base,
        parsed.flex.map(function (f) { return f.eligible; }));
      rows.push({ team: team, pts: Math.round(r.total * 10) / 10,
                  n: harvest.teams[team].length, resolved: roster.length,
                  lineup: r.starters.map(function (s) {
                    return s.pos + ':' + s.name.split(' ').slice(-1)[0]
                         + ':' + Math.round(s._pts); }) });
    });

    rows.sort(function (a, b) { return b.pts - a.pts; });
    rows.forEach(function (r, i) { r.rank = i + 1; });
    var mine = rows.filter(function (r) { return r.team === harvest.me; })[0];

    var yahooCount = 0, total = 0;
    Object.keys(harvest.teams).forEach(function (t) {
      harvest.teams[t].forEach(function (p) {
        total++; if (p.yahooProj != null) yahooCount++; });
    });

    return {
      room: harvest.room, me: harvest.me, rules: scoring.name,
      gradedWith: source,
      degraded: (typeof degraded !== 'undefined') ? degraded : null,
      yahooProjCoverage: total ? Math.round(100 * yahooCount / total) + '%' : '0%',
      lineup: rosterText, numTeams: rows.length,
      myRank: mine ? mine.rank : null,
      myPts: mine ? mine.pts : null,
      spread: rows.length ? Math.round((rows[0].pts - rows[rows.length - 1].pts) * 10) / 10 : 0,
      table: rows.map(function (r) {
        return r.rank + '. ' + r.team + ' ' + r.pts
             + (r.team === harvest.me ? '  <== US' : ''); }),
      myLineup: mine ? mine.lineup : null,
      unresolvedCount: unresolved.length,
      unresolved: unresolved.slice(0, 6)
    };
  };
})();
