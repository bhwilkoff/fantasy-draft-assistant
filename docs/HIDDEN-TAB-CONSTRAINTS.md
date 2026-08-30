# Driving a live draft from a background tab

Everything in `bridge/` has to work in a Chrome tab that is not the visible,
selected tab. That single constraint invalidates most of the obvious ways to
write this code, and each one fails *silently* — the draft keeps going, the
overlay keeps rendering something, and the advice is quietly stale or absent.
Recorded here because every one of these cost real time to diagnose.

## What Chrome does to a hidden tab

| Mechanism | Behaviour when the tab is hidden | Usable? |
|---|---|---|
| `setTimeout` / `setInterval` | throttled to **~1 per minute** after the tab has been hidden a while | **No** for anything draft-paced |
| `requestAnimationFrame` | **stops entirely** | No |
| Synchronous busy-wait | runs, but **blocks the main thread**, so React can never do the re-render you are waiting for | No |
| `MessageChannel` postMessage | **not throttled** | **Yes** — this is the yield to use |
| `MutationObserver` | **not throttled**; fires on real DOM change | **Yes** — this is the driver to use |
| `document.hidden` | `true` for any non-selected tab, even in a visible window | — |
| `innerWidth` / `innerHeight` | **`0 × 0`** if the window is *minimised* (not merely background) | see below |

## The three bugs this caused

**1. The autopilot missed most of the draft.** It polled on
`setInterval(2500)`. In a 60-second-per-pick draft, throttled to one tick a
minute, it could not keep Yahoo's queue current. Fixed by driving it from a
`MutationObserver` — a pick landing *is* a DOM mutation, so the draft drives
us instead of us polling it. The interval survives only as a slow backstop.

**2. The harvester appeared to hang.** It did `await sleep(450)` between
fourteen teams. Throttled, that is fourteen *minutes*. Replacing it with a
synchronous busy-wait made it worse, not better: blocking the main thread
meant React never rendered the Results tab, so the team `<select>` was never
found — the error was "team `<select>` not found", which looks like a selector
problem and is actually a scheduling one. Fixed with `MessageChannel` yields
plus polling for the DOM to actually change.

**3. "Renderer may be frozen".** Light pages (`example.com`, the mock lobby)
kept responding at `0 × 0` all along; only the Yahoo draft client — a heavy
React SPA — died. That asymmetry made the failure look intermittent and
Yahoo-specific when it was neither.

## Minimised is different from background

A **background** window is fine: JS runs, `MutationObserver` fires, the
harness works. A **minimised** window reports `0 × 0`, screenshots fail, and
Chrome freezes the renderer hard enough that even script injection times out.

Diagnose it in one call before assuming anything is broken:

```js
JSON.stringify({hidden: document.hidden, w: innerWidth, h: innerHeight})
```

`resize_window` reports success on a minimised window but does **not** restore
it. What does work is dissolving the tab group (close its last tab) and
letting a fresh one be created — that lands in a new window with real
dimensions.

## Yahoo's "Enter Draft" opens a popup — do not use it

Clicking **Enter Draft** opens the draft client in a *new window*, which is
where the `0 × 0` problem kept coming from: the automation window stayed
healthy while the draft lived in a minimised popup. Navigate directly instead:

```
https://football.fantasysports.yahoo.com/draftclient/f1/{mlid}/{slot}
```

Both values are in the waiting-room URL and the join link.

## Arm once, then only read

Every `navigate` risks a tab teardown, and each teardown drops the injected
stack and the extension's host permission. So: navigate to the draft client
once, arm once, then poll with `window.__hcStatus()` — a deliberately
one-line probe, because monitoring 210 picks must not cost a large tool
result per check.

The autopilot mirrors its log to `localStorage` after every pick, so if a
teardown does happen, re-arming restores the draft so far instead of starting
blind.
