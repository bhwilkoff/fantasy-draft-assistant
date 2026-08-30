"""Name normalisation across ESPN, FFC and the Yahoo draft room.

Three providers, three conventions, and the Yahoo draft room only ever shows
a first *initial* ("T. Higgins"). So the canonical key is
    first_initial + normalised_last_name + position
with team as a tiebreaker, which is the most specific key all three sources
can actually produce.
"""
import re
import unicodedata

SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}

TEAM_ALIASES = {
    "JAC": "JAX", "WAS": "WSH", "LAR": "LAR", "LA": "LAR", "STL": "LAR",
    "SD": "LAC", "OAK": "LV", "LVR": "LV", "GNB": "GB", "KAN": "KC",
    "NWE": "NE", "NOR": "NO", "SFO": "SF", "TAM": "TB", "ARZ": "ARI",
    "BLT": "BAL", "CLV": "CLE", "HST": "HOU",
}


def _strip_accents(s):
    return "".join(c for c in unicodedata.normalize("NFKD", s)
                   if not unicodedata.combining(c))


def clean_team(t):
    if not t:
        return ""
    t = t.strip().upper()
    return TEAM_ALIASES.get(t, t)


def parse_name(raw):
    """-> (first_token, last_name) with suffixes and punctuation removed."""
    s = _strip_accents(raw or "").lower()
    s = s.replace("&", " ").replace(".", " ").replace("'", "").replace("-", " ")
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    parts = [p for p in s.split() if p]
    # Suffixes are TRAILING only. Filtering them positionally destroys the
    # initials "V." and "I." (roman numerals), which silently rewrote
    # "V. Jefferson" to Justin Jefferson.
    while len(parts) > 1 and parts[-1] in SUFFIXES:
        parts.pop()
    if not parts:
        return "", ""
    if len(parts) == 1:
        return parts[0], parts[0]
    return parts[0], parts[-1]


def key(name, pos, team=None):
    """Canonical join key for merging PROJECTION SOURCES, which all publish
    full first names. Uses the full first name deliberately: an initial-based
    key collides destructively in the NFL's name distribution -- Bijan vs
    Brian Robinson (both RB), Amon-Ra vs A.J. Brown (both WR), Javonte vs
    Josh Williams (both RB). Those collisions silently transplant one
    player's ADP onto another and are invisible in aggregate match counts."""
    first, last = parse_name(name)
    pos = (pos or "").upper()
    if pos in ("DST", "D/ST", "DEF"):
        # Team defenses are identified by team, never by name.
        return "DEF|" + clean_team(team or last)
    return f"{pos}|{first}|{last}"


def initial_key(name, pos, team=None):
    """Join key for the YAHOO DRAFT ROOM, which only ever renders a first
    initial ("T. Higgins"). Ambiguous by construction, so callers must
    disambiguate with team -- see surname_key()."""
    first, last = parse_name(name)
    pos = (pos or "").upper()
    if pos in ("DST", "D/ST", "DEF"):
        return "DEF|" + clean_team(team or last)
    return f"{pos}|{first[:1]}|{last}"


def surname_key(name, pos):
    """position + surname; the bucket we disambiguate inside."""
    _, last = parse_name(name)
    return f"{(pos or '').upper()}|{last}"


def first_names_compatible(a, b):
    """Could these two first names be the same person?

    Guards the team-based fallback in build.py. Sharing a team and a surname
    is NOT enough: Travis and Trevor Etienne are both Jacksonville running
    backs, and matching them handed a 14-point rookie Travis's ADP of 36.7,
    which then surfaced as the biggest 'bargain' on the board.

    Accept an exact match, an initial against a full name, or a genuine
    prefix (Ken/Kenneth). Reject merely sharing a couple of letters."""
    if not a or not b:
        return False
    if a == b:
        return True
    # one side is an initial
    if len(a) == 1 or len(b) == 1:
        return a[0] == b[0]
    short, long_ = (a, b) if len(a) <= len(b) else (b, a)
    if long_.startswith(short) and len(short) >= 3:
        return True
    return False
