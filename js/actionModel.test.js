import {
	fromTotalAmount,
	getActionButtonLabel,
	getActionRequestForAmount,
	getPlayerActionState,
	toTotalAmount,
} from "./shared/actionModel.js";
import { resolveTurnAction } from "./gameEngine.js";

function assertEquals(actual, expected, message = "") {
	const actualJson = JSON.stringify(actual);
	const expectedJson = JSON.stringify(expected);
	if (actualJson !== expectedJson) {
		throw new Error(
			`${message}\nExpected: ${expectedJson}\nActual:   ${actualJson}`,
		);
	}
}

// Hero already has `roundBet` in front of them this street; Villain has matched `currentBet`.
function createSpot({ roundBet = 10, chips = 990, currentBet = 10, lastRaise = 10 } = {}) {
	const player = {
		name: "Hero",
		seatIndex: 0,
		chips,
		roundBet,
		totalBet: roundBet,
		folded: false,
		allIn: false,
	};
	const villain = {
		name: "Villain",
		seatIndex: 1,
		chips: 1000 - currentBet,
		roundBet: currentBet,
		totalBet: currentBet,
		folded: false,
		allIn: false,
	};
	const gameState = {
		currentPhaseIndex: 0,
		currentBet,
		lastRaise,
		pot: roundBet + currentBet,
		raisesThisRound: 1,
		players: [player, villain],
	};
	return { gameState, player };
}

Deno.test("action state carries the player's round bet so controls can show totals", () => {
	const { gameState, player } = createSpot({ roundBet: 10 });
	const actionState = getPlayerActionState(gameState, player);
	assertEquals(actionState.roundBet, 10);
});

Deno.test("total and stake conversion round-trips", () => {
	const { gameState, player } = createSpot({ roundBet: 10 });
	const actionState = getPlayerActionState(gameState, player);

	// "Raise to 40" when 10 is already in means a 30-chip stake.
	assertEquals(fromTotalAmount(40, actionState), 30);
	assertEquals(toTotalAmount(30, actionState), 40);
	assertEquals(toTotalAmount(fromTotalAmount(85, actionState), actionState), 85);
});

Deno.test("conversion is a no-op for a player with nothing in yet", () => {
	const { gameState, player } = createSpot({ roundBet: 0, currentBet: 0 });
	const actionState = getPlayerActionState(gameState, player);
	assertEquals(fromTotalAmount(40, actionState), 40);
	assertEquals(toTotalAmount(40, actionState), 40);
});

// The reported bug: the table announced "raises to 40" while actually moving the player to 50,
// because the control quoted the stake and the engine added it on top of the existing bet.
Deno.test("choosing a total of 40 with 10 already in raises to exactly 40", () => {
	const { gameState, player } = createSpot({ roundBet: 10 });
	const actionState = getPlayerActionState(gameState, player);

	const stake = fromTotalAmount(40, actionState);
	const request = getActionRequestForAmount(stake, actionState);
	assertEquals(request, { action: "raise", amount: 30 });

	const resolved = resolveTurnAction(gameState, player, request);
	assertEquals(resolved.action, "raise");
	assertEquals(resolved.playerPatch.roundBet, 40, "player total for the round");
	assertEquals(resolved.gameStatePatch.currentBet, 40, "table bet to match");
});

Deno.test("button label quotes the total the player ends up with", () => {
	const { gameState, player } = createSpot({ roundBet: 10 });
	const actionState = getPlayerActionState(gameState, player);

	assertEquals(
		getActionButtonLabel(fromTotalAmount(40, actionState), actionState),
		"Raise to £40",
	);
});

Deno.test("call and all-in labels quote totals too", () => {
	// Hero has 10 in, Villain has raised to 60, so calling costs 50 and totals 60.
	const { gameState, player } = createSpot({ roundBet: 10, chips: 990, currentBet: 60 });
	const actionState = getPlayerActionState(gameState, player);

	assertEquals(actionState.needToCall, 50);
	assertEquals(getActionButtonLabel(actionState.needToCall, actionState), "Call £60");
	assertEquals(
		getActionButtonLabel(actionState.maxAmount, actionState),
		"All-In £1,000",
	);
	assertEquals(getActionButtonLabel(0, actionState), "Check");
});

Deno.test("a total below the minimum raise still resolves to a legal raise", () => {
	const { gameState, player } = createSpot({ roundBet: 10, currentBet: 10, lastRaise: 10 });
	const actionState = getPlayerActionState(gameState, player);

	// Asking to "raise to 15" is below the minimum; it must snap up, never silently under-raise.
	const request = getActionRequestForAmount(fromTotalAmount(15, actionState), actionState);
	const resolved = resolveTurnAction(gameState, player, request);
	assertEquals(resolved.playerPatch.roundBet >= 20, true, "snapped to at least the min raise");
});
