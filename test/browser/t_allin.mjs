// All-ins and the side pots they create, driven from people's own laptops. Never tested through
// the sync path before -- only ever calls and checks.
import { rig } from "./harness.mjs";
const r = await rig({ humans: 3, bots: 1, latencyMs: 80 });
console.log(`seats: ${r.seatCount}, humans joined: ${r.seats.length}`);

const problems = [];
const labels = new Set();
let allInsPushed = 0, turns = 0, idle = 0;

// Shove at every opportunity: drag the amount to the top and press.
while (turns < 45 && allInsPushed < 4) {
	let actor = null;
	for (const s of r.seats) {
		if (await r.canAct(s)) {
			actor = s;
			break;
		}
	}
	if (!actor) {
		idle++;
		if (idle > 70) {
			problems.push("nobody could act for 70 checks");
			break;
		}
		await r.table.waitForTimeout(500);
		continue;
	}
	idle = 0;
	// Push the slider to its maximum, which is the all-in.
	const label = await actor.page.evaluate(() => {
		const slider = document.getElementById("amount-slider");
		if (slider) {
			slider.value = slider.max;
			slider.dispatchEvent(new Event("input", { bubbles: true }));
		}
		return document.getElementById("action-button")?.textContent?.trim() ?? "";
	});
	labels.add(label.replace(/£[\d,]+/, "£X"));
	if (/all-?in/i.test(label)) allInsPushed++;
	await actor.page.click("#action-button").catch(() => {});
	turns++;
	await r.table.waitForTimeout(600);
}

// Let the hand run out and settle.
await r.table.waitForTimeout(12000);
const after = await r.table.evaluate(() => ({
	note: document.getElementById("notification")?.textContent ?? "",
	chips: (globalThis.poker?.players ?? []).map((p) => ({ name: p.name, chips: p.chips })),
	inHand: globalThis.poker?.handInProgress === true,
}));
const total = after.chips.reduce((sum, p) => sum + p.chips, 0);
const pot = await r.table.evaluate(() =>
	Number(document.getElementById("pot")?.textContent?.replace(/[^\d]/g, "") ?? 0)
);

console.log(`\nturns played: ${turns}, all-ins pushed: ${allInsPushed}`);
console.log(`button labels seen: ${[...labels].join(" | ")}`);
console.log(`chips now: ${after.chips.map((p) => `${p.name} ${p.chips}`).join(", ")}`);
console.log(`chips in stacks: ${total}, chips in the pot: ${pot}, sum: ${total + pot}`);
// Four seats start with 2000 each. Chips are conserved: nothing may be created or destroyed.
const expected = after.chips.length * 2000;
if (total + pot !== expected) problems.push(`chips do not add up: ${total + pot} in play, should be ${expected}`);
console.log(`chips conserved: ${total + pot === expected ? "yes" : "NO"}`);
console.log(`showdown or win reached: ${/wins|split|showdown/i.test(after.note)}`);
console.log(`page errors: ${r.errors.length ? r.errors.slice(0, 3).join("; ") : "none"}`);
console.log(`\nproblems: ${problems.length ? problems.join("; ") : "none"}`);
await r.close();
