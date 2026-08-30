"""Fantasy Football Calculator ADP — free public JSON, real human mock drafts.

FFC is the market signal we trust most for *shape*: it is drawn from tens of
thousands of real drafts in the last seven days and it publishes a standard
deviation per player, which is exactly what the availability model needs.
"""
import json, urllib.request

URL = ("https://fantasyfootballcalculator.com/api/v1/adp/{fmt}"
       "?teams={teams}&year={year}&position=all")


def fetch(fmt="ppr", teams=12, year=2026, timeout=40):
    url = URL.format(fmt=fmt, teams=teams, year=year)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def normalize(payload):
    out = []
    for p in payload.get("players", []):
        out.append({
            "name": p.get("name"),
            "pos": "DEF" if p.get("position") == "DEF" else p.get("position"),
            "team": p.get("team"),
            "adp": p.get("adp"),
            "adp_stdev": p.get("stdev"),
            "adp_high": p.get("high"),
            "adp_low": p.get("low"),
            "times_drafted": p.get("times_drafted"),
            "bye": p.get("bye"),
        })
    return out, payload.get("meta", {})
