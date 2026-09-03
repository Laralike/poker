// The parts of a game nobody has ever watched with real people at the table: blinds going up,
// players busting out, the table shrinking to two, and somebody finally winning the lot.
//
//   node test/browser/t_endgame.mjs [seed] [maxMinutes]
//
// Players shove relentlessly so stacks actually change hands, which is what forces the endgame to
// arrive within a test's patience. Chips are counted throughout: none may be created or destroyed,
// including through split pots and side pots.
import { rig } from "./harness.mjs";
import { createInvariantMonitor, makeRandom } from "./chaos.mjs";

const seed = Number(process.argv[2] ?? 1);
const maxMinutes = Number(process.argv[3] ?? 20);
const random = makeRandom(seed);

const r = await rig({ humans: 2, bots: 4, latencyMs: 0 });
const chipsInPlay = await r.table.evaluate(() => {
  const stacks = (globalThis.poker?.players ?? []).reduce((sum, p) => sum + (p.chips ?? 0), 0);
  const pot = Number((document.getElementById("pot")?.textContent ?? "0").replace(/[^\d]/g, "")) || 0;
  return stacks + pot;
});
console.log(`chips in play: ${chipsInPlay}`);
const monitor = createInvariantMonitor({ table: r.table, seats: r.seats, chipsInPlay, stallSeconds: 90 });
monitor.start(300);

const milestones = { blindLevels: new Set(), fewestAlive: 99, headsUp: false, champion: null, splitSeen: false, allInSeen: false };
const watcher = setInterval(async () => {
  try {
    const s = await r.table.evaluate(() => {
      const players = globalThis.poker?.players ?? [];
      const note = document.getElementById("notification")?.textContent ?? "";
      return {
        alive: players.filter((p) => (p.chips ?? 0) > 0).length,
        blinds: document.getElementById("blind-level")?.textContent?.trim() ?? null,
        finished: globalThis.poker?.gameFinished === true,
        note: note.slice(0, 400),
        stacks: players.map((p) => `${p.name}:${p.chips}`).join(" "),
      };
    });
    if (s.blinds) milestones.blindLevels.add(s.blinds);
    if (s.alive > 0) milestones.fewestAlive = Math.min(milestones.fewestAlive, s.alive);
    if (s.alive === 2) milestones.headsUp = true;
    if (/split/i.test(s.note)) milestones.splitSeen = true;
    if (/all-?in/i.test(s.note)) milestones.allInSeen = true;
    if (s.finished && !milestones.champion) milestones.champion = s.stacks;
  } catch { /* busy */ }
}, 800);

const stopAt = Date.now() + maxMinutes * 60000;
let done = false;
async function play(seat) {
  while (Date.now() < stopAt && !done) {
    try {
      const st = await seat.page.evaluate(() => {
        const a = document.getElementById("action-button");
        return { canAct: !!a && !a.classList.contains("hidden") && !a.disabled };
      });
      if (st.canAct) {
        // Shove often, so chips actually move and somebody busts.
        if (random() < 0.55) {
          await seat.page.evaluate(() => {
            const sl = document.getElementById("amount-slider");
            if (sl) { sl.value = sl.max; sl.dispatchEvent(new Event("input", { bubbles: true })); }
          }).catch(() => {});
        }
        await seat.page.click("#action-button", { timeout: 2500 }).catch(() => {});
      }
      await seat.page.evaluate(() => {
        const b = document.getElementById("next-round-button");
        if (b && !b.classList.contains("hidden") && !b.disabled) b.click();
      }).catch(() => {});
      if (await r.table.evaluate(() => globalThis.poker?.gameFinished === true).catch(() => false)) done = true;
    } catch { /* busy */ }
    await new Promise((res) => setTimeout(res, 250));
  }
}
await Promise.all(r.seats.map(play));
clearInterval(watcher);
monitor.stop();

const final = await r.table.evaluate(() => {
  const players = globalThis.poker?.players ?? [];
  return {
    finished: globalThis.poker?.gameFinished === true,
    stacks: players.map((p) => `${p.name}:${p.chips}`).join(" "),
    total: players.reduce((s, p) => s + (p.chips ?? 0), 0),
    note: document.getElementById("notification")?.textContent?.split(".")[0] ?? "",
  };
});

console.log(`\nblind levels seen: ${milestones.blindLevels.size ? [...milestones.blindLevels].join(" -> ") : "(not shown on screen)"}`);
console.log(`fewest players still in: ${milestones.fewestAlive}`);
console.log(`table got down to heads-up: ${milestones.headsUp}`);
console.log(`an all-in happened: ${milestones.allInSeen}`);
console.log(`a split pot happened: ${milestones.splitSeen}`);
console.log(`champion crowned: ${final.finished} ${final.finished ? `— "${final.note}"` : ""}`);
console.log(`final stacks: ${final.stacks}`);
console.log(`chips at the end: ${final.total} (started with ${chipsInPlay})`);
console.log(`page errors: ${r.errors.length ? [...new Set(r.errors)].slice(0, 3).join("; ") : "none"}`);

const problems = [];
if (final.total !== chipsInPlay && final.finished) problems.push(`chips changed: ${chipsInPlay} -> ${final.total}`);
if (!milestones.headsUp && milestones.fewestAlive > 2) problems.push(`never got past ${milestones.fewestAlive} players — the endgame was not reached`);
for (const v of monitor.violations) problems.push(`[${v.key}] ${v.message}`);
if (r.errors.length) problems.push(`page errors: ${[...new Set(r.errors)].slice(0, 2).join("; ")}`);

console.log(problems.length === 0 ? `\nRESULT: endgame clean` : `\nRESULT: ${problems.length} PROBLEMS\n  ${problems.slice(0, 10).join("\n  ")}`);
await r.close();
process.exit(problems.length === 0 ? 0 : 1);
