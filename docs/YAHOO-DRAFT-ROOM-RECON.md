# Yahoo live draft room — what we can actually read

Recon performed 2026-08-30 inside a real Yahoo live mock draft
(`Stiff Arm 10178423`, 14 teams, slot 10), Chrome + logged-in session.
Everything below was observed, not inferred from documentation.

## URLs

| Purpose | Pattern | Harvey Cup value |
|---|---|---|
| League settings (scrapeable, no auth beyond session) | `/f1/{leagueId}/settings` | `/f1/539156/settings` |
| Enter draft (from waiting room) | `/f1/{leagueId}/{teamId}/enterdraft?slot&uri&auth` | `/f1/539156/7/enterdraft` |
| **Live draft client** | `/draftclient/f1/{leagueId}/{teamSlot}` | `/draftclient/f1/539156/7` |
| Mock lobby / join | `/f1/mock_lobby?lobby=standard`, `/f1/mock_join?lobby&mlid&slot&crumb` | — |

## Transport: one long-lived WebSocket, and why we don't use it

The draft client is a React SPA (separate root from the outer Yahoo Sports
Fluxible shell, whose stores carry no draft state). Pick updates arrive over
a **single WebSocket opened during page load**. Two consequences, both
verified:

* Hooking `window.WebSocket` after load captures nothing — the socket is
  already open. Re-navigating and re-injecting still lost the race, because
  the client connects before injected script runs.
* There is **no XHR/fetch polling for draft state**. Filtering network
  traffic for `yahoo` during live picks returned only
  `pbd.yahoo.com/analytics/v2/pbjs`.

The official Yahoo Fantasy API does expose draft results, but it requires a
full OAuth2 app registration and lags the room.

**Therefore the bridge reads the DOM.** The DOM is authoritative, needs no
credentials, and updates the instant a pick lands.

## The DOM surface (this is the contract the bridge depends on)

Yahoo ships hashed CSS-in-JS class names (`_ys_17wruqx`) that will churn on
every deploy — **never bind to those**. It also ships a small set of stable
semantic hooks, which is what we use:

| Hook | Meaning |
|---|---|
| `.ys-player[data-id]` | a player cell; `data-id` is the **Yahoo player ID** — our join key |
| `.ys-draftorder-current` | the team currently on the clock |
| `.ys-addqueue` | the star toggle that adds a player to the autodraft queue |
| `.ys-player-notes` | player news blurb |

### Available-players table

A single `<table>` on the page. It contains **only undrafted players**, so
it is itself the source of truth for who is left — we never have to
reconstruct availability from the pick feed.

Columns, in order:

```
Queue | Player | XRank | ADP | Bye | Proj Pts | GP |
Pass Yds | Pass TD | Int | Rush Att | Rush Yds | Rush TD |
Targets | Rec | Rec Yds | Rec TD | Ret TD | 2-PT | Fum Lost
```

The `Player` cell renders as `T. Higgins / WR / Cin / Bye 6`, with an
optional injury tag inserted after the name (`J. Love / Q / RB / Ari / Bye 14`).
Note the **abbreviated first initial** — name matching against a full-name
projection set must normalise to `first_initial + last_name + position + team`.

This table is a genuine second projection source: those are Yahoo's own raw
stat projections, which we can re-score under Harvey Cup rules exactly the
same way we re-score ESPN's.

### Status line

Rendered as a single text line, and it carries the entire draft clock state:

```
Eric Hollinger's Pick • You're up in 5 Picks • Round 3, Pick 33
00:24
```

Parsed with one regex, this yields current picker, picks-until-our-turn,
round, overall pick number, and seconds remaining.

### Pick feed ("Picks" tab)

Sequence of `pickNumber, teamName, player(name / injury / pos / team / bye)`,
interleaved with join/leave chat events which must be filtered out. Useful for
modelling each opponent's roster needs, not for availability.

## Practical gotchas hit during recon

* Mock rooms at peak season fill between reading the lobby DOM and clicking —
  join a room several minutes out, not one about to start.
* Chrome throttles background-tab timers, so the waiting-room countdown
  appears frozen; reload to read a true value.
* The draft client tab is periodically torn down and recreated by Yahoo,
  which changes the Chrome tab ID and can drop extension host permission.
  Any automation must re-resolve the tab rather than cache an ID.
