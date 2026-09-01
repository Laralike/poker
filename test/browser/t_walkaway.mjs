// Somebody shuts their laptop mid-hand. The table must not stall, must give them a grace period
// to come back, and must hand the turn to the shared screen if they do not.
import { rig } from "./harness.mjs";
const r = await rig({ humans: 2, bots: 2, latencyMs: 80 });
console.log(`seats: ${r.seatCount}, humans joined: ${r.seats.length}`);

// Play until somebody's own laptop has the action.
let actor = null;
for (let t = 0; t < 120 && !actor; t++) {
	for (const s of r.seats) {
		if (await r.canAct(s)) {
			actor = s;
			break;
		}
	}
	if (!actor) await r.table.waitForTimeout(400);
}
if (!actor) {
	console.log("never got a turn on a laptop");
	await r.close();
	process.exit(0);
}
console.log(`seat ${actor.i} has the action on their own laptop`);

// Shut the lid: the page goes to the background and stops being heard from.
const closedAt = Date.now();
await actor.page.close();
console.log("their laptop is now shut");

// The shared table must take the turn back rather than sitting there forever.
let reclaimed = null, warned = null;
while (Date.now() - closedAt < 120000) {
	const st = await r.table.evaluate(() => ({
		sharedButtons: !document.getElementById("action-button")?.classList.contains("hidden"),
		banner: document.getElementById("remote-turn-message")?.textContent?.trim() ?? "",
		bannerShown: !document.getElementById("remote-turn-status")?.classList.contains("hidden"),
	}));
	if (!warned && /has not been in touch/.test(st.banner)) warned = Math.round((Date.now() - closedAt) / 1000);
	if (st.sharedButtons && !st.bannerShown) {
		reclaimed = Math.round((Date.now() - closedAt) / 1000);
		break;
	}
	await r.table.waitForTimeout(500);
}
console.log(`\nshared table warned the others after: ${warned === null ? "never" : warned + "s"}`);
console.log(`shared table could take the turn after: ${reclaimed === null ? "NEVER (2 min)" : reclaimed + "s"}`);
console.log(`page errors: ${r.errors.length ? r.errors.slice(0, 3).join("; ") : "none"}`);
await r.close();
