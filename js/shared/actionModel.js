/* ==================================================================================================
MODULE BOUNDARY: Shared Action Model
================================================================================================== */

// CURRENT STATE: Single shared source of truth for check, call, raise, and all-in amount math used
// by host and seat controls.
// TARGET STATE: Keep all action math that can be derived from explicit game state in one place so
// every UI uses the same rules.
// PUT HERE: Amount normalization, button labels, and semantic action derivation from explicit game
// state.
// DO NOT PUT HERE: Action submission, DOM control handling, polling, or turn-flow ownership.

// AMOUNT CONVENTION: every `amount` in this module is a STAKE — the chips a player puts in on this
// action, on top of whatever they already have in the pot this round. The engine consumes stakes.
// Players, however, think and speak in TOTALS ("raise to 40" means 40 in front of you, not 40 more),
// so every control surface renders totals via toTotalAmount()/fromTotalAmount(). Keep the two
// straight: mixing them is what made the table announce "raises to 40" while actually raising to 50.

import { formatMoney } from "./currency.js";

export function getPlayerActionState(gameState, player) {
	const needToCall = Math.max(0, gameState.currentBet - player.roundBet);
	const minAmount = gameState.currentPhaseIndex > 0 && gameState.currentBet === 0
		? 0
		: Math.min(needToCall, player.chips);
	const maxAmount = player.chips;
	const minRaise = needToCall + gameState.lastRaise;
	const effectiveRaiseCap = getEffectiveRaiseCap(gameState, player);
	const maxRaiseAmount = Math.min(maxAmount, Math.max(minRaise, effectiveRaiseCap));
	return {
		needToCall,
		minAmount,
		maxAmount,
		minRaise,
		maxRaiseAmount,
		canCheck: needToCall === 0,
		// Carried so control surfaces can render totals without reaching back into the player.
		roundBet: player.roundBet ?? 0,
	};
}

/* --------------------------------------------------------------------------------------------------
Stake <-> Total Conversion
---------------------------------------------------------------------------------------------------*/

export function getRoundBetBase(actionState) {
	const roundBet = Number(actionState?.roundBet);
	return Number.isFinite(roundBet) ? roundBet : 0;
}

// Stake -> the number the player reads ("raise to X").
export function toTotalAmount(amount, actionState) {
	return getRoundBetBase(actionState) + amount;
}

// The number the player typed or dragged -> the stake the engine wants.
export function fromTotalAmount(totalAmount, actionState) {
	return totalAmount - getRoundBetBase(actionState);
}

export function getEffectiveRaiseCap(gameState, player) {
	const maxOpponentTotal = gameState.players.reduce((maxTotal, currentPlayer) => {
		if (
			currentPlayer === player ||
			currentPlayer.folded ||
			currentPlayer.allIn ||
			currentPlayer.chips <= 0
		) {
			return maxTotal;
		}

		return Math.max(maxTotal, currentPlayer.roundBet + currentPlayer.chips);
	}, 0);

	return Math.max(0, maxOpponentTotal - player.roundBet);
}

// Labels quote the total, so the button always names the same number the player will end up with in
// front of them.
export function getActionButtonLabel(amount, actionState) {
	if (amount === 0) {
		return "Check";
	}

	const totalAmount = formatMoney(toTotalAmount(amount, actionState));
	if (amount === actionState.maxAmount) {
		return `All-In ${totalAmount}`;
	}
	if (amount === actionState.needToCall) {
		return `Call ${totalAmount}`;
	}
	return `Raise to ${totalAmount}`;
}

export function clampActionAmount(amount, actionState) {
	const parsedAmount = Number.isNaN(amount) ? actionState.minAmount : amount;
	return Math.max(
		actionState.minAmount,
		Math.min(parsedAmount, actionState.maxAmount),
	);
}

export function isInvalidRaiseAmount(amount, actionState) {
	const maxRaiseAmount = actionState.maxRaiseAmount ?? actionState.maxAmount;
	return amount > actionState.needToCall &&
		(amount < actionState.minRaise || amount > maxRaiseAmount) &&
		amount < actionState.maxAmount;
}

export function normalizeActionAmount(amount, actionState) {
	const clampedAmount = clampActionAmount(amount, actionState);
	const maxRaiseAmount = actionState.maxRaiseAmount ?? actionState.maxAmount;
	if (clampedAmount === actionState.maxAmount) {
		return clampedAmount;
	}
	if (clampedAmount > maxRaiseAmount) {
		return maxRaiseAmount;
	}
	if (isInvalidRaiseAmount(clampedAmount, actionState)) {
		return Math.min(maxRaiseAmount, actionState.minRaise);
	}
	return clampedAmount;
}

// The UIs submit semantic actions, but both UIs derive them from the same slider state.
export function getActionRequestForAmount(amount, actionState) {
	const normalizedAmount = normalizeActionAmount(amount, actionState);

	if (normalizedAmount === 0) {
		return { action: "check", amount: 0 };
	}
	if (normalizedAmount === actionState.maxAmount) {
		return { action: "allin", amount: normalizedAmount };
	}
	if (normalizedAmount === actionState.needToCall) {
		return { action: "call", amount: normalizedAmount };
	}
	return { action: "raise", amount: normalizedAmount };
}
