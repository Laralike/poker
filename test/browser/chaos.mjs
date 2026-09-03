// A connection that behaves like a real one on a bad day, and players who behave like people.
//
// The polite version of these checks -- act once, wait for the answer, act again -- is what let a
// serious bug through: one player's poll destroying another's move during a handover. That moment
// only exists when requests overlap, so these checks make requests overlap on purpose.
//
// Note for anyone editing this directory: it is excluded from the project's deno fmt config, so
// do not run deno fmt over it. It will reformat to a different style than the rest of the repo.

// Small deterministic generator, so a run that finds something can be replayed from its seed.
export function makeRandom(seed) {
  let state = seed >>> 0 || 1;
  return function random() {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

/**
 * Make a page's calls to the table server behave badly, the way a real network does: every call
 * takes a different length of time, some arrive twice, and some never come back. The duplicates
 * and the reordering are the point -- they create the overlapping windows where two players'
 * moves can collide.
 */
export async function abuseNetwork(page, { random, jitter = [40, 500], duplicate = 0.12, drop = 0.05, log = null }) {
  const counts = { delayed: 0, duplicated: 0, dropped: 0 };
  const apiPort = 8010 + Number(process.env.PORT_BASE ?? 0);
  await page.route(`**/127.0.0.1:${apiPort}/**`, async (route) => {
    const request = route.request();
    const isPost = request.method() === "POST";
    const wait = jitter[0] + random() * (jitter[1] - jitter[0]);
    await new Promise((resolve) => setTimeout(resolve, wait));
    counts.delayed++;

    if (drop > 0 && random() < drop) {
      counts.dropped++;
      log?.(`dropped ${request.method()} ${new URL(request.url()).pathname}`);
      await route.abort("connectionfailed").catch(() => {});
      return;
    }

    try {
      const response = await route.fetch();
      // A duplicated post is what happens when somebody presses twice, or a flaky link retries
      // underneath them. The server sees the same move arrive again.
      if (isPost && random() < duplicate) {
        counts.duplicated++;
        log?.(`duplicated ${new URL(request.url()).pathname}`);
        await route.fetch().catch(() => {});
      }
      await route.fulfill({ response }).catch(() => {});
    } catch {
      await route.abort("failed").catch(() => {});
    }
  });
  return counts;
}

/**
 * Watches the table continuously and reports anything that must never be true, rather than
 * checking that one chosen thing happened.
 *
 * A finding has to persist across several samples before it counts. The seat views are polled, so
 * they legitimately lag the shared table by up to a poll, and a single sample catching that lag is
 * not a fault.
 */
export function createInvariantMonitor({
  table,
  seats,
  chipsInPlay,
  expectLostMoves = false,
  persistSamples = 4,
  stallSeconds = 45,
}) {
  const violations = [];
  const streaks = new Map();
  let samples = 0;
  let timer = null;
  let lastProgressAt = Date.now();
  let lastNote = null;

  function flag(key, message) {
    const next = (streaks.get(key) ?? 0) + 1;
    streaks.set(key, next);
    if (next === persistSamples) {
      violations.push({ at: new Date().toISOString(), key, message });
    }
  }
  function clear(key) {
    streaks.set(key, 0);
  }
  function record(key, message) {
    violations.push({ at: new Date().toISOString(), key, message });
  }

  async function sample() {
    samples++;
    let host;
    try {
      host = await table.evaluate(() => {
        const players = globalThis.poker?.players ?? [];
        const potText = document.getElementById("pot")?.textContent ?? "0";
        return {
          chips: players.reduce((sum, p) => sum + (p.chips ?? 0), 0),
          pot: Number(potText.replace(/[^\d]/g, "")) || 0,
          finished: globalThis.poker?.gameFinished === true,
          payingOut: globalThis.poker?.chipTransferActive === true,
          betweenHands: !document.getElementById("new-round-countdown")?.classList.contains("hidden"),
          hostCanAct: !document.getElementById("action-button")?.classList.contains("hidden"),
          note: document.getElementById("notification")?.textContent?.slice(0, 140) ?? "",
          // What the shared screen is showing face up. It is the authority on which hands are
          // public: at a showdown it reveals them, and a player's own view then showing the same
          // hands is correct rather than a leak.
          tableFaceUp: [...document.querySelectorAll(".seat")]
            .filter((x) => !x.classList.contains("hidden"))
            .filter((x) =>
              [...x.querySelectorAll(".hole-cards img.card")]
                .some((i) => !/^[12]B\.svg$/.test((i.getAttribute("src") || "").split("/").pop()))
            ).length,
        };
      });
    } catch {
      return; // the page was mid-update; not a finding
    }

    // Chips may never be created or destroyed. Money sitting in the pot still counts.
    // While the pot is sliding across to a winner the two genuinely overlap, so wait it out.
    const inPlay = host.chips + host.pot;
    if (host.payingOut) {
      clear("chips");
    } else if (inPlay !== chipsInPlay) {
      flag("chips", `chips do not add up: ${host.chips} in stacks + ${host.pot} in the pot = ${inPlay}, should be ${chipsInPlay}`);
    } else {
      clear("chips");
    }

    const canAct = [];
    for (const seat of seats) {
      try {
        const view = await seat.page.evaluate(() => ({
          note: document.getElementById("notification")?.textContent ?? "",
          canAct: (() => {
            const e = document.getElementById("action-button");
            return !!e && !e.classList.contains("hidden") && !e.disabled;
          })(),
          faceUp: [...document.querySelectorAll(".seat")]
            .filter((x) => !x.classList.contains("hidden"))
            .filter((x) =>
              [...x.querySelectorAll(".hole-cards img.card")]
                .some((i) => !/^[12]B\.svg$/.test((i.getAttribute("src") || "").split("/").pop()))
            ).length,
        }));

        // On a connection deliberately dropping calls, a move really can fail to arrive and
        // saying so is correct. Only count this when nothing was being dropped.
        if (!expectLostMoves && /did not reach|has not picked that up/i.test(view.note)) {
          record(`lost-move-seat-${seat.i}`, `seat ${seat.i} was told its move did not reach the table, on a connection that dropped nothing`);
        }

        // The unambiguous version of "nobody sees anyone else's cards": while it is your turn to
        // act, betting is live and no showdown is happening, so exactly one hand -- your own --
        // may be face up. Checking at any other moment cannot tell a leak apart from a showdown
        // legitimately revealing hands, or from one screen lagging a poll behind the other.
        if (view.canAct && view.faceUp !== 1) {
          flag(`peek-${seat.i}`, `seat ${seat.i} can see ${view.faceUp} hands face up while it is their turn to act`);
        } else {
          clear(`peek-${seat.i}`);
        }

        if (view.canAct) canAct.push(seat.i);
      } catch {
        // the page was mid-update
      }
    }

    // Only one person may hold the action at a time.
    if (canAct.length > 1) {
      flag("two-actors", `seats ${canAct.join(" and ")} could all act at the same moment`);
    } else {
      clear("two-actors");
    }

    // The table must keep moving.
    const moving = canAct.length > 0 || host.hostCanAct || host.betweenHands || host.finished;
    if (moving || host.note !== lastNote) {
      lastProgressAt = Date.now();
      lastNote = host.note;
    }
    const stuckFor = Date.now() - lastProgressAt;
    if (stuckFor > stallSeconds * 1000) {
      record("stalled", `nothing moved for ${Math.round(stuckFor / 1000)}s`);
      lastProgressAt = Date.now();
    }
  }

  return {
    start(intervalMs = 150) {
      timer = setInterval(() => {
        sample().catch(() => {});
      }, intervalMs);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    get violations() {
      return violations;
    },
    get samples() {
      return samples;
    },
  };
}
