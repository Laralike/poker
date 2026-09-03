// A real session, not a snapshot of one.
//
//   node test/browser/t_soak.mjs [seed] [minutes] [humans]
//
// Every other browser check runs for two or three minutes and covers a hand or two. This plays for
// as long as you give it, counting hands actually finished, with the invariant monitor running
// throughout. It is the closest thing here to an evening at the table.
import { rig } from "./harness.mjs";
import { abuseNetwork, createInvariantMonitor, makeRandom } from "./chaos.mjs";

const seed = Number(process.argv[2] ?? 1);
const minutes = Number(process.argv[3] ?? 15);
const humans = Number(process.argv[4] ?? 2);
const random = makeRandom(seed);
const bots = Math.max(0, 6 - humans);

console.log(`seed ${seed} — ${humans} people, ${bots} bots, ${minutes} minutes`);
const r = await rig({ humans, bots, latencyMs: 0 });
// A connection that jitters and occasionally sends a post twice, like a real one. No deliberate
// drops, so a lost-move warning would be a genuine fault.
for (const page of [r.table, ...r.seats.map((s) => s.page)]) {
  await abuseNetwork(page, { random, drop: 0, jitter: [30, 350] });
}

const chipsInPlay = await r.table.evaluate(() => {
  const stacks = (globalThis.poker?.players ?? []).reduce((sum, p) => sum + (p.chips ?? 0), 0);
  const pot = Number((document.getElementById("pot")?.textContent ?? "0").replace(/[^\d]/g, "")) || 0;
  return stacks + pot;
});
const monitor = createInvariantMonitor({ table: r.table, seats: r.seats, chipsInPlay, stallSeconds: 60 });
monitor.start(250);

// Track hands finishing and the shape of the game over time.
const timeline = [];
let handsSeen = 0;
let lastDealerLine = null;
const watcher = setInterval(async () => {
  try {
    const s = await r.table.evaluate(() => {
      const players = globalThis.poker?.players ?? [];
      const note = document.getElementById("notification")?.textContent ?? "";
      return {
        dealerLine: (note.match(/[^.]*is Dealer[^.]*/) ?? [null])[0],
        alive: players.filter((p) => (p.chips ?? 0) > 0).length,
        blinds: document.getElementById("blind-level")?.textContent ?? null,
        finished: globalThis.poker?.gameFinished === true,
        chips: players.map((p) => p.chips ?? 0),
      };
    });
    if (s.dealerLine && s.dealerLine !== lastDealerLine) {
      lastDealerLine = s.dealerLine;
      handsSeen++;
      timeline.push({ hand: handsSeen, alive: s.alive, at: new Date().toISOString().slice(11, 19) });
    }
  } catch { /* busy */ }
}, 1000);

let actions = 0;
const stopAt = Date.now() + minutes * 60000;
async function play(seat) {
  while (Date.now() < stopAt) {
    try {
      const st = await seat.page.evaluate(() => {
        const a = document.getElementById("action-button");
        const f = document.getElementById("fold-button");
        return {
          canAct: !!a && !a.classList.contains("hidden") && !a.disabled,
          canFold: !!f && !f.classList.contains("hidden") && !f.disabled,
        };
      });
      if (st.canAct) {
        const roll = random();
        if (roll < 0.15) {
          await seat.page.evaluate(() => {
            const sl = document.getElementById("amount-slider");
            if (sl) { sl.value = sl.max; sl.dispatchEvent(new Event("input", { bubbles: true })); }
          }).catch(() => {});
        } else if (roll < 0.3) {
          await seat.page.click("#amount-increment-button", { timeout: 1500 }).catch(() => {});
        }
        if (roll > 0.82 && st.canFold) {
          await seat.page.click("#fold-button", { timeout: 2500 }).catch(() => {});
        } else {
          await seat.page.click("#action-button", { timeout: 2500 }).catch(() => {});
        }
        actions++;
      }
      // Between hands, take the offer to deal the next one so the session keeps moving.
      const next = await seat.page.evaluate(() => {
        const b = document.getElementById("next-round-button");
        if (b && !b.classList.contains("hidden") && !b.disabled) { b.click(); return true; }
        return false;
      }).catch(() => false);
      if (next) await new Promise((res) => setTimeout(res, 1200));
    } catch { /* busy */ }
    await new Promise((res) => setTimeout(res, 220));
  }
}
await Promise.all(r.seats.map(play));
clearInterval(watcher);
monitor.stop();

const final = await r.table.evaluate(() => {
  const players = globalThis.poker?.players ?? [];
  return {
    finished: globalThis.poker?.gameFinished === true,
    alive: players.filter((p) => (p.chips ?? 0) > 0).length,
    stacks: players.map((p) => `${p.name}:${p.chips}`).join(" "),
  };
});

console.log(`\nplayed for ${minutes} minutes`);
console.log(`hands dealt: ${handsSeen}`);
console.log(`moves made by the people: ${actions}`);
console.log(`players still with chips: ${final.alive} — ${final.stacks}`);
console.log(`game reached a champion: ${final.finished}`);
console.log(`invariant samples: ${monitor.samples}`);
console.log(`page errors: ${r.errors.length ? [...new Set(r.errors)].slice(0, 3).join("; ") : "none"}`);
if (timeline.length) {
  console.log(`players remaining over time: ${timeline.filter((_, i) => i % Math.max(1, Math.floor(timeline.length / 8)) === 0).map((t) => `h${t.hand}:${t.alive}`).join(" ")}`);
}

const v = monitor.violations;
console.log(v.length === 0 && r.errors.length === 0
  ? `\nRESULT: clean over ${handsSeen} hands`
  : `\nRESULT: ${v.length} VIOLATIONS\n  ${v.slice(0, 12).map((x) => `[${x.key}] ${x.message}`).join("\n  ")}`);
await r.close();
process.exit(v.length === 0 && r.errors.length === 0 ? 0 : 1);
