"""Build the draft data plane: data/players.json.

Design decision worth stating once, because it drives everything downstream:
we keep *valuation* and *timing* strictly separate.

    VOR  answers "how much is this player worth to a Harvey Cup lineup?"
         -> derived only from projected stats scored under our rules.
    ADP  answers "when will he actually come off the board?"
         -> derived only from the market, and used for availability math.

Blending them into a single number (as most public 'value' boards do) throws
away exactly the information a live draft advisor needs: the gap between the
two IS the edge.
"""
import json, os, sys, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "sources"))

import league as L
import scoring, vor, names, upside
import espn as espn_src
import ffc as ffc_src
import sleeper as sleeper_src
import sleeper_proj as sleeper_proj_src
import cbs as cbs_src
import fantasysharks as sharks_src

OUT_DIR = os.path.join(os.path.dirname(HERE), "data")

# Multiplicative haircut on projected points by reported status. ESPN's own
# projections already bake in *some* of this, so these are deliberately mild
# except for the statuses that mean "will miss real time".
INJURY_FACTOR = {
    "ACTIVE": 1.0, None: 1.0, "": 1.0,
    "QUESTIONABLE": 0.97,
    "DOUBTFUL": 0.90,
    "OUT": 0.80,
    "SUSPENSION": 0.80,
    "INJURY_RESERVE": 0.35,
}


def build():
    print("fetching ESPN projections ...")
    espn_rows = espn_src.normalize(espn_src.fetch(limit=600))
    print(f"  {len(espn_rows)} players")

    print("fetching Sleeper injury feed ...")
    sleeper_rows = sleeper_src.normalize(sleeper_src.fetch())
    sleep_by_key, sleep_by_sur = {}, {}
    for r in sleeper_rows:
        sleep_by_key[names.key(r["name"], r["pos"], r["team"])] = r
        sleep_by_sur.setdefault(names.surname_key(r["name"], r["pos"]), []).append(r)
    n_inj = sum(1 for r in sleeper_rows if r.get("injury_status"))
    print(f"  {len(sleeper_rows)} players, {n_inj} carrying an injury status")

    print("fetching Sleeper projections ...")
    try:
        sproj_rows = sleeper_proj_src.normalize(sleeper_proj_src.fetch())
    except Exception as exc:   # a second source is an improvement, never a dependency
        print(f"  UNAVAILABLE ({exc}); building from ESPN alone")
        sproj_rows = []
    print(f"  {len(sproj_rows)} players")

    # Third and fourth stat-line sources (DECISIONS 022). Each is an
    # improvement, never a dependency: a source that fails to fetch is
    # simply absent from the blend for this build.
    extra_sources = [("sleeper", sproj_rows)]
    for label, mod in (("cbs", cbs_src), ("sharks", sharks_src)):
        print(f"fetching {label} projections ...")
        try:
            rows = mod.normalize(mod.fetch())
            print(f"  {len(rows)} players")
        except Exception as exc:
            print(f"  UNAVAILABLE ({exc})")
            rows = []
        extra_sources.append((label, rows))
    src_index = {}
    for label, rows in extra_sources:
        by_key, by_sur = {}, {}
        for r in rows:
            by_key[names.key(r["name"], r["pos"], r["team"])] = r
            by_sur.setdefault(names.surname_key(r["name"], r["pos"]), []).append(r)
        src_index[label] = (by_key, by_sur)

    # Yahoo's own projections, scored by Yahoo under THIS league's rules,
    # read from the league's player list (tools/yahoo_proj_scrape.js). Not
    # a peer source: a bias check. The blend moves toward Yahoo's number by
    # yahoo_bias_weight (config), and the disagreement is recorded so the
    # panel and tools/bias_report.py can show where we are the outlier.
    yahoo_by_key, yahoo_by_sur, yahoo_meta = {}, {}, None
    ypath = os.path.join(OUT_DIR, "sources", "yahoo_league_proj.json")
    if os.path.exists(ypath):
        with open(ypath) as f:
            ydoc = json.load(f)
        yahoo_meta = {k: v for k, v in ydoc.items() if k != "players"}
        for r in ydoc["players"]:
            yahoo_by_key[names.key(r["name"], r["pos"], r["team"])] = r
            yahoo_by_sur.setdefault(names.surname_key(r["name"], r["pos"]), []).append(r)
        print(f"Yahoo league projections: {len(ydoc['players'])} players, fetched {yahoo_meta.get('fetched')}")
    yahoo_w = float(L.CONFIG.get("sources", {}).get("yahoo_bias_weight", 0.2))
    kdef_w = float(L.CONFIG.get("sources", {}).get("kdef_yahoo_weight", 0.5))

    def find_in(by_key, by_sur, e):
        r = by_key.get(names.key(e["name"], e["pos"], e["team"]))
        if r is not None:
            return r
        bucket = by_sur.get(names.surname_key(e["name"], e["pos"]), [])
        same = [x for x in bucket
                if names.clean_team(x["team"]) == names.clean_team(e["team"])
                and names.first_names_compatible(
                    names.parse_name(x["name"])[0],
                    names.parse_name(e["name"])[0])]
        return same[0] if len(same) == 1 else None

    print("fetching FFC ADP ...")
    ffc_rows, ffc_meta = ffc_src.normalize(ffc_src.fetch(fmt="ppr", teams=12))
    print(f"  {len(ffc_rows)} players from {ffc_meta.get('total_drafts')} drafts")

    # Exact key first; then a surname bucket disambiguated by TEAM. We never
    # accept an ambiguous surname match, because a wrong ADP is far worse
    # than a missing one -- it moves a first-rounder to the 13th round.
    ffc_by_key, ffc_by_surname = {}, {}
    for r in ffc_rows:
        ffc_by_key[names.key(r["name"], r["pos"], r["team"])] = r
        ffc_by_surname.setdefault(names.surname_key(r["name"], r["pos"]), []).append(r)

    players, matched, ambiguous = [], 0, 0
    for e in espn_rows:
        k = names.key(e["name"], e["pos"], e["team"])
        m = ffc_by_key.get(k)
        if m is None:
            bucket = ffc_by_surname.get(names.surname_key(e["name"], e["pos"]), [])
            same_team = [r for r in bucket
                         if names.clean_team(r["team"]) == names.clean_team(e["team"])]
            # Same team + same surname is not identity -- teammates exist.
            same_team = [r for r in same_team
                         if names.first_names_compatible(
                             names.parse_name(r["name"])[0],
                             names.parse_name(e["name"])[0])]
            if len(same_team) == 1:
                m = same_team[0]
            elif len(bucket) == 1 and not same_team:
                # single candidate league-wide but team disagrees: treat as a
                # trade/roster move only if the first initial also agrees.
                cand = bucket[0]
                if names.first_names_compatible(
                        names.parse_name(cand["name"])[0],
                        names.parse_name(e["name"])[0]):
                    m = cand
            elif len(bucket) > 1:
                ambiguous += 1
        if m:
            matched += 1

        # Consensus projection: blend every source's stat line with ESPN's,
        # stat by stat, before scoring (DECISIONS 016, 022). Each stat is
        # the mean over the sources that publish it; each source keeps its
        # own scored total so the overlay can show the disagreement.
        points_espn = scoring.score_player(e)
        per_source = {}
        matched_rows = []
        if e["pos"] in ("QB", "RB", "WR", "TE"):
            for label, (by_key, by_sur) in src_index.items():
                r = find_in(by_key, by_sur, e)
                if r is None:
                    continue
                matched_rows.append((label, r))
                per_source[label] = scoring.score_player({"pos": e["pos"], "stats": r["stats"]})
        if matched_rows:
            lines = [e["stats"]] + [r["stats"] for _, r in matched_rows]
            keys = set()
            for ln in lines:
                keys |= set(ln)
            blended = {}
            for k2 in keys:
                if k2 == "games":
                    blended[k2] = e["stats"].get("games", 0.0)
                    continue
                vals = [ln[k2] for ln in lines if k2 in ln]
                blended[k2] = sum(vals) / len(vals)
            e = dict(e)
            e["stats_espn"] = dict(e["stats"])
            e["stats"] = blended
        raw_pts = scoring.score_player(e)
        points_blend = raw_pts
        # Yahoo bias check (all positions, K and DEF included)
        yr = find_in(yahoo_by_key, yahoo_by_sur, e) if yahoo_by_key else None
        points_yahoo = yr["points"] if yr and yr.get("points") is not None else None
        yahoo_delta = None
        if points_yahoo:
            yahoo_delta = round((points_blend - points_yahoo) / points_yahoo, 3)
            if e["pos"] in ("K", "DEF"):
                # ESPN is the only stat-line source for kickers and defenses,
                # and its kicker lines run ~30% hot (35 field goals a season
                # for the top men against Yahoo's 26). Yahoo's number, scored
                # under these rules, is a genuine second source here.
                raw_pts = points_blend + kdef_w * (points_yahoo - points_blend)
            else:
                raw_pts = points_blend + yahoo_w * (points_yahoo - points_blend)

        # Sleeper's status is timestamped and tracks to within the hour;
        # ESPN's moves only when ESPN rebuilds projections. Prefer Sleeper,
        # fall back to ESPN.
        sk = names.key(e["name"], e["pos"], e["team"])
        sl = sleep_by_key.get(sk)
        if sl is None:
            bucket = sleep_by_sur.get(names.surname_key(e["name"], e["pos"]), [])
            same = [r for r in bucket
                    if names.clean_team(r["team"]) == names.clean_team(e["team"])]
            if len(same) == 1:
                sl = same[0]
        if sl and sl.get("injury_status"):
            injury = sl["injury_status"]
            factor = sleeper_src.factor_for(injury)
            injury_src = "sleeper"
        else:
            injury = e.get("injury_status")
            factor = INJURY_FACTOR.get((injury or "ACTIVE"), 1.0)
            injury_src = "espn"
        players.append({
            "key": k,
            "name": e["name"],
            "pos": e["pos"],
            "team": names.clean_team(e["team"]),
            "espn_id": e["espn_id"],
            "points_raw": round(raw_pts, 2),
            "points": round(raw_pts * factor, 2),
            "espn_points": e["espn_points"],
            "prior_points": e["prior_points"],
            "injury": injury,
            "injury_factor": factor,
            "injury_source": injury_src,
            "injury_body_part": (sl or {}).get("injury_body_part"),
            "injury_news_updated": (sl or {}).get("news_updated"),
            "depth_chart_order": (sl or {}).get("depth_chart_order"),
            "age": (sl or {}).get("age"),
            "years_exp": (sl or {}).get("years_exp"),
            "adp": (m or {}).get("adp") or e.get("espn_adp"),
            "adp_stdev": (m or {}).get("adp_stdev"),
            "adp_source": "ffc" if m and m.get("adp") else "espn",
            "times_drafted": (m or {}).get("times_drafted"),
            "bye": (m or {}).get("bye"),
            "stats": {k2: round(v, 2) for k2, v in e["stats"].items()},
            "breakdown": scoring.explain(e),
            "points_espn": round(points_espn, 2),
            "points_sleeper": None if per_source.get("sleeper") is None else round(per_source["sleeper"], 2),
            "points_cbs": None if per_source.get("cbs") is None else round(per_source["cbs"], 2),
            "points_sharks": None if per_source.get("sharks") is None else round(per_source["sharks"], 2),
            "points_blend": round(points_blend, 2),
            "points_yahoo": None if points_yahoo is None else round(points_yahoo, 2),
            "yahoo_delta": yahoo_delta,
            "sources": 1 + len(per_source),
        })
    print(f"  matched ADP for {matched}/{len(players)} "
          f"({ambiguous} surname collisions refused)")

    # Bye weeks: FFC supplies one only for players it matched. A bye is a
    # property of the TEAM, so fill the rest from teammates -- the season
    # simulator zeroes a player in his bye week, and the advisor checks for
    # starters sharing one.
    team_bye = {}
    for p in players:
        if p.get("bye") and p.get("team"):
            team_bye.setdefault(p["team"], p["bye"])
    for p in players:
        if not p.get("bye") and p.get("team") in team_bye:
            p["bye"] = team_bye[p["team"]]
    print(f"  byes known for {sum(1 for p in players if p.get('bye'))}/{len(players)} "
          f"({len(team_bye)} teams)")

    levels, counts = vor.apply_vor(players)
    vor.assign_tiers(players)
    # per-player season spread -> ceiling/floor. Not a breakout predictor;
    # a statement about who is UNCERTAIN, which is what decides when buying
    # variance is worth real points. See docs/STRATEGY.md section 4.
    upside.annotate(players)

    # Market-inefficiency signal: our rank vs the market's rank.
    ranked_by_adp = sorted([p for p in players if p["adp"]], key=lambda p: p["adp"])
    for i, p in enumerate(ranked_by_adp, 1):
        p["adp_rank"] = i
    for p in players:
        if p.get("adp_rank"):
            p["edge"] = p["adp_rank"] - p["vor_rank"]   # +ve = we like him more
        else:
            p["edge"] = None

    os.makedirs(OUT_DIR, exist_ok=True)
    meta = {
        "generated_at": datetime.datetime.now(datetime.timezone.utc)
                        .isoformat(timespec="seconds"),
        "league": {
            "id": L.LEAGUE_ID, "name": L.LEAGUE_NAME, "teams": L.NUM_TEAMS,
            "rounds": L.ROUNDS, "roster_size": L.ROSTER_SIZE,
            "starters": L.STARTERS, "bench": L.BENCH,
            "ppr": L.OFFENSE["rec"], "pass_td": L.OFFENSE["pass_td"],
            # what the browser needs to run the SAME rules without guessing:
            "roster_text": L.roster_text(),
            "scoring": L.scoring_preset(),
            "flex_eligibility": {k: list(v) for k, v in L.FLEX_ELIGIBILITY.items()},
            "config": os.path.basename(L.CONFIG_PATH),
        },
        "replacement_points": {k: round(v, 2) for k, v in levels.items()},
        "starters_consumed": counts,
        "sources": {
            "projections": ("consensus of ESPN + Sleeper + CBS + FantasySharks "
                            "(raw stats blended per stat, re-scored); "
                            + ", ".join(f"{n} players with {n_src} sources" for n_src, n in sorted(
                                {k: sum(1 for p in players if p.get('sources') == k)
                                 for k in set(p.get('sources') for p in players)}.items()))
                            + "; K/DEF ESPN-only"),
            "yahoo_bias_check": (None if not yahoo_meta else {
                "weight": yahoo_w, "fetched": yahoo_meta.get("fetched"),
                "players_checked": sum(1 for p in players if p.get("points_yahoo") is not None),
            }),
            "injuries": f"Sleeper ({n_inj} statuses)",
            "adp": f"FantasyFootballCalculator PPR 12-team, "
                   f"{ffc_meta.get('total_drafts')} drafts "
                   f"{ffc_meta.get('start_date')}..{ffc_meta.get('end_date')}",
        },
        "player_count": len(players),
    }
    with open(os.path.join(OUT_DIR, "players.json"), "w") as f:
        json.dump({"meta": meta, "players": players}, f, separators=(",", ":"))
    with open(os.path.join(OUT_DIR, "meta.json"), "w") as f:
        json.dump(meta, f, indent=2)
    print(f"wrote {OUT_DIR}/players.json  ({len(players)} players)")
    return meta, players


if __name__ == "__main__":
    build()
