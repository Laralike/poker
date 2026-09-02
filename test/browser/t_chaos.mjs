// Real people on a real connection, checked against things that must never be true.
//
//   node test/browser/t_chaos.mjs [seed] [humans] [seconds] [dropRate]
//
// Players here are impatient rather than polite: they press the instant a button lights up, they
// press twice when the first press looks like it did nothing, and they fiddle with the amount
// before committing. The connection jitters, sends some posts twice, and can drop replies. That
// combination is what creates overlapping requests, and overlapping requests are where the bugs
// that survive tidy tests actually live.
//
// dropRate defaults to 0. With calls being dropped, "your move did not reach the table" becomes a
// true statement rather than a fault, so that particular check is switched off automatically.
import { rig } from "./harness.mjs";
import { abuseNetwork, createInvariantMonitor, makeRandom } from "./chaos.mjs";

const seed = Number(process.argv[2] ?? 1);
const humans = Number(process.argv[3] ?? 2);
const seconds = Number(process.argv[4] ?? 120);
const dropRate = process.argv[5] !== undefined ? Number(process.argv[5]) : 0;
const random = makeRandom(seed);
const bots = Math.max(0, 6 - humans);

console.log(`seed ${seed} — ${humans} people, ${bots} bots, ${seconds}s, dropping ${(dropRate * 100).toFixed(0)}% of calls`);
const r = await rig({ humans, bots, latencyMs: 0 });

const counts = [];
for (const page of [r.table, ...r.seats.map((s) => s.page)]) {
  counts.push(await abuseNetwork(page, { random, drop: dropRate }));
}

// Money already in the pot counts, or the blinds look like chips that vanished.
const chipsInPlay = await r.table.evaluate(() => {
  const stacks = (globalThis.poker?.players ?? []).reduce((sum, p) => sum + (p.chips ?? 0), 0);
  const pot = Number((document.getElementById("pot")?.textContent ?? "0").replace(/[^\d]/g, "")) || 0;
  return stacks + pot;
});
console.log(`chips in play: ${chipsInPlay}`);

const monitor = createInvariantMonitor({
  table: r.table,
  seats: r.seats,
  chipsInPlay,
  expectLostMoves: dropRate > 0,
});
monitor.start(150);

// Everybody plays at once, in their own loop. Nobody politely takes turns.
let actions = 0;
const stopAt = Date.now() + seconds * 1000;
async function play(seat) {
  while (Date.now() < stopAt) {
    let acted = false;
    try {
      const state = await seat.page.evaluate(() => {
        const act = document.getElementById("action-button");
        const fold = document.getElementById("fold-button");
        return {
          canAct: !!act && !act.classList.contains("hidden") && !act.disabled,
          canFold: !!fold && !fold.classList.contains("hidden") && !fold.disabled,
        };
      });
      if (state.canAct) {
        const roll = random();
        if (roll < 0.18) {
          await seat.page.evaluate(() => {
            const slider = document.getElementById("amount-slider");
            if (slider) {
              slider.value = slider.max;
              slider.dispatchEvent(new Event("input", { bubbles: true }));
            }
          }).catch(() => {});
        }
        if (roll > 0.78 && state.canFold) {
          await seat.page.click("#fold-button", { timeout: 2000 }).catch(() => {});
        } else {
          await seat.page.click("#action-button", { timeout: 2000 }).catch(() => {});
          if (random() < 0.3) {
            // The impatient second press, because the first looked like it did nothing.
            await seat.page.click("#action-button", { timeout: 800 }).catch(() => {});
          }
        }
        actions++;
        acted = true;
      }
    } catch {
      // the page was mid-update; go round again
    }
    await new Promise((resolve) => setTimeout(resolve, acted ? 150 + random() * 400 : 90));
  }
}

await Promise.all(r.seats.map(play));
monitor.stop();
await new Promise((resolve) => setTimeout(resolve, 1500));

const net = counts.reduce((a, c) => ({
  delayed: a.delayed + c.delayed,
  duplicated: a.duplicated + c.duplicated,
  dropped: a.dropped + c.dropped,
}), { delayed: 0, duplicated: 0, dropped: 0 });

const final = await r.table.evaluate(() => ({
  note: document.getElementById("notification")?.textContent?.split(".").slice(0, 2).join(". ") ?? "",
  hands: (document.getElementById("notification")?.textContent?.match(/is Dealer/g) ?? []).length,
}));

console.log(`\nmoves made by the people: ${actions}`);
console.log(`connection: ${net.delayed} calls delayed, ${net.duplicated} sent twice, ${net.dropped} never answered`);
console.log(`invariant samples: ${monitor.samples}`);
console.log(`hands in the log: ${final.hands || "1+"}`);
console.log(`page errors: ${r.errors.length ? [...new Set(r.errors)].slice(0, 3).join("; ") : "none"}`);

const violations = monitor.violations;
if (violations.length === 0 && r.errors.length === 0) {
  console.log(`\nRESULT seed ${seed}: clean — nothing that must never happen, happened`);
} else {
  console.log(`\nRESULT seed ${seed}: ${violations.length} VIOLATIONS`);
  for (const v of violations.slice(0, 12)) console.log(`  [${v.key}] ${v.message}`);
}
await r.close();
process.exit(violations.length === 0 && r.errors.length === 0 ? 0 : 1);
