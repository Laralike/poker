// Four people on four laptops plus two bots. Everything so far has been tested with two people,
// which is the one case where several poker rules collapse into something simpler.
import { rig } from "./harness.mjs";
const r = await rig({ humans: 4, bots: 2, latencyMs: 120 });
console.log(`seats: ${r.seatCount}, humans joined: ${r.seats.length}`);

const problems = [];
let turns = 0, idle = 0;
const actedBy = {};
const labels = new Set();

// Only one person should ever hold the action at a time.
let doubleTurn = 0;
while (turns < 40) {
	const able = [];
	for (const s of r.seats) if (await r.canAct(s)) able.push(s.i);
	if (able.length > 1) {
		doubleTurn++;
		problems.push(`seats ${able.join(" and ")} could both act at once`);
	}

	if (able.length === 0) {
		idle++;
		if (idle > 60) {
			problems.push("nobody could act for 60 checks running");
			break;
		}
		await r.table.waitForTimeout(500);
		continue;
	}
	idle = 0;
	const actor = r.seats.find((s) => s.i === able[0]);
	labels.add(
		(await actor.page.evaluate(() => document.getElementById("action-button").textContent.trim())).replace(
			/£[\d,]+/,
			"£X",
		),
	);
	// Mix in raises so the pot and side pots get exercised.
	if (turns % 4 === 3) {
		await actor.page.click("#amount-increment-button").catch(() => {});
		await actor.page.waitForTimeout(100);
	}
	await actor.page.click("#action-button").catch(() => {});
	actedBy[actor.i] = (actedBy[actor.i] ?? 0) + 1;
	turns++;
	await r.table.waitForTimeout(500);
}

// Nobody may see anyone else's cards.
for (const s of r.seats) {
	const faceUp = await s.page.evaluate(() =>
		[...document.querySelectorAll(".seat")].filter((x) => !x.classList.contains("hidden"))
			.filter((x) =>
				[...x.querySelectorAll(".hole-cards img.card")]
					.some((i) => !/^[12]B\.svg$/.test((i.getAttribute("src") || "").split("/").pop()))
			).length
	);
	if (faceUp > 1) problems.push(`seat ${s.i} can see ${faceUp} hands`);
}

const note = await r.table.evaluate(() => document.getElementById("notification")?.textContent ?? "");
console.log(`\nturns played: ${turns}`);
console.log(`actions per seat: ${JSON.stringify(actedBy)}`);
console.log(`button labels seen: ${[...labels].join(" | ")}`);
console.log(`two people holding the action at once: ${doubleTurn} times`);
console.log(`hands dealt: ${(note.match(/is Dealer/g) ?? []).length || "1+"}`);
console.log(`each seat sees only its own cards: ${problems.filter((p) => /can see/.test(p)).length === 0}`);
console.log(`page errors: ${r.errors.length ? r.errors.slice(0, 3).join("; ") : "none"}`);
console.log(`\nproblems: ${problems.length ? problems.slice(0, 6).join("; ") : "none"}`);
await r.close();
