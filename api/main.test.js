// The table polls for a waiting move every few hundred milliseconds, for the whole of a turn.
// When the action passes from one person to the next, a poll still carrying the old turn's token
// can arrive after the next player has already sent their move. That poll must not take it.
//
// This is the failure that made one human and five bots flawless and two humans unplayable: with
// only one person there is never a second remote turn to hand over to, so the window never opens.

const BASE = "http://127.0.0.1:8021";

async function startServer() {
	const command = new Deno.Command("node", {
		args: ["api/main.js"],
		env: { ...Deno.env.toObject(), PORT: "8021" },
		stdout: "null",
		stderr: "null",
	});
	const child = command.spawn();
	for (let attempt = 0; attempt < 60; attempt++) {
		try {
			const res = await fetch(`${BASE}/health`);
			if (res.ok) {
				await res.body?.cancel();
				return child;
			}
			await res.body?.cancel();
		} catch {
			// not listening yet
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error("the table server never came up");
}

async function stopServer(child) {
	try {
		child.kill("SIGKILL");
	} catch {
		// already gone
	}
	await child.status;
}

// A raise has to carry an amount; the server rejects one without, and rightly so.
async function postAction(tableId, seatIndex, turnToken, action, amount = null) {
	const res = await fetch(`${BASE}/action`, {
		method: "POST",
		headers: { "Content-Type": "application/json", "Origin": "http://127.0.0.1:5500" },
		body: JSON.stringify({
			tableId,
			seatIndex,
			turnToken,
			action,
			amount: action === "raise" && amount === null ? 40 : amount,
		}),
	});
	const body = await res.text();
	if (!res.ok) {
		throw new Error(`posting an action failed: ${res.status} ${body}`);
	}
}

async function pollAction(tableId, turnToken) {
	const res = await fetch(
		`${BASE}/action?tableId=${tableId}&turnToken=${encodeURIComponent(turnToken)}`,
		{ headers: { "Origin": "http://127.0.0.1:5500" } },
	);
	if (res.status === 204) {
		await res.body?.cancel();
		return null;
	}
	const payload = await res.json();
	return payload?.turnToken ? payload : null;
}

Deno.test("a poll for another turn never takes a waiting move", async () => {
	const child = await startServer();
	try {
		const table = "racetable";
		// Tyler's move is waiting, for his turn.
		await postAction(table, 2, "turn-tyler", "call");

		// A poll left over from Louise's turn arrives first. It must come away empty-handed
		// and, crucially, must leave Tyler's move where it is.
		const strayPoll = await pollAction(table, "turn-louise");
		if (strayPoll !== null) {
			throw new Error("a poll for the previous turn was handed somebody else's move");
		}

		// Tyler's own poll must still find it.
		const hisPoll = await pollAction(table, "turn-tyler");
		if (hisPoll === null) {
			throw new Error("the move was destroyed by a poll for a different turn");
		}
		if (hisPoll.seatIndex !== 2 || hisPoll.action !== "call") {
			throw new Error(`the wrong move came back: ${JSON.stringify(hisPoll)}`);
		}
	} finally {
		await stopServer(child);
	}
});

Deno.test("a move is only ever handed over once", async () => {
	const child = await startServer();
	try {
		const table = "oncetable";
		await postAction(table, 1, "turn-a", "fold");
		const first = await pollAction(table, "turn-a");
		if (first === null) {
			throw new Error("the move was not delivered at all");
		}
		const second = await pollAction(table, "turn-a");
		if (second !== null) {
			throw new Error("the same move was delivered twice, so it would be played twice");
		}
	} finally {
		await stopServer(child);
	}
});

Deno.test("many stray polls cannot starve a waiting move", async () => {
	const child = await startServer();
	try {
		const table = "starvetable";
		await postAction(table, 3, "turn-mine", "check");
		// The table polls several times a second; a whole turn's worth of stray polls must not
		// wear the move away.
		for (let i = 0; i < 30; i++) {
			const stray = await pollAction(table, `turn-someone-else-${i}`);
			if (stray !== null) {
				throw new Error("a stray poll was handed a move that was not its own");
			}
		}
		const mine = await pollAction(table, "turn-mine");
		if (mine === null) {
			throw new Error("30 stray polls destroyed the waiting move");
		}
	} finally {
		await stopServer(child);
	}
});

Deno.test("a late copy of an old move cannot overwrite the live one", async () => {
	const child = await startServer();
	try {
		const table = "overwritetable";
		// Louise's move, for her turn.
		await postAction(table, 0, "turn-louise", "call");
		// The table takes it and plays it.
		const hers = await pollAction(table, "turn-louise");
		if (hers === null) {
			throw new Error("her move was not delivered");
		}

		// The action passes to Tyler, who sends his move.
		await postAction(table, 2, "turn-tyler", "raise");

		// Now a duplicate of Louise's earlier move turns up late — a double press, or a retry
		// underneath her on a flaky link. It must not displace Tyler's.
		await postAction(table, 0, "turn-louise", "call");

		const his = await pollAction(table, "turn-tyler");
		if (his === null) {
			throw new Error("a late copy of an earlier move displaced the live one");
		}
		if (his.seatIndex !== 2 || his.action !== "raise") {
			throw new Error(`the wrong move came back: ${JSON.stringify(his)}`);
		}
	} finally {
		await stopServer(child);
	}
});
