// The board was rebuilt from scratch on every redraw, which made the browser throw each card image
// away and paint a new one several times a second. Watch the actual card elements and count how
// often they are replaced while the board is not changing.
import { rig } from "./harness.mjs";
const r = await rig({ humans: 2, bots: 3, latencyMs: 60 });

// Get to a point where there are community cards on the table.
for (let t = 0; t < 200; t++) {
	const cards = await r.seats[0].page.evaluate(() =>
		[...document.querySelectorAll("#community-cards .cardslot img")].length);
	if (cards >= 3) break;
	for (const s of r.seats) if (await r.canFold(s)) { await s.page.click("#fold-button"); await r.table.waitForTimeout(300); }
	await r.table.waitForTimeout(300);
}

const view = r.seats[0].page;
const before = await view.evaluate(() =>
	[...document.querySelectorAll("#community-cards .cardslot img")].map((i) => i.getAttribute("src")));
console.log(`board showing ${before.length} cards: ${before.map((s) => s.split("/").pop()).join(" ")}`);

// Tag every card element, then watch for the tags disappearing — a tag only vanishes if the
// element was destroyed and rebuilt.
await view.evaluate(() => {
	globalThis.__rebuilds = 0;
	const tag = () => {
		for (const img of document.querySelectorAll("#community-cards .cardslot img")) {
			if (!img.dataset.watched) {
				img.dataset.watched = "1";
				globalThis.__rebuilds++;
			}
		}
	};
	tag();
	globalThis.__rebuilds = 0; // the first tagging pass does not count
	globalThis.__watcher = setInterval(tag, 25);
});

// Sit still for 12 seconds. The board should not change in that time, beyond cards being added.
await view.waitForTimeout(12000);
const result = await view.evaluate(() => {
	clearInterval(globalThis.__watcher);
	return {
		rebuilds: globalThis.__rebuilds,
		cards: [...document.querySelectorAll("#community-cards .cardslot img")].map((i) => i.getAttribute("src")),
	};
});

const added = Math.max(0, result.cards.length - before.length);
console.log(`\nover 12 seconds of polling:`);
console.log(`  card elements rebuilt: ${result.rebuilds}`);
console.log(`  new cards genuinely dealt in that window: ${added}`);
console.log(`  rebuilds not explained by a new card: ${Math.max(0, result.rebuilds - added)}`);
console.log(result.rebuilds - added <= 1
	? "  => the board is left alone when nothing changes"
	: "  => STILL FLICKERING: cards are being rebuilt for no reason");
console.log(`page errors: ${r.errors.length ? r.errors.slice(0, 3).join("; ") : "none"}`);
await r.close();
