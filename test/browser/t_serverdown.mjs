// The warning must still appear when it is true. Having stopped people being told their move was
// lost when it was safely waiting, the opposite mistake would be to say nothing at all when the
// table really cannot be reached. Kill the server mid-game and check the player is told plainly.
import { rig, PORTS } from "./harness.mjs";

const r = await rig({ humans: 2, bots: 3, latencyMs: 0 });

// Wait for somebody to have the action.
let actor = null;
for (let t = 0; t < 200 && !actor; t++) {
  for (const s of r.seats) if (await r.canAct(s)) { actor = s; break; }
  if (!actor) await r.table.waitForTimeout(400);
}
if (!actor) { console.log("never got a turn on a laptop"); await r.close(); process.exit(1); }
console.log(`seat ${actor.i} has the action`);

// Pull the plug: every call to the table server now fails outright.
const apiPattern = `**/127.0.0.1:${PORTS.api}/**`;
await actor.page.route(apiPattern, (route) => route.abort("connectionfailed"));
console.log("the connection to the table has been cut for that seat");

await actor.page.click("#action-button", { timeout: 3000 }).catch(() => {});

let message = null;
const started = Date.now();
while (Date.now() - started < 30000) {
  const note = await actor.page.evaluate(() => document.getElementById("notification")?.textContent ?? "");
  // Either message is a correct answer here. The move itself reports that it could not be sent;
  // the seat's own polling reports that the table has gone quiet. With the connection cut both are
  // true, and whichever lands last is what the player reads.
  if (/Could not reach the table|Connection lost/i.test(note)) {
    message = { text: note.trim().slice(0, 90), afterMs: Date.now() - started };
    break;
  }
  await actor.page.waitForTimeout(150);
}

console.log(`\nplayer told the table is unreachable: ${message ? `yes, after ${message.afterMs}ms` : "NO — they were told nothing"}`);
if (message) console.log(`  message: "${message.text}"`);

// With no connection at all the seat view cannot draw its controls, which is correct. What matters
// is that the player is not stranded: once the connection comes back, so must their turn.
await actor.page.unroute(apiPattern);
console.log("connection restored");
let recovered = false;
const back = Date.now();
while (Date.now() - back < 30000) {
  recovered = await actor.page.evaluate(() => {
    const e = document.getElementById("action-button");
    return !!e && !e.classList.contains("hidden");
  });
  if (recovered) break;
  await actor.page.waitForTimeout(200);
}
console.log(`their turn came back after the connection did: ${recovered ? `yes, after ${Date.now() - back}ms` : "NO — still stranded"}`);
await r.close();
process.exit(message && recovered ? 0 : 1);
