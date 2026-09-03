// Nobody should ever be told their move went missing.
//
//   node test/browser/t_lostmove.mjs [seed] [dropRate]
//
// The connection here drops a large share of calls outright -- far worse than any real one -- and
// duplicates others. A single dropped packet used to warn immediately, because the move was sent
// once and never again. It should now be retried, and then kept on the server until the table
// collects it, so a player only ever hears about a connection they genuinely cannot reach.
import { rig } from "./harness.mjs";
import { abuseNetwork, makeRandom } from "./chaos.mjs";

const seed = Number(process.argv[2] ?? 1);
const drop = process.argv[3] !== undefined ? Number(process.argv[3]) : 0.25;
const random = makeRandom(seed);

console.log(`seed ${seed} — dropping ${(drop * 100).toFixed(0)}% of every call, on purpose`);
const r = await rig({ humans: 2, bots: 3, latencyMs: 0 });
for (const page of [r.table, ...r.seats.map((s) => s.page)]) {
  await abuseNetwork(page, { random, drop, jitter: [30, 300] });
}

const seen = { lost: 0, waiting: 0, unreachable: 0, own: 0 };
const examples = new Set();
let moves = 0;
let stuckChecks = 0;

const watcher = setInterval(async () => {
  for (const s of r.seats) {
    try {
      const note = await s.page.evaluate(() => document.getElementById("notification")?.textContent ?? "");
      if (/^You /.test(note.trim())) seen.own++;
      if (/waiting to be played/i.test(note)) { seen.waiting++; examples.add(note.trim().slice(0, 90)); }
      if (/Could not reach the table/i.test(note)) { seen.unreachable++; examples.add(note.trim().slice(0, 90)); }
      // The old wording. Its absence is the point of this check.
      if (/did not reach the table|has not picked that up/i.test(note)) {
        seen.lost++;
        examples.add(note.trim().slice(0, 90));
      }
    } catch { /* page busy */ }
  }
}, 200);

const stopAt = Date.now() + 180000;
async function play(seat) {
  while (Date.now() < stopAt) {
    try {
      const canAct = await seat.page.evaluate(() => {
        const e = document.getElementById("action-button");
        return !!e && !e.classList.contains("hidden") && !e.disabled;
      });
      if (canAct) {
        await seat.page.click("#action-button", { timeout: 2000 }).catch(() => {});
        moves++;
      } else {
        stuckChecks++;
      }
    } catch { /* page busy */ }
    await new Promise((res) => setTimeout(res, 200));
  }
}
await Promise.all(r.seats.map(play));
clearInterval(watcher);

console.log(`\nmoves pressed: ${moves}`);
console.log(`"You <did something>" confirmations seen: ${seen.own}`);
console.log(`"waiting to be played" (on the server, not yet collected): ${seen.waiting}`);
console.log(`"could not reach the table" (genuinely unreachable): ${seen.unreachable}`);
console.log(`OLD "your move did not reach the table": ${seen.lost}`);
if (examples.size) console.log(`messages seen:\n  ${[...examples].join("\n  ")}`);
console.log(`page errors: ${r.errors.length ? [...new Set(r.errors)].slice(0, 2).join("; ") : "none"}`);
console.log(seen.lost === 0
  ? `\nRESULT: nobody was told their move went missing`
  : `\nRESULT: FAILED — the lost-move message appeared ${seen.lost} times`);
await r.close();
process.exit(seen.lost === 0 ? 0 : 1);
