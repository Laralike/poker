// One dropped poll should be invisible. The seat polls several times a second, so on any real
// connection some polls will fail; if each one hides the buttons and announces "Connection lost",
// the controls flicker away while you are deciding and the game feels broken.
//
//   node test/browser/t_blips.mjs [seed] [dropRate]
import { rig } from "./harness.mjs";
import { abuseNetwork, makeRandom } from "./chaos.mjs";

const seed = Number(process.argv[2] ?? 1);
const drop = process.argv[3] !== undefined ? Number(process.argv[3]) : 0.08;
const random = makeRandom(seed);

console.log(`dropping ${(drop * 100).toFixed(0)}% of calls — an ordinary flaky connection`);
const r = await rig({ humans: 2, bots: 4, latencyMs: 0 });
for (const page of [r.table, ...r.seats.map((s) => s.page)]) {
  await abuseNetwork(page, { random, drop, jitter: [20, 200] });
}

let lostShown = 0, unavailableShown = 0, samples = 0;
let controlsVanished = 0, wasShowing = new Map();
const watcher = setInterval(async () => {
  samples++;
  for (const s of r.seats) {
    try {
      const v = await s.page.evaluate(() => ({
        note: document.getElementById("notification")?.textContent ?? "",
        controlsShown: !document.getElementById("action-button")?.classList.contains("hidden"),
      }));
      if (/Connection lost/i.test(v.note)) lostShown++;
      if (/Table unavailable/i.test(v.note)) unavailableShown++;
      // Count the controls disappearing after having been there.
      if (wasShowing.get(s.i) === true && !v.controlsShown) controlsVanished++;
      wasShowing.set(s.i, v.controlsShown);
    } catch { /* busy */ }
  }
}, 150);

const stopAt = Date.now() + 120000;
let moves = 0;
await Promise.all(r.seats.map(async (seat) => {
  while (Date.now() < stopAt) {
    try {
      const can = await seat.page.evaluate(() => {
        const a = document.getElementById("action-button");
        return !!a && !a.classList.contains("hidden") && !a.disabled;
      });
      if (can) { await seat.page.click("#action-button", { timeout: 2000 }).catch(() => {}); moves++; }
    } catch { /* busy */ }
    await new Promise((res) => setTimeout(res, 300));
  }
}));
clearInterval(watcher);

console.log(`\nmoves made: ${moves}, samples taken: ${samples}`);
console.log(`"Connection lost." was on screen in ${lostShown} samples`);
console.log(`"Table unavailable." was on screen in ${unavailableShown} samples`);
console.log(`times the buttons vanished after being shown: ${controlsVanished}`);
console.log(`page errors: ${r.errors.length ? [...new Set(r.errors)].slice(0, 2).join("; ") : "none"}`);
const noisy = lostShown > 0 || unavailableShown > 0;
console.log(noisy
  ? `\nRESULT: a single dropped poll is being treated as a lost connection`
  : `\nRESULT: ordinary dropped polls stay invisible`);
await r.close();
process.exit(noisy ? 1 : 0);
