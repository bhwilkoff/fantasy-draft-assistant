/* Harvey Cup draft advisor -- shared logic.
 *
 * This is a faithful port of engine/advisor.py. It is duplicated in JS on
 * purpose: the in-room overlay must produce advice inside a 60-second pick
 * clock with no network round-trip, and the standalone board must work from
 * a static host. engine/sim.py remains the authority on the weights; if you
 * change a constant here, change it there and re-run the sweep.
 */
(function (root) {
  'use strict';

  var DROPOFF_WEIGHT = 0.0;   // see advisor.py -- VOR already prices scarcity
  var STARTER_BONUS = 3.0;

  var BENCH_TARGET = { QB: 1, RB: 3, WR: 3, TE: 1, K: 0, DEF: 0 };
  /* A player who would sit on the bench is worth only the fraction of his
   * VOR that he is likely to actually start: byes, injuries, and (for
   * flex-eligible positions) a later flex slot. VOR alone measures value
   * over positional replacement, which is the right number for a STARTER
   * and badly wrong for a backup -- in mock 10426834 the advisor recommended
   * Lamar Jackson at pick 53 with Josh Allen already rostered, because a
   * second quarterback's VOR over QB12 beat every receiver's. A second QB
   * starts roughly a game or two a season. */
  var BENCH_DISCOUNT = { QB: 0.2, RB: 0.6, WR: 0.6, TE: 0.35, K: 0, DEF: 0 };
  var POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
  var NUM_TEAMS = 12, ROUNDS = 17, ROSTER_SIZE = 17;

  /* The LINEUP SHAPE is a league parameter too (DECISIONS 010).
   *
   * BASE_STARTERS used to be Harvey Cup's {WR:3, ...} with two flex slots
   * assumed, in every room. A Yahoo mock starts two receivers and ONE flex,
   * so under that rulebook the advisor handed the starter bonus to a third
   * receiver who was not a starter, and computed the cap on tight ends as
   * 1 starter + 1 bench + 2 flex = 4 -- which is exactly how many it drafted.
   * The shape now comes from the same parsed roster the league detector
   * already produces; Harvey Cup's remains the default. */
  var BASE_STARTERS = { QB: 1, RB: 2, WR: 3, TE: 1, K: 1, DEF: 1 };
  var NUM_FLEX = 2;
  var FLEX_ELIGIBLE = { WR: 1, RB: 1, TE: 1 };
  /* Each flex slot's OWN eligibility, in the room's order. Harvey Cup's two
   * are W/T and W/R: a tight end can start in one of them, a running back in
   * one, a receiver in both. Counting every open flex slot as open to every
   * flex-eligible position (the old rule) let a third tight end look like a
   * starter, and the board drafted three tight ends by round seven against a
   * room of humans (slot study, 2026-09-05). */
  var FLEX_SLOTS = [['WR', 'TE'], ['WR', 'RB']];
  /* The k-th bench body at a position is worth BENCH_DECAY^k of the first:
   * the first backup running back starts whenever one of two starters sits,
   * the fourth backup receiver behind five startable receivers almost never
   * does. A flat discount valued them the same and the board carried two
   * running backs into round sixteen while stacking receivers. */
  var BENCH_DECAY = 0.5;
  function setLineup(roster) {
    if (!roster || !roster.base) return;
    var base = {};
    POSITIONS.forEach(function (p) { base[p] = roster.base[p] || 0; });
    BASE_STARTERS = base;
    NUM_FLEX = (roster.flex || []).length;
    var elig = {};
    (roster.flex || []).forEach(function (f) {
      (f.eligible || []).forEach(function (p) { elig[p] = 1; });
    });
    FLEX_ELIGIBLE = elig;
    FLEX_SLOTS = (roster.flex || []).map(function (f) {
      return (f.eligible || []).filter(function (p) { return POSITIONS.indexOf(p) >= 0; });
    }).filter(function (e) { return e.length; });
  }

  /* Roster size MUST come from the room, not from Harvey Cup's 17.
   *
   * A Yahoo mock has 15 slots. With ROSTER_SIZE frozen at 17,
   * picksRemaining = 17 - roster.length never fell to <= 2, so the gate that
   * finally allows a kicker and a defense never opened. The resulting roster
   * had no K and no DEF -- two starting slots scoring zero -- and finished
   * dead last of fourteen. Anything that scales with roster size is a
   * league parameter, never a constant. */
  function setRosterSize(n) {
    if (n && n >= 5 && n <= 40) ROSTER_SIZE = n;
  }
  function rosterSizeFrom(roster) {
    if (!roster || !roster.base) return null;
    var n = 0;
    Object.keys(roster.base).forEach(function (k) { n += roster.base[k]; });
    n += (roster.flex ? roster.flex.length : 0);
    n += (roster.bench || 0);
    return n;
  }

  function erf(x) {
    var s = x < 0 ? -1 : 1; x = Math.abs(x);
    var a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741,
        a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    var t = 1 / (1 + p * x);
    var y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return s * y;
  }
  function normCdf(z) { return 0.5 * (1 + erf(z / Math.SQRT2)); }

  function survival(adp, stdev, pickNumber) {
    if (adp === null || adp === undefined) return 0.5;
    var sd = (stdev && stdev > 0) ? stdev : Math.max(2, adp * 0.18);
    return 1 - normCdf((pickNumber - adp) / sd);
  }

  function snakePicks(slot, numTeams, rounds) {
    numTeams = numTeams || NUM_TEAMS; rounds = rounds || ROUNDS;
    var out = [];
    for (var r = 1; r <= rounds; r++) {
      out.push(r % 2 === 1
        ? (r - 1) * numTeams + slot
        : (r - 1) * numTeams + (numTeams - slot + 1));
    }
    return out;
  }

  function rosterNeeds(roster) {
    var counts = {}; POSITIONS.forEach(function (p) { counts[p] = 0; });
    roster.forEach(function (p) { if (counts[p.pos] !== undefined) counts[p.pos]++; });

    var starterGap = {};
    POSITIONS.forEach(function (p) {
      starterGap[p] = Math.max(0, BASE_STARTERS[p] - counts[p]);
    });
    /* Overflow past the base slots goes into the flex slots that will take
     * it: each slot, in the room's order, takes the eligible position with
     * the most overflow left (ties to the slot's own eligibility order).
     * What is left over at a position is its bench. Mirrored exactly in
     * engine/advisor.py; tests/parity_test.py holds the two together. */
    var overflow = {};
    Object.keys(FLEX_ELIGIBLE).forEach(function (p) {
      overflow[p] = Math.max(0, counts[p] - BASE_STARTERS[p]);
    });
    var flexUsedBy = {}, openSlots = [];
    POSITIONS.forEach(function (p) { flexUsedBy[p] = 0; });
    FLEX_SLOTS.forEach(function (elig) {
      var best = null;
      elig.forEach(function (p) {
        if ((overflow[p] || 0) > 0 && (best === null || overflow[p] > overflow[best])) best = p;
      });
      if (best !== null) { overflow[best]--; flexUsedBy[best]++; }
      else openSlots.push(elig);
    });
    var flexOpen = openSlots.length;
    var flexOpenFor = {}, benchDepth = {}, totalGap = {};
    POSITIONS.forEach(function (p) {
      flexOpenFor[p] = openSlots.filter(function (e) { return e.indexOf(p) >= 0; }).length;
      benchDepth[p] = Math.max(0, counts[p] - BASE_STARTERS[p] - flexUsedBy[p]);
      var cap = BASE_STARTERS[p] + BENCH_TARGET[p] + flexOpenFor[p];
      totalGap[p] = Math.max(0, cap - counts[p]);
    });
    return { counts: counts, starterGap: starterGap, totalGap: totalGap, flexOpen: flexOpen,
             flexOpenFor: flexOpenFor, benchDepth: benchDepth };
  }

  /* Exact E[max VOR] among players at `pos` still available at `nextPick`:
   * a player is the best available iff he survives AND everyone above him is gone. */
  function survivalOf(p, nextPick, availability) {
    // an opponent-aware empirical probability (bridge/opponents.js, mirroring
    // engine/opponents.py) wins over the closed-form Normal(ADP) model
    if (availability && availability[p.name] != null) return availability[p.name];
    return survival(p.adp, p.adp_stdev, nextPick);
  }

  function expectedBestLater(pool, pos, nextPick, limit, availability) {
    limit = limit || 40;
    var cands = pool.filter(function (p) { return p.pos === pos; }).slice(0, limit);
    if (!cands.length) return { expected: 0, likely: null };
    var exp = 0, noneSoFar = 1, likely = null;
    for (var i = 0; i < cands.length; i++) {
      var s = survivalOf(cands[i], nextPick, availability);
      exp += cands[i].vor * s * noneSoFar;
      if (!likely && s >= 0.5) likely = cands[i];
      noneSoFar *= (1 - s);
      if (noneSoFar < 1e-4) break;
    }
    return { expected: exp, likely: likely };
  }

  function advise(available, roster, currentPick, nextPick, recentPositions, topN, opts) {
    topN = topN || 6;
    opts = opts || {};
    var pool = available.filter(function (p) { return p.vor !== null && p.vor !== undefined; })
                        .slice().sort(function (a, b) { return b.vor - a.vor; });
    var need = rosterNeeds(roster);
    /* Picks remaining drives the gate that finally permits a kicker and a
     * defense. Deriving it from the roster count has failed twice (a count
     * that ran low kept the gate shut, and two drafts ended with neither).
     * A caller that knows its snake slot can pass the exact number instead,
     * which depends only on the current pick number. */
    var picksRemaining = (opts.picksRemaining != null)
      ? opts.picksRemaining : Math.max(0, ROSTER_SIZE - roster.length);

    var usable = POSITIONS.filter(function (p) { return need.totalGap[p] > 0; });
    // K and DEF are worth ~a point a week over the waiver alternative, and
    // there are exactly 12 of each for 12 teams. Never before the end.
    /* Open the gate at 4 picks left (was 2, then 3). The queue is fed a
     * pass at a time and an end-game of autodrafters moves a pick every two
     * seconds; opened at 2 the defense missed pick 161 (mock 10427900), at
     * 3 it missed pick 146 (mock 10430207) because it became the
     * recommendation on the very pick it was needed. K and DEF are worth
     * ~a point a week over the waiver alternative; a bench pick or two
     * earlier is measurably nothing. */
    ['K', 'DEF'].forEach(function (p) {
      var i = usable.indexOf(p);
      if (i >= 0 && picksRemaining > (need.starterGap[p] ? 4 : 1)) usable.splice(i, 1);
    });
    if (!usable.length) {
      usable = ['RB', 'WR', 'TE', 'QB'].filter(function (p) { return need.totalGap[p] > 0; });
      if (!usable.length) usable = ['WR'];
    }
    /* MUST-FILL. With as many picks left as lineup holes (plus one to spare)
     * nothing but a hole may be drafted. Slot study 2026-09-05, mixed room,
     * slot 7: the first quarterback came in round sixteen because every
     * remaining quarterback's VOR was slightly negative and a bench receiver
     * looked less bad. A lineup slot scoring zero is the one outcome the
     * draft cannot recover from; the waiver wire fixes everything else. */
    var holes = 0;
    POSITIONS.forEach(function (p) { holes += need.starterGap[p]; });
    if (holes > 0 && picksRemaining <= holes + 1) {
      var must = usable.filter(function (p) { return need.starterGap[p] > 0; });
      if (must.length) { usable = must; need.mustFill = true; }
    }

    var now = {}, later = {};
    usable.forEach(function (p) {
      var c = pool.filter(function (x) { return x.pos === p; });
      now[p] = c.length ? { vor: c[0].vor, player: c[0] } : { vor: 0, player: null };
      later[p] = expectedBestLater(pool, p, nextPick, 40, opts.availability);
    });

    var bestPair = null, bestVal = -1e9;
    usable.forEach(function (p) {
      if (!now[p].player) return;
      usable.forEach(function (q) {
        var v = now[p].vor + later[q].expected;
        if (v > bestVal) { bestVal = v; bestPair = [p, q]; }
      });
    });
    var targetPos = bestPair ? bestPair[0] : (usable[0] || 'WR');

    var runs = {};
    (recentPositions || []).slice(-8).forEach(function (p) { runs[p] = (runs[p] || 0) + 1; });

    var ranked = [];
    /* Candidates: the best eighty by VOR, plus the best three at every
     * position we can still use -- so the last rounds, when the top of the
     * board is all positions we have filled, still rank the real choices
     * instead of falling through to the emergency pick. */
    var cands = pool.slice(0, 80);
    usable.forEach(function (p) {
      var extra = 0;
      for (var k = 0; k < pool.length && extra < 3; k++) {
        if (pool[k].pos !== p) continue;
        if (cands.indexOf(pool[k]) < 0) cands.push(pool[k]);
        extra++;
      }
    });
    cands.forEach(function (c) {
      if (!(need.totalGap[c.pos] > 0)) return;
      if (need.mustFill && !(need.starterGap[c.pos] > 0)) return;
      if ((c.pos === 'K' || c.pos === 'DEF') && usable.indexOf(c.pos) < 0) return;
      var surv = survivalOf(c, nextPick, opts.availability);
      var drop = now[c.pos] ? (now[c.pos].vor - later[c.pos].expected) : 0;
      var tierLeft = pool.filter(function (x) {
        return x.pos === c.pos && x.tier === c.tier;
      }).length;
      var starts = need.starterGap[c.pos] > 0 || need.flexOpenFor[c.pos] > 0;
      var benchW = BENCH_DISCOUNT[c.pos] * Math.pow(BENCH_DECAY, need.benchDepth[c.pos] || 0);
      /* The discount shrinks a bench player's VALUE, never his deficit: a
       * player below replacement is worth about nothing wherever he sits,
       * and multiplying a negative VOR by 0.3 made him look better than a
       * starter with a smaller deficit (that is how the quarterback went
       * unfilled). */
      var benchVal = c.vor > 0 ? c.vor * benchW : c.vor;
      /* AN OPEN LINEUP SLOT MUST BE FILLED, so for a position with a hole the
       * cost of waiting is real: what the best available there is worth now
       * minus what the best available is expected to be worth at our next
       * pick. VOR alone assumes a replacement-level player will be there
       * when we finally fill the hole; in a room of autodrafters hoarding
       * quarterbacks (slot study 2026-09-05, Yahoo room, slot 1) the 13th
       * quarterback was gone by round ten and the first one we took was the
       * 20th, in round sixteen. Positions without a hole get no such term --
       * that is the double-count the dropoff experiments rejected. */
      var holeUrgency = need.starterGap[c.pos] > 0 ? Math.max(0, drop) : 0;
      var score = (starts ? c.vor : benchVal)
                + DROPOFF_WEIGHT * drop * (1 - surv)
                + holeUrgency
                + (need.starterGap[c.pos] > 0 ? STARTER_BONUS : 0);
      ranked.push({
        name: c.name, pos: c.pos, team: c.team, tier: c.tier, bye: c.bye,
        vor: c.vor, points: c.points, adp: c.adp, edge: c.edge,
        injury: c.injury, survival_next: Math.round(surv * 1000) / 1000,
        position_dropoff: Math.round(drop * 10) / 10,
        tier_players_left: tierLeft,
        score: Math.round(score * 100) / 100,
        is_target_position: c.pos === targetPos
      });
    });
    ranked.sort(function (a, b) { return b.score - a.score; });

    var positionView = {};
    usable.forEach(function (p) {
      positionView[p] = {
        best_now: Math.round(now[p].vor * 10) / 10,
        best_now_player: now[p].player ? now[p].player.name : null,
        expected_best_later: Math.round(later[p].expected * 10) / 10,
        dropoff: Math.round((now[p].vor - later[p].expected) * 10) / 10,
        likely_still_there: later[p].likely ? later[p].likely.name : null
      };
    });

    /* NEVER HAND BACK "NOTHING" WITH PLAYERS ON THE BOARD.
     *
     * ranked only holds candidates from the first 80 of the pool that fill a
     * gap, so a board whose top is entirely positions we have filled leaves
     * it empty and the recommendation was null. On draft day 2026-09-05 that
     * happened at pick 199 of the simulated Harvey Cup draft -- the last
     * pick -- and a null recommendation in a live room means the panel shows
     * nothing and the autopilot has nothing to click. Fall back in two
     * steps: the best player anywhere in the pool at a position that still
     * has a gap, then the best player left at all. A bench body we cannot
     * start beats an empty roster slot. */
    if (!ranked.length && pool.length) {
      var fb = pool.filter(function (c) { return need.totalGap[c.pos] > 0; })[0]
            || pool.filter(function (c) { return c.pos !== 'K' && c.pos !== 'DEF'; })[0]
            || pool[0];
      if (fb) {
        ranked.push({
          name: fb.name, pos: fb.pos, team: fb.team, tier: fb.tier, bye: fb.bye,
          vor: fb.vor, points: fb.points, adp: fb.adp, edge: fb.edge,
          injury: fb.injury, survival_next: null, position_dropoff: 0,
          tier_players_left: 0, score: Math.round((fb.vor || 0) * 100) / 100,
          is_target_position: false, fallback: true
        });
      }
    }

    return {
      current_pick: currentPick, next_pick: nextPick, target_position: targetPos,
      recommendation: ranked[0] || null, alternatives: ranked.slice(1, topN),
      position_view: positionView, roster: need,
      picks_remaining: picksRemaining, recent_runs: runs,
      availability_source: opts.availability ? 'opponents' : 'adp'
    };
  }


  /* ------------------------------------------------------- name matching */
  /* The Yahoo draft room renders a first INITIAL only ("T. Higgins"), so the
   * room-side key can never be more specific than initial+surname+position.
   * That key genuinely collides in the NFL (B. Robinson = Bijan and Brian,
   * both RB; A. Brown = Amon-Ra and A.J., both WR), so callers MUST pass the
   * team, and an unresolvable collision is reported rather than guessed. */
  var SUFFIXES = { jr: 1, sr: 1, ii: 1, iii: 1, iv: 1, v: 1 };
  var TEAM_ALIAS = { JAC: 'JAX', WAS: 'WSH', LA: 'LAR', SD: 'LAC', OAK: 'LV',
                     GNB: 'GB', KAN: 'KC', NWE: 'NE', NOR: 'NO', SFO: 'SF',
                     TAM: 'TB', ARZ: 'ARI', BLT: 'BAL', CLV: 'CLE', HST: 'HOU' };

  function cleanTeam(t) {
    if (!t) return '';
    t = String(t).trim().toUpperCase();
    return TEAM_ALIAS[t] || t;
  }
  function parseName(raw) {
    var s = String(raw || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    // Match engine/names.py exactly: apostrophes vanish, every other
    // non-alphanumeric becomes a separator. "A.J. Brown" -> ["a","brown"]
    // in BOTH languages; tests/parity_test.py guards the equivalence.
    s = s.replace(/'/g, '').replace(/[^a-z0-9 ]/g, ' ');
    var parts = s.split(/\s+/).filter(Boolean);
    // Suffixes are TRAILING only. Filtering them anywhere silently destroys
    // the initials "V." and "I." -- "V. Jefferson" became ["jefferson",
    // "jefferson"] and resolved to Justin Jefferson.
    while (parts.length > 1 && SUFFIXES[parts[parts.length - 1]]) parts.pop();
    if (!parts.length) return ['', ''];
    if (parts.length === 1) return [parts[0], parts[0]];
    return [parts[0], parts[parts.length - 1]];
  }
  /* The Results tab renders a defense as its nickname alone ("Jaguars",
   * pos DEF) with no team column, so a DEF key built from the team is
   * empty and every defense in the room graded as unresolved -- zero
   * points for all twelve, which hid that we had drafted none. */
  var NICKNAME = { cardinals: 'ARI', falcons: 'ATL', ravens: 'BAL', bills: 'BUF',
    panthers: 'CAR', bears: 'CHI', bengals: 'CIN', browns: 'CLE', cowboys: 'DAL',
    broncos: 'DEN', lions: 'DET', packers: 'GB', texans: 'HOU', colts: 'IND',
    jaguars: 'JAX', chiefs: 'KC', raiders: 'LV', chargers: 'LAC', rams: 'LAR',
    dolphins: 'MIA', vikings: 'MIN', patriots: 'NE', saints: 'NO', giants: 'NYG',
    jets: 'NYJ', eagles: 'PHI', steelers: 'PIT', '49ers': 'SF', seahawks: 'SEA',
    buccaneers: 'TB', titans: 'TEN', commanders: 'WSH' };
  function roomKey(name, pos, team) {
    pos = (pos || '').toUpperCase().replace('D/ST', 'DEF').replace('DST', 'DEF');
    if (pos === 'DEF') {
      if (!team) {
        var last = String(name || '').trim().split(/\s+/).pop().toLowerCase();
        team = NICKNAME[last] || team;
      }
      return 'DEF|' + cleanTeam(team);
    }
    var p = parseName(name);
    return pos + '|' + p[0].charAt(0) + '|' + p[1];
  }
  function buildIndex(players) {
    var byKey = {};
    players.forEach(function (p) {
      var k = roomKey(p.name, p.pos, p.team);
      (byKey[k] = byKey[k] || []).push(p);
    });
    return byKey;
  }
  function lookup(index, name, pos, team, adpHint) {
    var bucket = index[roomKey(name, pos, team)];
    if (!bucket || !bucket.length) return { player: null, ambiguous: false };
    if (bucket.length === 1) return { player: bucket[0], ambiguous: false };
    var exact = bucket.filter(function (p) { return cleanTeam(p.team) === cleanTeam(team); });
    if (exact.length === 1) return { player: exact[0], ambiguous: false };
    var pool = exact.length ? exact : bucket;
    // Teammates can share initial+surname+position: in 2026 Bijan Robinson
    // and Brian Robinson Jr. are both ATL running backs, so the room's
    // "B. Robinson" is ambiguous on name and team alike. The draft table
    // also renders ADP, which separates them cleanly.
    if (adpHint != null && !isNaN(adpHint)) {
      var byAdp = pool.slice().filter(function (p) { return p.adp != null; })
        .sort(function (a, b) {
          return Math.abs(a.adp - adpHint) - Math.abs(b.adp - adpHint);
        });
      if (byAdp.length) {
        return { player: byAdp[0], ambiguous: false, resolvedBy: 'adp' };
      }
    }
    var sorted = pool.slice().sort(function (a, b) { return b.vor - a.vor; });
    return { player: sorted[0], ambiguous: true,
             candidates: pool.map(function (p) { return p.name; }) };
  }

  root.HarveyCup = {
    advise: advise, survival: survival, snakePicks: snakePicks,
    rosterNeeds: rosterNeeds, expectedBestLater: expectedBestLater,
    setRosterSize: setRosterSize, rosterSizeFrom: rosterSizeFrom,
    setLineup: setLineup,
    getLineup: function () {
      return { base: BASE_STARTERS, numFlex: NUM_FLEX, flexEligible: FLEX_ELIGIBLE, flexSlots: FLEX_SLOTS };
    },
    getRosterSize: function () { return ROSTER_SIZE; },
    parseName: parseName, roomKey: roomKey, buildIndex: buildIndex,
    lookup: lookup, cleanTeam: cleanTeam,
    POSITIONS: POSITIONS, NUM_TEAMS: NUM_TEAMS, ROUNDS: ROUNDS
  };
})(typeof window !== 'undefined' ? window : globalThis);
