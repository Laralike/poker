// A state push replaces the whole table record. Real network jitter can make two simultaneous
// pushes arrive in reverse order, putting every joined screen back onto an older turn. The table
// must keep those requests strictly ordered.
import { rig, PORTS } from "./harness.mjs";

const r = await rig({ humans: 2, bots: 3 });
let stateRequestsInFlight = 0;
let mostStateRequestsInFlight = 0;

await r.table.route(`**/127.0.0.1:${PORTS.api}/state`, async (route) => {
	if (route.request().method() !== "POST") {
		await route.continue();
		return;
	}

	stateRequestsInFlight++;
	mostStateRequestsInFlight = Math.max(mostStateRequestsInFlight, stateRequestsInFlight);
	// Longer than the active heartbeat, so the old implementation reliably started another full
	// request before this one had landed.
	await new Promise((resolve) => setTimeout(resolve, 2500));
	await route.continue();
	stateRequestsInFlight--;
});

let moves = 0;
const stopAt = Date.now() + 45_000;
while (moves < 4 && Date.now() < stopAt) {
	for (const seat of r.seats) {
		if (await r.canAct(seat)) {
			await seat.page.click("#action-button");
			moves++;
			break;
		}
	}
	await r.table.waitForTimeout(100);
}

await r.table.waitForTimeout(2500);
console.log(`moves played: ${moves}`);
console.log(`most state snapshots simultaneously in flight: ${mostStateRequestsInFlight}`);
console.log(mostStateRequestsInFlight <= 1
	? "\nRESULT: whole-table snapshots stay in order"
	: "\nRESULT: FAILED — an older whole-table snapshot can arrive after a newer one");

await r.close();
process.exit(moves >= 2 && mostStateRequestsInFlight <= 1 ? 0 : 1);
