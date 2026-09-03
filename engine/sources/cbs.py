"""CBS Sports season projections -- an independent projection source.

CBS publishes its own analysts' full-season stat lines per position as a
plain HTML table (games, attempts, yards, touchdowns, receptions, fumbles).
Independent of ESPN, Sleeper and the FantasyPros consensus, and in the
same per-stat vocabulary, so it joins the blend without special cases
(DECISIONS 016).

Unauthenticated, one request per position; QB/RB/WR/TE only.
"""
import html
import re
import urllib.request

URL = "https://www.cbssports.com/fantasy/football/stats/{pos}/2026/season/projections/ppr/"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128 Safari/537.36")

# column order after the player cell (as published 2026-09); None = skip
COLUMNS = {
    "QB": ["games", "pass_att", "pass_cmp", "pass_yd", None, "pass_td", "pass_int", None,
           "rush_att", "rush_yd", None, "rush_td", "fum_lost", "fpts", None],
    "RB": ["games", "rush_att", "rush_yd", None, "rush_td", None, "rec", "rec_yd", None, None,
           "rec_td", "fum_lost", "fpts", None],
    "WR": ["games", None, "rec", "rec_yd", None, None, "rec_td", "rush_att", "rush_yd", None,
           "rush_td", "fum_lost", "fpts", None],
    "TE": ["games", None, "rec", "rec_yd", None, None, "rec_td", "fum_lost", "fpts", None],
}


def fetch_page(pos, timeout=60):
    req = urllib.request.Request(URL.format(pos=pos), headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def _num(s):
    s = s.replace(",", "").strip()
    try:
        return float(s)
    except ValueError:
        return None


def header_columns(pos, page):
    """Derive the column keys from the page's own header row, so a column
    added or removed by CBS shifts nothing silently."""
    m = re.search(r"<thead.*?</thead>", page, re.S)
    if not m:
        return COLUMNS[pos]
    heads = [re.sub(r"<[^>]+>", " ", h) for h in re.findall(r"<th[^>]*>(.*?)</th>", m.group(0), re.S)]
    heads = [re.sub(r"\s+", " ", html.unescape(h)).strip().lower() for h in heads]
    # keep the leaf headers (those with an abbreviation and a description)
    leaf = [h for h in heads if " " in h and h.split(" ")[0] in
            ("gp", "att", "cmp", "yds", "yds/g", "td", "int", "rate", "avg", "tgt", "rec", "fl", "fpts", "fppg")]
    keys = []
    section = "pass" if pos == "QB" else ("rush" if pos == "RB" else "rec")
    for h in leaf:
        ab, desc = h.split(" ", 1)
        if ab == "gp":
            keys.append("games")
        elif ab == "att" and "pass" in desc:
            keys.append("pass_att")
        elif ab == "att" and "rush" in desc:
            keys.append("rush_att")
        elif ab == "cmp":
            keys.append("pass_cmp")
        elif ab == "yds" and "passing" in desc:
            keys.append("pass_yd")
        elif ab == "yds" and "rushing" in desc:
            keys.append("rush_yd")
        elif ab == "yds" and "receiving" in desc:
            keys.append("rec_yd")
        elif ab == "td" and "pass" in desc:
            keys.append("pass_td")
        elif ab == "td" and "rushing" in desc:
            keys.append("rush_td")
        elif ab == "td" and "receiving" in desc:
            keys.append("rec_td")
        elif ab == "int":
            keys.append("pass_int")
        elif ab == "rec":
            keys.append("rec")
        elif ab == "fl":
            keys.append("fum_lost")
        elif ab == "fpts":
            keys.append("fpts")
        else:
            keys.append(None)
    return keys if len(keys) >= 6 else COLUMNS[pos]


def parse(pos, page):
    cols = header_columns(pos, page)
    out = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", page, re.S):
        cells = re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)
        if len(cells) < len(cols) + 1:
            continue
        head = cells[0]
        # the player cell carries a short and a long name; take the long one
        names = re.findall(r'CellPlayerName--long[^>]*>.*?<a[^>]*>(.*?)</a>', head, re.S)
        if not names:
            names = re.findall(r"<a[^>]*>(.*?)</a>", head, re.S)
        if not names:
            continue
        name = html.unescape(re.sub(r"<[^>]+>", "", names[-1])).strip()
        text = re.sub(r"<[^>]+>", " ", head)
        tm = re.search(r"\b(QB|RB|WR|TE)\s+([A-Z]{2,3})\b", text)
        team = tm.group(2) if tm else "FA"
        vals = [_num(re.sub(r"<[^>]+>", "", c)) for c in cells[1:1 + len(cols)]]
        stats, fpts = {}, None
        for k, v in zip(cols, vals):
            if k is None or v is None:
                continue
            if k == "fpts":
                fpts = v
                continue
            stats[k] = v
        if not stats or not name:
            continue
        out.append({"name": name, "pos": pos, "team": team, "stats": stats, "cbs_pts": fpts})
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
