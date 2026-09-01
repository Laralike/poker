// A whole game, start to champion: many hands, rising blinds, players busting out.
// Nothing has ever been run to the end before.
import { rig } from "./harness.mjs";
const r = await rig({ humans: 0, bots: 6 });
console.log(`seats: ${r.seatCount} bots, playing until someone wins the lot`);

const start = Date.now();
let champion = null, lastPot = null, stuckFor = 0, maxStall = 0;
const backlogs = [];
const blinds = new Set();

while (Date.now() - start < 600000) {
	const st = await r.table.evaluate(() => ({
		finished: globalThis.poker?.gameFinished === true,
		inHand: globalThis.poker?.handInProgress === true,
		backlog: globalThis.poker?.pendingNotifications ?? 0,
		pot: document.getElementById("pot")?.textContent,
		note: document.getElementById("notification")?.textContent?.split(".")[0]?.trim(),
		alive: (globalThis.poker?.players ?? []).filter((p) => p.chips > 0).length,
		blind: document.getElementById("blind-level")?.textContent ?? null,
	}));
	backlogs.push(st.backlog);
	if (st.blind) blinds.add(st.blind);
	if (st.finished) {
		champion = st.note;
		break;
	}
	if (st.pot === lastPot) {
		stuckFor += 250;
		maxStall = Math.max(maxStall, stuckFor);
	} else {
		stuckFor = 0;
		lastPot = st.pot;
	}
	if (stuckFor > 90000) {
		console.log("STALLED: nothing moved for 90s");
		break;
	}
	await r.table.waitForTimeout(250);
}

const mins = ((Date.now() - start) / 60000).toFixed(1);
const behind = backlogs.filter((n) => n > 0).length;
console.log(`\nran for ${mins} minutes`);
console.log(`champion crowned: ${champion ? "yes — " + champion : "NO"}`);
console.log(`longest the table sat still: ${(maxStall / 1000).toFixed(1)}s`);
console.log(`blind levels seen: ${blinds.size ? [...blinds].join(", ") : "(not displayed)"}`);
console.log(
	`log behind the play: ${behind}/${backlogs.length} (${
		(100 * behind / Math.max(1, backlogs.length)).toFixed(1)
	}%), worst ${Math.max(0, ...backlogs)}`,
);
console.log(`page errors: ${r.errors.length ? r.errors.slice(0, 3).join("; ") : "none"}`);
await r.close();
