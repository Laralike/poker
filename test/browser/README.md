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
| `t_chaos.mjs [seed] [humans] [secs] [drop]` | Impatient players on a hostile connection, with a monitor asserting things that must NEVER be true. See the note below on what it does and does not catch. |
| `t_flicker.mjs`      | Is the board thrown away and redrawn when nothing has changed? Counts card elements rebuilt while the board is still.                                              |
| `t_lostmove.mjs [seed] [drop]` | With a quarter of every call dropped on purpose, is anybody ever told their move went missing? Should be nobody, ever. |
| `t_serverdown.mjs`   | Cut a player off entirely: are they told plainly, and does their turn come back when the connection does? |
| `t_background.mjs`   | The shared table is put in another tab and brought back: does it pick the game straight back up? |
| `t_soak.mjs [seed] [mins] [humans]` | A real-length session: many hands with the invariant monitor running throughout. |
| `t_endgame.mjs`      | Rising blinds, players busting out, all-ins and split pots — are chips still conserved? |
| `t_rejoin.mjs`       | A player refreshes their own laptop: do their cards and their turn come back? |
| `t_serverrestart.mjs` | The table server is killed and restarted empty, as a redeploy does. Does the game carry on? |
| `t_blips.mjs [seed] [drop]` | Does one dropped message get treated as a lost connection? It must not. |
| `t_basics.mjs`       | The original complaints, re-checked: does it fit on screen, is money in pounds, does "raise to" mean raise to, does joining by code work? |
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
- Community card elements rebuilt while the board is unchanged: **0** (82 in 12 seconds before v1.19.0).
- A seat page opening: **~0.1s** (it was 12.7s when the lettering file could not be reached).
- A player refreshing mid-game: back in **~0.08s** with the same cards and their turn intact.
- "Connection lost" showing at 8% dropped calls: **0 samples** (it was 165 of 798 before v1.23.0).
- A 15 minute two-person session: **51 hands, 3596 invariant checks, no violations**, played through to a champion.
- Told their move went missing, with 25% of calls dropped: **0** over 43 moves (the same run produced **17** before v1.21.0).
- Told the table is unreachable when it genuinely is: after about **4s**, with the turn returning about **0.4s** after the connection does.


## What each layer of checking is for, and what it is not

Being straight about this matters, because the polite version of these checks is what let a real
bug reach a real game.

**`deno test` (rules and protocol).** Fast, deterministic, and the only layer that reliably catches
a known race. The four tests in `api/main.test.js` model the exact interleaving of two players'
moves and fail every time against the code that shipped the bug. If you find a race, pin it here
first — a browser check will only find it sometimes.

**`t_chaos.mjs` (unknown problems).** Impatient players, jittered and duplicated requests, and a
monitor sampling every 150ms for things that must never be true: chips conserved, one actor at a
time, nobody seeing another's cards while it is their turn, no lost-move warning, no stall, no page
errors. This is for finding what nobody thought to look for.

Measured honestly: run against the known handover bug, it came back clean at 2 humans over 25s and
at 4 humans over 150s. It generates roughly one move every five to eight seconds, which is not
enough handovers to hit a window that is only open for a fraction of a second. Treat a clean chaos
run as weak evidence, not proof. It is worth running long and over several seeds.

**The scripted checks (`t_latency`, `t_bigtable`, `t_allin`, and the rest).** Each answers one
specific question well. None of them race anything, because each drives one seat at a time and
waits politely for the result. That is exactly the blind spot the chaos and protocol layers exist
to cover.


## Running them, and one hard-won rule

**One at a time.** This container cannot carry two browsers at once. Running several in parallel
produced failures that looked exactly like product bugs and were not — a wasted hour before that
was understood. `PORT_BASE` shifts both ports if you do need to overlap two on a bigger machine.

Between runs, clear up. A leftover server holds the port, the next run's spawn fails silently, and
the old one answers with its old configuration:

```
ps -eo pid,cmd | grep -E "[a]pi/main\.js|[t]est/browser/t_" | awk '{print $1}' \
  | while read pid; do kill -9 "$pid"; done
```

The harness now checks that the server answering is the one it started, and says so plainly if not.

**You no longer need to edit `syncConfig.js`.** The harness rewrites the server address as it
serves the file, so the repository always keeps the deployed address and a localhost URL can never
be committed by mistake.
