import { normalizeBotActionRequest, pickBotThinkingTime } from "./bot.js";

function assertEquals(actual, expected, message = "") {
	const actualJson = JSON.stringify(actual);
	const expectedJson = JSON.stringify(expected);
	if (actualJson !== expectedJson) {
		throw new Error(
			`${message}\nExpected: ${expectedJson}\nActual:   ${actualJson}`,
		);
	}
}

Deno.test("normalizeBotActionRequest returns null for missing decisions", () => {
	assertEquals(normalizeBotActionRequest(null), null);
	assertEquals(normalizeBotActionRequest(undefined), null);
});

Deno.test("normalizeBotActionRequest keeps non-amount actions", () => {
	for (const action of ["fold", "check", "call", "allin"]) {
		assertEquals(
			normalizeBotActionRequest({ action, amount: 500 }),
			{ action },
		);
	}
});

Deno.test("normalizeBotActionRequest parses raise amount", () => {
	assertEquals(
		normalizeBotActionRequest({ action: "raise", amount: "125" }),
		{ action: "raise", amount: 125 },
	);
});

Deno.test("normalizeBotActionRequest rejects invalid raise amount", () => {
	assertEquals(normalizeBotActionRequest({ action: "raise", amount: "abc" }), null);
});

Deno.test("normalizeBotActionRequest rejects unknown actions", () => {
	assertEquals(normalizeBotActionRequest({ action: "bet", amount: 100 }), null);
});

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

// 400 sample pauses per action is enough for the bands to separate cleanly without the test
// becoming flaky on the tank roll, which only lengthens a pause and never shortens one.
function sampleThinkingTimes(action, count = 400) {
	return Array.from({ length: count }, () => pickBotThinkingTime({ action }));
}

Deno.test("pickBotThinkingTime folds fastest and raises slowest", () => {
	const average = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;
	const fold = average(sampleThinkingTimes("fold"));
	const call = average(sampleThinkingTimes("call"));
	const raise = average(sampleThinkingTimes("raise"));

	assert(fold < call, `folds should be quicker than calls (fold ${fold}, call ${call})`);
	assert(call < raise, `calls should be quicker than raises (call ${call}, raise ${raise})`);
});

Deno.test("pickBotThinkingTime never returns the same pause every time", () => {
	const distinct = new Set(sampleThinkingTimes("call", 50));
	assert(distinct.size > 10, `expected varied pauses, got ${distinct.size} distinct values`);
});

Deno.test("pickBotThinkingTime keeps folds snappy and every pause finite", () => {
	for (const value of sampleThinkingTimes("fold")) {
		assert(value >= 400 && value <= 1100, `fold pause out of range: ${value}`);
	}
	for (const action of ["check", "call", "raise", "allin"]) {
		for (const value of sampleThinkingTimes(action, 100)) {
			assert(value > 0 && value <= 8000, `${action} pause out of range: ${value}`);
		}
	}
});

Deno.test("pickBotThinkingTime falls back to a sane pause for unknown actions", () => {
	const value = pickBotThinkingTime({ action: "bet" });
	assert(value > 0 && value <= 8000, `fallback pause out of range: ${value}`);
	assert(pickBotThinkingTime(null) > 0, "a missing decision should still pause");
});
