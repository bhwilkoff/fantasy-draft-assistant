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
import scoring, vor, names
import espn as espn_src
import ffc as ffc_src
import sleeper as sleeper_src

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
            if len(same_team) == 1:
                m = same_team[0]
            elif len(bucket) == 1 and not same_team:
                # single candidate league-wide but team disagrees: treat as a
                # trade/roster move only if the first initial also agrees.
                cand = bucket[0]
                if (names.parse_name(cand["name"])[0][:1]
                        == names.parse_name(e["name"])[0][:1]):
                    m = cand
            elif len(bucket) > 1:
                ambiguous += 1
        if m:
            matched += 1
        raw_pts = scoring.score_player(e)

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
        })
    print(f"  matched ADP for {matched}/{len(players)} "
          f"({ambiguous} surname collisions refused)")

    levels, counts = vor.apply_vor(players)
    vor.assign_tiers(players)

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
        },
        "replacement_points": {k: round(v, 2) for k, v in levels.items()},
        "starters_consumed": counts,
        "sources": {
            "projections": "ESPN kona_player_info (raw stats, re-scored)",
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
