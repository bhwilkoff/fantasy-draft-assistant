"""FantasyPros season projections -- a projection source built from many.

FantasyPros' "draft" projections are the average of the projection sets
of a few dozen analysts, published as a plain HTML table per position with
raw stat lines (attempts, yards, touchdowns, receptions, fumbles). That
makes it the one source here that is already a consensus, and its stat
lines drop straight into the same per-stat blend as ESPN and Sleeper
(DECISIONS 016: blend the stats, then score under the league's rules).

Unauthenticated, one request per position. Kickers and defenses have
their own pages but only points-style columns, so only QB/RB/WR/TE are
used here.
"""
import html
import re
import urllib.request

URL = "https://www.fantasypros.com/nfl/projections/{pos}.php?week=draft"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128 Safari/537.36")

# column order per position, after the player cell (as published 2026-09)
COLUMNS = {
    "QB": ["pass_att", "pass_cmp", "pass_yd", "pass_td", "pass_int",
           "rush_att", "rush_yd", "rush_td", "fum_lost", "fpts"],
    "RB": ["rush_att", "rush_yd", "rush_td", "rec", "rec_yd", "rec_td", "fum_lost", "fpts"],
    "WR": ["rec", "rec_yd", "rec_td", "rush_att", "rush_yd", "rush_td", "fum_lost", "fpts"],
    "TE": ["rec", "rec_yd", "rec_td", "fum_lost", "fpts"],
}


def fetch_page(pos, timeout=60):
    req = urllib.request.Request(URL.format(pos=pos.lower()), headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def _num(s):
    s = s.replace(",", "").strip()
    try:
        return float(s)
    except ValueError:
        return None


def parse(pos, page):
    """Rows of {name, team, pos, stats} from one position page."""
    cols = COLUMNS[pos]
    out = []
    # the data table is the one whose rows carry a player link
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", page, re.S):
        cells = re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)
        if len(cells) < len(cols) + 1:
            continue
        head = cells[0]
        m = re.search(r'class="player-name[^"]*"[^>]*>(.*?)</a>', head, re.S)
        if not m:
            continue
        name = html.unescape(re.sub(r"<[^>]+>", "", m.group(1))).strip()
        tm = re.search(r"</a>\s*(?:<small[^>]*>)?\s*([A-Z]{2,3})\b", head)
        team = tm.group(1) if tm else "FA"
        vals = [_num(re.sub(r"<[^>]+>", "", c)) for c in cells[1:1 + len(cols)]]
        stats = {}
        for k, v in zip(cols, vals):
            if v is None:
                continue
            if k == "fpts":
                continue
            stats[k] = v
        fpts = vals[cols.index("fpts")] if "fpts" in cols else None
        if not stats:
            continue
        out.append({"name": name, "pos": pos, "team": team, "stats": stats,
                    "fantasypros_pts": fpts})
    return out


def fetch(timeout=60):
    rows = []
    for pos in ("QB", "RB", "WR", "TE"):
        rows.extend(parse(pos, fetch_page(pos, timeout)))
    return rows


def normalize(rows):
    return rows


if __name__ == "__main__":
    rows = fetch()
    by = {}
    for r in rows:
        by[r["pos"]] = by.get(r["pos"], 0) + 1
    print(len(rows), by)
    for r in rows[:3]:
        print(r)
