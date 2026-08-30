/* Standalone draft board.
 *
 * Two jobs. Before the draft it is a study tool: the board is sorted by what
 * a Harvey Cup lineup is actually worth, not by ADP, so the gaps between the
 * two are visible. During the draft it is the manual fallback for the Yahoo
 * overlay -- click a player to mark him gone, shift-click to mark him YOURS,
 * and the same advisor runs against the remaining pool.
 */
(function () {
  'use strict';
  var HC = window.HarveyCup;
  var S = {
    players: [], meta: null, drafted: [], mine: {}, slot: 7,
    filter: 'ALL', order: []
  };
  var KEY = 'harveyCupBoard';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(
        { drafted: S.drafted, mine: S.mine, slot: S.slot }));
    } catch (e) { /* private window: the board still works, it just forgets */ }
  }
  function load() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY) || '{}');
      if (v.drafted) S.drafted = v.drafted;
      if (v.mine) S.mine = v.mine;
      if (v.slot) S.slot = v.slot;
    } catch (e) { /* ignore */ }
  }

  function draftedSet() {
    var s = {}; S.drafted.forEach(function (n) { s[n] = 1; }); return s;
  }
  function available() {
    var d = draftedSet();
    return S.players.filter(function (p) { return !d[p.name]; });
  }
  function myRoster() {
    return S.players.filter(function (p) { return S.mine[p.name]; });
  }

  function picks() { return HC.snakePicks(S.slot, HC.NUM_TEAMS, HC.ROUNDS); }
  function currentPick() { return S.drafted.length + 1; }
  function myNextPick() {
    var c = currentPick();
    var p = picks().filter(function (x) { return x >= c; });
    return p.length ? p[0] : c;
  }
  function myPickAfter() {
    var n = myNextPick();
    var p = picks().filter(function (x) { return x > n; });
    return p.length ? p[0] : n + HC.NUM_TEAMS;
  }

  /* ------------------------------------------------------------- rendering */
  function renderFilters() {
    var f = ['ALL'].concat(HC.POSITIONS);
    $('filters').innerHTML = f.map(function (p) {
      return '<button data-f="' + p + '" class="' + (S.filter === p ? 'on' : '') + '">'
        + p + '</button>';
    }).join('');
    [].forEach.call($('filters').children, function (b) {
      b.onclick = function () { S.filter = b.getAttribute('data-f'); renderFilters(); renderBoard(); };
    });
  }

  function renderBoard() {
    var d = draftedSet();
    var rows = S.players.filter(function (p) {
      return S.filter === 'ALL' || p.pos === S.filter;
    }).slice(0, 300);
    $('board').innerHTML = rows.map(function (p) {
      var cls = (d[p.name] ? 'gone ' : '') + (S.mine[p.name] ? 'mine' : '');
      var edge = p.edge == null ? '' :
        (p.edge > 0 ? '<span class="warn">+' + p.edge + '</span>' : p.edge);
      return '<tr class="' + cls + '" data-n="' + esc(p.name) + '">'
        + '<td class="muted">' + p.vor_rank + '</td>'
        + '<td>' + esc(p.name)
        + (p.injury && p.injury !== 'ACTIVE'
            ? '<span class="chip">' + esc(p.injury.slice(0, 4)) + '</span>' : '')
        + '</td>'
        + '<td><span class="pos ' + p.pos + '">' + p.pos + '</span></td>'
        + '<td class="num">' + p.points.toFixed(0) + '</td>'
        + '<td class="num">' + p.vor.toFixed(0) + '</td>'
        + '<td class="num muted">' + (p.adp == null ? '—' : p.adp) + '</td>'
        + '<td class="num">' + edge + '</td>'
        + '<td class="num muted">' + (p.tier || '') + '</td>'
        + '<td class="num muted">' + (p.bye || '') + '</td></tr>';
    }).join('');
    [].forEach.call($('board').children, function (tr) {
      tr.onclick = function (ev) { toggle(tr.getAttribute('data-n'), ev.shiftKey); };
    });
  }

  function toggle(name, isMine) {
    var i = S.drafted.indexOf(name);
    if (i >= 0) {
      S.drafted.splice(i, 1); delete S.mine[name];
    } else {
      S.drafted.push(name);
      if (isMine) S.mine[name] = 1;
    }
    save(); renderAll();
  }

  function renderAdvice() {
    var avail = available();
    var res = HC.advise(avail, myRoster(), currentPick(), myPickAfter(), []);
    var onClockNow = picks().indexOf(currentPick()) >= 0;

    $('clock').innerHTML =
      'Pick <b>' + currentPick() + '</b> overall · round '
      + (Math.floor((currentPick() - 1) / HC.NUM_TEAMS) + 1)
      + (onClockNow ? ' · <b class="warn">your pick</b>'
        : ' · yours at <b>' + myNextPick() + '</b>')
      + '<br>then again at ' + myPickAfter();

    var r = res.recommendation;
    if (!r) { $('rec').innerHTML = '<span class="muted">No candidates.</span>'; }
    else {
      var why = ['VOR <b>' + r.vor.toFixed(0) + '</b> · ' + r.points.toFixed(0) + ' proj pts'];
      if (r.adp) why.push('ADP ' + r.adp);
      if (r.edge != null && Math.abs(r.edge) >= 8) {
        why.push(r.edge > 0
          ? '<span class="warn">market ' + r.edge + ' picks late</span>'
          : 'going ' + (-r.edge) + ' ahead of value');
      }
      why.push('tier ' + r.tier + ' (' + r.tier_players_left + ' left)');
      $('rec').innerHTML = '<div class="rec"><div class="nm">' + esc(r.name)
        + ' <span class="pos ' + r.pos + '">' + r.pos + '</span>'
        + (r.bye ? '<span class="chip">bye ' + r.bye + '</span>' : '')
        + '</div><div class="why">' + why.join(' · ') + '</div></div>';
    }

    $('alts').innerHTML = res.alternatives.map(function (a) {
      return '<div class="row"><span>' + esc(a.name)
        + ' <span class="pos ' + a.pos + '">' + a.pos + '</span></span>'
        + '<span class="r">vor ' + a.vor.toFixed(0) + ' · '
        + Math.round(a.survival_next * 100) + '% back</span></div>';
    }).join('') || '<span class="muted small">—</span>';

    $('posview').innerHTML = Object.keys(res.position_view).map(function (p) {
      var v = res.position_view[p];
      return '<div class="row"><span><span class="pos ' + p + '">' + p + '</span> '
        + esc(v.best_now_player || '—') + '</span>'
        + '<span class="r">' + (v.dropoff >= 0 ? '−' : '+')
        + Math.abs(v.dropoff).toFixed(0)
        + ' · then ' + esc((v.likely_still_there || '—').split(' ').slice(-1)[0])
        + '</span></div>';
    }).join('');

    var need = res.roster;
    var mine = myRoster();
    $('roster').innerHTML =
      HC.POSITIONS.map(function (p) {
        var gap = need.starterGap[p];
        return '<span class="chip">' + p + ' ' + need.counts[p]
          + (gap ? ' <span class="warn">need ' + gap + '</span>' : '') + '</span>';
      }).join(' ')
      + '<div class="small muted" style="margin-top:6px">flex open ' + need.flexOpen
      + ' · ' + res.picks_remaining + ' picks left</div>'
      + (mine.length
        ? '<div style="margin-top:6px">' + mine.map(function (p) {
            return '<div class="row"><span>' + esc(p.name)
              + ' <span class="pos ' + p.pos + '">' + p.pos + '</span></span>'
              + '<span class="r">' + p.points.toFixed(0) + '</span></div>';
          }).join('') + '</div>'
        : '<div class="small muted" style="margin-top:6px">'
          + 'Shift-click a player to add him to your roster.</div>');
  }

  function renderAll() { renderBoard(); renderAdvice(); }

  /* ------------------------------------------------------------------ boot */
  fetch('../data/players.json', { cache: 'no-store' })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (j) {
      S.players = j.players; S.meta = j.meta;
      load();

      var sel = $('slot');
      for (var i = 1; i <= HC.NUM_TEAMS; i++) {
        var o = document.createElement('option');
        o.value = i; o.textContent = i;
        if (i === S.slot) o.selected = true;
        sel.appendChild(o);
      }
      sel.onchange = function () { S.slot = +sel.value; save(); renderAdvice(); };

      $('undo').onclick = function () {
        var n = S.drafted.pop(); if (n) delete S.mine[n];
        save(); renderAll();
      };
      $('reset').onclick = function () {
        if (!confirm('Clear all drafted players?')) return;
        S.drafted = []; S.mine = {}; save(); renderAll();
      };

      var m = j.meta.league;
      $('leagueLine').textContent =
        m.teams + ' teams · ' + m.ppr + ' PPR · ' + m.pass_td + 'pt pass TD · '
        + Object.keys(m.starters).map(function (k) {
            return m.starters[k] + k;
          }).join(' ');
      $('status').textContent =
        j.players.length + ' players · replacement '
        + Object.keys(j.meta.replacement_points).map(function (k) {
            return k + ' ' + j.meta.replacement_points[k].toFixed(0);
          }).join('  ')
        + ' · built ' + (j.meta.generated_at || '').slice(0, 16);

      renderFilters(); renderAll();
    })
    .catch(function (e) {
      $('status').innerHTML = '<span class="bad">Could not load data/players.json ('
        + esc(e.message) + '). Run <code>python3 engine/build.py</code>.</span>';
    });
})();
