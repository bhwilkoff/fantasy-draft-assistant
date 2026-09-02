/* League-wide draft report: a grade and summary for every team, the good
 * choices and near misses, and one story of how the draft transpired.
 *
 * Input is the final harvest (every roster with pick numbers and Yahoo's
 * projections) plus whatever the page knows: the projection set
 * (__hcIndex: ADP, VOR, tiers, byes), the autopilot's pick log (timing per
 * pick, for autodrafter detection) and its advice log (what we wanted at
 * each pick). Only the harvest is required, so the real draft -- overlay
 * only, no autopilot -- gets the same report.
 *
 * Scored under the ROOM's rules on Yahoo's projections when they cover
 * essentially everyone (the grader's rule: never mix two scales).
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
        used[p._id] = 1; total += p._pts; p._slot = pos; starters.push(p); got++;
      });
    });
    flex.forEach(function (elig) {
      var pool = [];
      elig.forEach(function (pos) {
        (by[pos] || []).forEach(function (p) { if (!used[p._id]) pool.push(p); });
      });
      if (pool.length) {
        var b = pool.reduce(function (a, c) { return c._pts > a._pts ? c : a; });
        used[b._id] = 1; total += b._pts; b._slot = 'FLEX'; starters.push(b);
      }
    });
    var bench = roster.filter(function (p) { return !used[p._id]; });
    return { total: total, starters: starters, bench: bench };
  }

  function letter(rank, n) {
    if (n <= 1) return 'A';
    var q = (rank - 1) / (n - 1);
    return q < 0.17 ? 'A' : q < 0.42 ? 'B' : q < 0.67 ? 'C' : q < 0.92 ? 'D' : 'F';
  }
  function r1(x) { return Math.round(x * 10) / 10; }
  function short(name) {
    var w = String(name).split(' ');
    return w.length > 1 && !/D\/ST|DEF/.test(name) ? w[0][0] + '. ' + w.slice(1).join(' ') : name;
  }
  function median(a) {
    if (!a.length) return null;
    var s = a.slice().sort(function (x, y) { return x - y; });
    return s[Math.floor(s.length / 2)];
  }
  function ordinal(n) {
    var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  window.__hcReport = function (harvest) {
    if (!harvest) {
      harvest = window.__hcHarvested;
      if (!harvest) { try { harvest = JSON.parse(localStorage.getItem('hcFinalHarvest') || 'null'); } catch (e) {} }
    }
    if (!harvest || !harvest.teams) return { error: 'nothing harvested' };
    var L = window.HarveyLeague, HC = window.HarveyCup, idx = window.__hcIndex;
    if (!L || !HC || !idx) return { error: 'stack not armed' };
    var A = window.__hcAuto || null;

    var rosterText = (harvest.roster || '').replace(/\n/g, '/');
    var parsed = L.parseRoster(rosterText);
    var scoring = (window.__hcLeagueSummary && /harvey/i.test(window.__hcLeagueSummary.scoring))
      ? L.SCORING_PRESETS.harvey_cup : L.SCORING_PRESETS.yahoo_default;

    // --- flatten every pick, matched to the projection set
    var all = [], uid = 0, cov = 0, tot = 0;
    Object.keys(harvest.teams).forEach(function (team) {
      harvest.teams[team].forEach(function (pk) {
        tot++; if (pk.yahooProj != null) cov++;
        var m = HC.lookup(idx, pk.name, pk.pos, pk.team);
        all.push({ _id: ++uid, team: team, name: m.player ? m.player.name : pk.name,
                   pos: pk.pos, nfl: pk.team || (m.player && m.player.team) || '',
                   pick: pk.pick, yahooProj: pk.yahooProj, player: m.player || null,
                   candidates: m.ambiguous ? (m.candidates || []) : null });
      });
    });
    /* The Results tab carries no ADP, so "B. Robinson RB" resolves to the
     * higher-VOR candidate every time -- Bijan at pick 2 and again at pick
     * 142 for Brian Robinson Jr. One projection-set player is one pick:
     * walk the draft in order and give a repeat the next unused candidate. */
    var usedPlayer = {};
    all.slice().sort(function (a, b) { return (a.pick || 9999) - (b.pick || 9999); }).forEach(function (p) {
      if (!p.player) return;
      if (usedPlayer[p.player.name] && p.candidates && p.candidates.length) {
        var alt = p.candidates.filter(function (n) { return !usedPlayer[n]; })[0];
        if (alt) {
          var bucket = idx[HC.roomKey(p.player.name, p.pos, p.player.team)] || [];
          var altP = bucket.filter(function (q) { return q.name === alt; })[0];
          if (altP) { p.player = altP; p.name = altP.name; }
        }
      }
      usedPlayer[p.player.name] = 1;
    });
    var source = (tot && cov / tot >= 0.95) ? 'yahoo' : 'ours';
    all.forEach(function (p) {
      if (source === 'yahoo' && p.yahooProj != null) p._pts = p.yahooProj;
      else p._pts = p.player ? L.scorePlayer(p.player, scoring) * (p.player.injury_factor == null ? 1 : p.player.injury_factor) : 0;
      p.adp = p.player && p.player.adp ? p.player.adp : null;
      p.vor = p.player ? p.player.vor : null;
      p.tier = p.player ? p.player.tier : null;
      p.bye = p.player ? p.player.bye : null;
      // pick minus ADP: positive = taken later than the market (a value),
      // negative = taken earlier (a reach)
      p.delta = (p.adp && p.pick) ? Math.round(p.pick - p.adp) : null;
    });
    var order = all.filter(function (p) { return p.pick; }).sort(function (a, b) { return a.pick - b.pick; });
    var teamNames = Object.keys(harvest.teams);
    var numTeams = teamNames.length;
    var rounds = order.length ? Math.ceil(order[order.length - 1].pick / numTeams) : 0;

    // --- timing per team (autodrafter fingerprint), from the autopilot's log
    var timing = {};
    if (A && A.picks) {
      Object.keys(A.picks).forEach(function (k) {
        var e = A.picks[k];
        if (!e || e.dt == null) return;
        var p = order.filter(function (x) { return x.pick === +k; })[0];
        if (p) (timing[p.team] = timing[p.team] || []).push(e.dt);
      });
    }

    // a "reach" in the last three rounds is noise (everyone is filling
    // K, DEF and bench); ignore those picks -- unless the draft is that short
    var reachCutoff = rounds > 4 ? numTeams * (rounds - 3) : numTeams * rounds;
    var weakRank = Math.max(numTeams - 2, Math.ceil(numTeams * 0.75));

    // --- team table
    var teams = teamNames.map(function (team) {
      var roster = all.filter(function (p) { return p.team === team; });
      var lu = bestLineup(roster, parsed.base, parsed.flex.map(function (f) { return f.eligible; }));
      var byPos = {};
      lu.starters.forEach(function (p) { byPos[p.pos] = (byPos[p.pos] || 0) + p._pts; });
      var byes = {};
      lu.starters.forEach(function (p) { if (p.bye) (byes[p.bye] = byes[p.bye] || []).push(p); });
      var worstBye = Object.keys(byes).map(function (b) { return { bye: +b, n: byes[b].length, who: byes[b] }; })
        .sort(function (a, b) { return b.n - a.n; })[0] || null;
      var withAdp = roster.filter(function (p) { return p.delta != null; });
      var values = withAdp.slice().sort(function (a, b) { return b.delta - a.delta; }).slice(0, 2)
        .filter(function (p) { return p.delta >= 8; });
      var reaches = withAdp.slice().sort(function (a, b) { return a.delta - b.delta; }).slice(0, 2)
        .filter(function (p) { return p.delta <= -12 && p.pick <= reachCutoff; });
      var dts = timing[team] || [];
      var med = median(dts);
      return { team: team, total: r1(lu.total), starters: lu.starters, bench: lu.bench, byPos: byPos,
               worstBye: worstBye, values: values, reaches: reaches,
               autodraft: (dts.length >= 3 && med != null && med <= 4), medianDt: med, nPicks: roster.length,
               me: team === harvest.me };
    });
    teams.sort(function (a, b) { return b.total - a.total; });
    teams.forEach(function (t, i) { t.rank = i + 1; t.grade = letter(i + 1, numTeams); });
    var positions = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
    positions.forEach(function (pos) {
      var sorted = teams.slice().sort(function (a, b) { return (b.byPos[pos] || 0) - (a.byPos[pos] || 0); });
      sorted.forEach(function (t, i) { t['rank_' + pos] = i + 1; });
    });

    // --- one-pick-late: a team took the same position with a lower projection
    //     right after the pick before it (the nearest thing to a league-wide
    //     near miss that the data can show)
    var late = [];
    for (var i = 1; i < order.length; i++) {
      var prev = order[i - 1], cur = order[i];
      if (prev.team === cur.team || prev.pos !== cur.pos) continue;
      if (!(cur._pts > 0) || !(prev._pts > 0)) continue;          // no projection: no verdict
      if (cur.pick > numTeams * Math.min(10, rounds)) continue;    // late rounds are bench noise
      var d = prev._pts - cur._pts;
      if (d >= 15) late.push({ pick: cur.pick, team: cur.team, got: cur, missed: prev, d: r1(d) });
    }
    late.sort(function (a, b) { return b.d - a.d; });

    // --- our near misses: what we wanted in the passes before our pick, and
    //     who took him first (from the autopilot's advice log)
    var ours = [];
    if (A && A.log && harvest.me) {
      var myPicks = order.filter(function (p) { return p.team === harvest.me; });
      myPicks.forEach(function (mp) {
        var wanted = {};
        A.log.forEach(function (e) {
          if (e.rec && e.pick >= mp.pick - 4 && e.pick < mp.pick) wanted[e.rec] = e.pick;
        });
        Object.keys(wanted).forEach(function (name) {
          if (name === mp.name) return;
          var taker = order.filter(function (p) { return p.name === name && p.pick < mp.pick && p.pick >= mp.pick - 4; })[0];
          // a back-to-back turn: the advice before our second pick was our
          // first pick, which we took -- not a miss
          if (taker && taker.team !== harvest.me) ours.push({ at: mp.pick, wanted: name, taker: taker, got: mp });
        });
      });
    }

    // --- rounds
    var roundNotes = [];
    for (var r = 1; r <= rounds; r++) {
      var picks = order.filter(function (p) { return Math.ceil(p.pick / numTeams) === r; });
      if (!picks.length) continue;
      var counts = {};
      picks.forEach(function (p) { counts[p.pos] = (counts[p.pos] || 0) + 1; });
      var runs = [], run = 1;
      for (var k = 1; k <= picks.length; k++) {
        if (k < picks.length && picks[k].pos === picks[k - 1].pos) { run++; continue; }
        if (run >= 3) runs.push(run + ' ' + picks[k - 1].pos + 's in a row (picks ' + picks[k - run].pick + '-' + picks[k - 1].pick + ')');
        run = 1;
      }
      var fell = picks.filter(function (p) { return p.delta != null && p.delta >= 15; })
        .sort(function (a, b) { return b.delta - a.delta; })[0];
      var reach = picks.filter(function (p) { return p.delta != null && p.delta <= -20; })
        .sort(function (a, b) { return a.delta - b.delta; })[0];
      var firsts = [];
      ['QB', 'TE', 'K', 'DEF'].forEach(function (pos) {
        var f = order.filter(function (p) { return p.pos === pos; })[0];
        if (f && Math.ceil(f.pick / numTeams) === r) firsts.push('first ' + pos + ' off the board: ' + short(f.name) + ' to ' + f.team + ' at ' + f.pick);
      });
      var mine = picks.filter(function (p) { return p.team === harvest.me; });
      var mineText = mine.map(function (p) {
        var adv = null;
        if (A && A.log) {
          var es = A.log.filter(function (e) { return e.pick === p.pick && e.rec; });
          if (es.length) adv = es[es.length - 1].rec;
        }
        return 'We took ' + short(p.name) + ' (' + p.pos + ') at ' + p.pick
          + (p.delta != null ? ' (ADP ' + Math.round(p.adp) + ')' : '')
          + (adv ? (adv === p.name ? ', as advised' : ', advice was ' + short(adv)) : '');
      });
      roundNotes.push({ round: r, counts: counts, runs: runs, fell: fell, reach: reach, firsts: firsts, mine: mineText });
    }

    // --- markdown
    var md = [];
    md.push('# Draft report: room ' + (harvest.room || '?') + ' (' + numTeams + ' teams, ' + rounds + ' rounds)');
    md.push('');
    md.push('Graded by best legal lineup under the room\'s rules (' + scoring.name + ') on '
      + (source === 'yahoo' ? 'Yahoo\'s own projections (' + Math.round(100 * cov / tot) + '% coverage)' : 'our projections (Yahoo coverage too low to use)')
      + '. Values and reaches are ADP minus pick number.'
      + (Object.keys(timing).length ? ' Autodraft detection is from seconds on the clock per pick.' : ''));
    md.push('');
    md.push('## Standings and grades');
    md.push('');
    md.push('| # | Team | Grade | Proj pts | QB | RB | WR | TE | K | DEF | Best value | Biggest reach | Note |');
    md.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    teams.forEach(function (t) {
      var v = t.values[0], rc = t.reaches[0];
      var notes = [];
      if (t.me) notes.push('**us**');
      if (t.autodraft) notes.push('autodrafting (median ' + t.medianDt + 's)');
      if (t.worstBye && t.worstBye.n >= 3) notes.push(t.worstBye.n + ' starters on bye ' + t.worstBye.bye);
      md.push('| ' + t.rank + ' | ' + t.team + ' | ' + t.grade + ' | ' + t.total
        + ' | ' + positions.map(function (pos) { return ordinal(t['rank_' + pos]); }).join(' | ')
        + ' | ' + (v ? short(v.name) + ' (+' + v.delta + ')' : '—')
        + ' | ' + (rc ? short(rc.name) + ' (' + rc.delta + ')' : '—')
        + ' | ' + notes.join(', ') + ' |');
    });
    md.push('');
    md.push('## Team by team');
    teams.forEach(function (t) {
      md.push('');
      md.push('### ' + t.rank + '. ' + t.team + ' — ' + t.grade + ', ' + t.total + ' projected' + (t.me ? ' (us)' : ''));
      md.push('');
      md.push('Starters: ' + t.starters.map(function (p) { return p._slot + ' ' + short(p.name) + ' ' + Math.round(p._pts); }).join(' · '));
      md.push('');
      md.push('Bench: ' + (t.bench.length ? t.bench.map(function (p) { return p.pos + ' ' + short(p.name) + ' ' + Math.round(p._pts); }).join(' · ') : 'none'));
      md.push('');
      var strong = positions.filter(function (pos) { return t['rank_' + pos] <= 3 && t.byPos[pos]; })
        .map(function (pos) { return pos + ' (' + ordinal(t['rank_' + pos]) + ')'; });
      var weak = positions.filter(function (pos) { return t['rank_' + pos] >= weakRank; })
        .map(function (pos) { return pos + ' (' + ordinal(t['rank_' + pos]) + (t.byPos[pos] ? '' : ', none drafted') + ')'; });
      var lines = [];
      if (strong.length) lines.push('Strong at ' + strong.join(', ') + '.');
      if (weak.length) lines.push('Weak at ' + weak.join(', ') + '.');
      if (t.values.length) lines.push('Good choices: ' + t.values.map(function (p) {
        return short(p.name) + ' at ' + p.pick + ' (ADP ' + Math.round(p.adp) + ', fell ' + p.delta + ')'; }).join('; ') + '.');
      if (t.reaches.length) lines.push('Reaches: ' + t.reaches.map(function (p) {
        return short(p.name) + ' at ' + p.pick + ' (ADP ' + Math.round(p.adp) + ', ' + (-p.delta) + ' early)'; }).join('; ') + '.');
      if (t.worstBye && t.worstBye.n >= 3) lines.push(t.worstBye.n + ' starters share bye week ' + t.worstBye.bye
        + ' (' + t.worstBye.who.map(function (p) { return short(p.name); }).join(', ') + ').');
      if (t.autodraft) lines.push('Picked in a median of ' + t.medianDt + ' s: this seat was autodrafting from Yahoo\'s list.');
      else if (t.medianDt != null) lines.push('Median ' + t.medianDt + ' s per pick: a human on the clock.');
      md.push(lines.join(' '));
    });
    md.push('');
    md.push('## Near misses');
    md.push('');
    if (ours.length) {
      md.push('Ours (what the advisor wanted in the passes before our pick, and who took him first):');
      md.push('');
      ours.forEach(function (o) {
        md.push('- At pick ' + o.at + ' we wanted ' + short(o.wanted) + '; ' + o.taker.team + ' took him at ' + o.taker.pick
          + '. We took ' + short(o.got.name) + ' (' + Math.round(o.got._pts) + ' vs ' + Math.round(o.taker._pts) + ').');
      });
      md.push('');
    }
    if (late.length) {
      md.push('League-wide, one pick late (same position, lower projection, taken right after):');
      md.push('');
      late.slice(0, 8).forEach(function (l) {
        md.push('- ' + l.team + ' took ' + short(l.got.name) + ' at ' + l.pick + ' one pick after ' + l.missed.team
          + ' took ' + short(l.missed.name) + ' (' + l.d + ' projected points less).');
      });
      md.push('');
    }
    if (!ours.length && !late.length) md.push('None the data can show.');
    md.push('');
    md.push('## How the draft transpired');
    roundNotes.forEach(function (rn) {
      md.push('');
      var parts = [];
      parts.push('**Round ' + rn.round + '**: ' + Object.keys(rn.counts).sort(function (a, b) { return rn.counts[b] - rn.counts[a]; })
        .map(function (pos) { return rn.counts[pos] + ' ' + pos; }).join(', ') + '.');
      rn.runs.forEach(function (x) { parts.push(x.charAt(0).toUpperCase() + x.slice(1) + '.'); });
      rn.firsts.forEach(function (x) { parts.push(x.charAt(0).toUpperCase() + x.slice(1) + '.'); });
      if (rn.fell) parts.push(short(rn.fell.name) + ' fell ' + rn.fell.delta + ' past his ADP to ' + rn.fell.team + ' at ' + rn.fell.pick + '.');
      if (rn.reach) parts.push(rn.reach.team + ' reached ' + (-rn.reach.delta) + ' picks early for ' + short(rn.reach.name) + ' at ' + rn.reach.pick + '.');
      rn.mine.forEach(function (x) { parts.push(x + '.'); });
      md.push(parts.join(' '));
    });
    md.push('');
    var top = teams[0], me = teams.filter(function (t) { return t.me; })[0];
    md.push('**In one line:** ' + top.team + ' won the draft on paper with ' + top.total
      + (me ? (me.rank === 1 ? ' -- that is us.' : '; we finished ' + ordinal(me.rank) + ' with ' + me.total + ', ' + r1(top.total - me.total) + ' behind.') : '.'));
    md.push('');

    var out = { markdown: md.join('\n'), teams: teams.map(function (t) {
      return { team: t.team, rank: t.rank, grade: t.grade, total: t.total, autodraft: t.autodraft }; }),
      source: source, numTeams: numTeams, rounds: rounds };
    try { localStorage.setItem('hcReport', out.markdown); } catch (e) {}
    window.__hcReportOut = out;
    return out;
  };

  /* Put the report on the page as plain text, so a tool that reads page
   * text (or a human with select-all) can lift it out in one go. */
  window.__hcReportShow = function () {
    var out = window.__hcReportOut || window.__hcReport();
    if (!out || !out.markdown) return out;
    var pre = document.getElementById('hc-report');
    if (!pre) {
      pre = document.createElement('pre');
      pre.id = 'hc-report';
      pre.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;overflow:auto;'
        + 'background:#fff;color:#000;z-index:2147483647;padding:16px;font:12px/1.4 monospace;white-space:pre-wrap';
      document.body.appendChild(pre);
    }
    pre.textContent = out.markdown;
    return 'shown';
  };
  window.__hcReportHide = function () {
    var pre = document.getElementById('hc-report');
    if (pre) pre.remove();
    return 'hidden';
  };
})();
