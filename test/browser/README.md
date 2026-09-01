# Watching the whole table move

`deno test` checks the poker rules. It cannot see the thing that actually went wrong in practice: the table running
ahead of its own commentary, a button that looks dead, a countdown showing a different number on two screens. Those only
appear when real pages talk to a real server.

These scripts drive Chromium against a local copy of the site and a local table server, so the whole system can be
watched at once.

## Running them

They need Playwright, which is declared here and kept out of the app itself — the poker site
loads no Node packages and should stay that way. Install it once:

```
cd test/browser && npm install
```

Chromium is expected at `/opt/pw-browsers/chromium`; change `executablePath` in `harness.mjs` if
yours lives elsewhere.

Point the site at a local server first — in `js/shared/syncConfig.js`, set
`SYNC_API_BASE_URL` to `http://127.0.0.1:8010`, and **put it back to the deployed address before committing**, or the
published table will talk to nothing.

```
node test/browser/t_latency.mjs 250
```

Each script starts its own static server on 5500 and its own table server on 8010, so a stale server can never silently
serve old code. If a run dies badly, clear it out with:

```
ps -eo pid,cmd | grep "[a]pi/main.js" | awk '{print $1}' | while read pid; do kill -9 "$pid"; done
```

## What each one is for

| Script               | Question it answers                                                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `t_latency.mjs [ms]` | Over a slow connection, how long before your own screen confirms your move, and before the table acts on it? Everything measured on localhost is a lie about this. |
| `t_bigtable.mjs`     | Four people on four laptops: does exactly one person hold the action at a time, and can anyone see another's cards?                                                |
| `t_champion.mjs`     | A six-bot game left running: does it ever stall, and does the log keep up with the play?                                                                           |
| `t_terminates.mjs`   | Do whole games actually finish? Five games in the app's own speed mode.                                                                                            |
| `t_allin.mjs`        | All-ins and side pots driven from people's laptops — and are chips conserved, with none created or destroyed?                                                      |
| `t_walkaway.mjs`     | Somebody shuts their laptop mid-turn: how long until the others are warned, and until the shared table can take the turn back?                                     |

`harness.mjs` builds the table the others share: a static server, a table server, a browser, a game with N humans and M
bots, and an optional per-device latency.

## The numbers to beat

Recorded on this machine, so treat them as a baseline to compare against rather than absolutes.

- Your own move confirmed on your own screen: **median 57ms at 500ms round trip** — it must not depend on the network,
  because it is drawn locally before anything is sent.
- The shared table acting on it: **median ~1.3s at 500ms round trip**.
- "Did not reach the table" warnings: **0** in 14 turns at 500ms round trip.
- Table log behind the play: **under 7% of samples, never more than 3 messages**.
- Four-handed: **0** occasions where two people could act at once.
- Chips conserved through all-ins: **exactly**, every time.
