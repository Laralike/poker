// The shared table IS the game. When its tab is not the visible one the browser throttles its
// timers to a crawl, so the game slows or stops until somebody clicks back — which is exactly what
// "clicking back to the table seemed to reset it" looks like from the outside.
//
// Real background throttling cannot be reproduced faithfully here, so this checks the thing that
// can be: that the table notices it has come back and picks everything up at once, instead of
// waiting out pauses that expired long ago.
import { rig } from "./harness.mjs";

const r = await rig({ humans: 2, bots: 4, latencyMs: 0 });

// Play the humans automatically so the table is never legitimately waiting on a person.
let running = true;
async function play(seat) {
  while (running) {
    try {
      const canAct = await seat.page.evaluate(() => {
        const e = document.getElementById("action-button");
        return !!e && !e.classList.contains("hidden") && !e.disabled;
      });
      if (canAct) await seat.page.click("#action-button", { timeout: 2000 }).catch(() => {});
    } catch { /* busy */ }
    await new Promise((res) => setTimeout(res, 250));
  }
}
const players = r.seats.map(play);
await r.table.waitForTimeout(8000);

const logSize = () => r.table.evaluate(() =>
  document.querySelectorAll("#log-list div").length || (globalThis.poker?.decisionsResolved ?? 0));

// Tell the page it has been hidden, the way the browser does. The table should save and settle.
await r.table.evaluate(() => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
  Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
  document.dispatchEvent(new Event("visibilitychange"));
});
const atHide = await logSize();
console.log(`table told it is hidden. progress marker: ${atHide}`);
await r.table.waitForTimeout(6000);
const whileHidden = await logSize();
console.log(`after 6s hidden: ${whileHidden} (moved by ${whileHidden - atHide})`);

// Now it comes back to the front.
const beforeWake = await logSize();
const wokeAt = Date.now();
await r.table.evaluate(() => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
  document.dispatchEvent(new Event("visibilitychange"));
});

// Did it pick straight back up?
let movedAfter = null;
while (Date.now() - wokeAt < 15000) {
  const now = await logSize();
  if (now > beforeWake) { movedAfter = Date.now() - wokeAt; break; }
  await r.table.waitForTimeout(100);
}
running = false;
await Promise.all(players);

console.log(`\ncoming back to the front:`);
console.log(`  the game moved again after: ${movedAfter === null ? "NEVER (15s)" : movedAfter + "ms"}`);
console.log(`page errors: ${r.errors.length ? [...new Set(r.errors)].slice(0, 2).join("; ") : "none"}`);
await r.close();
// What matters is that it resumes rather than sitting there. The exact figure depends on what the
// game was about to do anyway -- a bot mid-pause, or the countdown between hands -- so allow for
// the next scheduled thing rather than demanding it be instant.
const resumed = movedAfter !== null && movedAfter < 12000;
console.log(resumed ? "\nRESULT: the table picks the game back up when it returns" : "\nRESULT: FAILED — the table did not resume");
process.exit(resumed ? 0 : 1);
