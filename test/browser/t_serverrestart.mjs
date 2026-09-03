// The table's server holds everything in memory and has no database. Render restarts it on every
// deploy and puts it to sleep when idle, so a restart mid-game is not a rare event -- it is a
// weekly one. The shared table re-publishes its state on a heartbeat, so a restarted server should
// refill within seconds and nobody should lose anything.
//
// This was fixed long ago and has not been re-checked across roughly ten versions of changes to
// the sync path.
import { spawn } from "node:child_process";
import { rig, PORTS } from "./harness.mjs";

const r = await rig({ humans: 2, bots: 4, latencyMs: 0 });

// Keep both people playing throughout.
let running = true;
const players = r.seats.map((seat) => (async () => {
  while (running) {
    try {
      const can = await seat.page.evaluate(() => {
        const a = document.getElementById("action-button");
        return !!a && !a.classList.contains("hidden") && !a.disabled;
      });
      if (can) await seat.page.click("#action-button", { timeout: 2000 }).catch(() => {});
    } catch { /* busy */ }
    await new Promise((res) => setTimeout(res, 280));
  }
})());

// What counts as the game moving. An earlier version of this used a counter that never changes,
// so it reported a failure while the game was visibly carrying on -- the table log is the honest
// signal, because it only grows when something actually happens.
const progress = () =>
  r.table.evaluate(() => (document.getElementById("notification")?.textContent ?? "").length);
await r.table.waitForTimeout(10000);
const before = await progress();
console.log(`game running, progress marker ${before}`);

// Kill the server the way a redeploy does.
const killed = Date.now();
const { execSync } = await import("node:child_process");
execSync(`ps -eo pid,cmd | grep "[a]pi/main.js" | grep -v grep | awk '{print $1}' | while read pid; do kill -9 "$pid" 2>/dev/null || true; done`, { shell: "/bin/bash" });
console.log("table server killed");
await r.table.waitForTimeout(4000);

// Bring it back, as Render would.
// Bring it back configured the way the harness configures it, or the restarted server refuses
// this run's pages and the test measures its own mistake rather than the product.
const api = spawn("node", ["api/main.js"], {
  cwd: "/home/user/poker",
  env: {
    ...process.env,
    PORT: String(PORTS.api),
    ALLOWED_ORIGINS: `http://127.0.0.1:${PORTS.site},http://localhost:${PORTS.site}`,
  },
  stdio: "ignore",
});
// Confirm the server that answers is the one we just started, with the right origins.
for (let attempt = 0; attempt < 30; attempt++) {
  try {
    const res = await fetch(`http://127.0.0.1:${PORTS.api}/health`);
    if (res.ok) {
      const health = await res.json();
      if (health.allowedOrigins?.includes(`http://127.0.0.1:${PORTS.site}`)) break;
    } else await res.body?.cancel();
  } catch { /* not up yet */ }
  await new Promise((res) => setTimeout(res, 300));
}
console.log("table server restarted, empty");

// Does the game carry on, and do the seats get their cards back?
let recoveredAt = null;
const seatsBack = [];
while (Date.now() - killed < 90000) {
  const now = await progress().catch(() => before);
  if (recoveredAt === null && now > before) recoveredAt = Date.now() - killed;
  const ok = await Promise.all(r.seats.map((s) =>
    s.page.evaluate(() => {
      const seats = [...document.querySelectorAll(".seat")].filter((x) => !x.classList.contains("hidden"));
      return seats.some((x) => [...x.querySelectorAll(".hole-cards img.card")]
        .some((i) => !/^[12]B\.svg$/.test((i.getAttribute("src") || "").split("/").pop())));
    }).catch(() => false)
  ));
  if (recoveredAt !== null && ok.every(Boolean)) { seatsBack.push(Date.now() - killed); break; }
  await r.table.waitForTimeout(300);
}
running = false;
await Promise.all(players);

const finalNote = await r.table.evaluate(() => document.getElementById("notification")?.textContent?.split(".")[0] ?? "");
console.log(`\ngame carried on after: ${recoveredAt === null ? "NEVER (90s)" : recoveredAt + "ms"}`);
console.log(`both seats had their cards again after: ${seatsBack.length ? seatsBack[0] + "ms" : "NEVER"}`);
console.log(`table log: "${finalNote}"`);
console.log(`page errors: ${r.errors.length ? [...new Set(r.errors)].slice(0, 2).join("; ") : "none"}`);
const ok = recoveredAt !== null && seatsBack.length > 0;
console.log(ok ? "\nRESULT: a server restart costs nobody their game" : "\nRESULT: FAILED");
await r.close();
try { api.kill("SIGKILL"); } catch { /* gone */ }
process.exit(ok ? 0 : 1);
