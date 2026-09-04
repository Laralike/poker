// The first words in the middle must describe the state being drawn, not merely the last piece of
// delayed history. Check both joined views through several turns.
import { rig } from "./harness.mjs";

const r = await rig({ humans: 2, bots: 4, latencyMs: 80 });
const problems = [];
let checks = 0;

for (let sample = 0; sample < 24; sample++) {
	for (const seat of r.seats) {
		const status = await seat.page.evaluate(() => {
			const activeSeat = document.querySelector(".seat.active");
			const activeName = activeSeat?.querySelector("h3")?.textContent?.trim() ?? "";
			const firstMessage = document.querySelector("#notification span:first-child")?.textContent?.trim() ?? "";
			const actionButton = document.getElementById("action-button");
			const ownTurn = !!actionButton && !actionButton.classList.contains("hidden");
			return { activeName, firstMessage, ownTurn };
		});

		if (!status.activeName || !status.firstMessage) {
			continue;
		}
		checks++;
		const expected = status.ownTurn
			? "Your turn."
			: /^Bot\s/i.test(status.activeName)
				? `${status.activeName} is thinking…`
				: `${status.activeName}'s turn.`;
		if (status.firstMessage !== expected) {
			problems.push(`${status.firstMessage} shown while ${status.activeName} is active (expected ${expected})`);
		}
		if (/waiting to be played|no need to press again/i.test(status.firstMessage)) {
			problems.push(`removed waiting instruction appeared: ${status.firstMessage}`);
		}
	}
	await r.table.waitForTimeout(350);
}

console.log(`current-state messages checked: ${checks}`);
console.log(`page errors: ${r.errors.length ? [...new Set(r.errors)].join("; ") : "none"}`);
console.log(problems.length === 0
	? "RESULT: the middle message matches the live turn"
	: `RESULT: ${problems.length} mismatches\n  ${[...new Set(problems)].join("\n  ")}`);

await r.close();
process.exit(checks > 0 && problems.length === 0 && r.errors.length === 0 ? 0 : 1);
