// Everything so far was measured on localhost. This is what a real connection looks like:
// 250ms added to every call in each direction, so ~500ms round trip, similar to a slow link
// to a free-tier server on another continent.
import { rig } from "./harness.mjs";
const LAT = Number(process.argv[2] ?? 250);
const r = await rig({ humans: 2, bots: 3, latencyMs: LAT });
console.log(`seats at the table: ${r.seatCount}, latency added: ${LAT}ms each way (~${LAT * 2}ms round trip)`);

const own = []; // press -> your own screen says what you did
const table = []; // press -> the shared table has acted on it
const backlogs = [];
const watcher = setInterval(async () => {
	try {
		backlogs.push(await r.table.evaluate(() => globalThis.poker?.pendingNotifications ?? 0));
	} catch { /* busy */ }
}, 80);

let turns = 0, warnings = 0;
while (turns < 14) {
	let actor = null;
	const t0 = Date.now();
	while (!actor && Date.now() - t0 < 45000) {
		for (const s of r.seats) {
			if (await r.canAct(s)) {
				actor = s;
				break;
			}
		}
		if (!actor) await r.table.waitForTimeout(70);
	}
	if (!actor) {
		console.log("no turn came round");
		break;
	}

	const before = await r.ownNote(actor);
	const press = Date.now();
	await actor.page.click("#action-button");

	let sawOwn = null, gone = null;
	while (Date.now() - press < 20000 && (!sawOwn || !gone)) {
		if (!sawOwn) {
			const n = await r.ownNote(actor);
			if (n !== before && /^You /.test(n)) sawOwn = Date.now() - press;
			if (/did not reach|has not picked/.test(n)) warnings++;
		}
		if (!gone) {
			const hidden = await actor.page.evaluate(() => {
				const e = document.getElementById("action-button");
				return !e || e.classList.contains("hidden");
			});
			if (hidden) gone = Date.now() - press;
		}
		await actor.page.waitForTimeout(20);
	}
	if (sawOwn !== null) own.push(sawOwn);
	if (gone !== null) table.push(gone);
	turns++;
	await r.table.waitForTimeout(600);
}
clearInterval(watcher);

const stat = (a) =>
	a.length
		? `min ${Math.min(...a)}ms | median ${a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)]}ms | max ${
			Math.max(...a)
		}ms`
		: "none";
console.log(`\nturns played: ${turns}`);
console.log(`press -> YOUR OWN screen confirms it:   ${stat(own)}  (${own.length}/${turns})`);
console.log(`press -> the shared table has acted:    ${stat(table)}  (${table.length}/${turns})`);
console.log(`"did not reach the table" warnings:     ${warnings}`);
const behind = backlogs.filter((n) => n > 0).length;
console.log(
	`table log behind the play:              ${behind}/${backlogs.length} samples (${
		(100 * behind / Math.max(1, backlogs.length)).toFixed(1)
	}%), worst ${Math.max(0, ...backlogs)}`,
);
console.log(`page errors: ${r.errors.length ? r.errors.slice(0, 3).join("; ") : "none"}`);
await r.close();
