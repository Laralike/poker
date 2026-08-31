/* ==================================================================================================
MODULE BOUNDARY: Shared Currency Formatting
================================================================================================== */

// CURRENT STATE: Single place that decides how chip amounts are shown to players.
// TARGET STATE: Every user-facing amount goes through here, so changing the currency stays a
// one-line change instead of a hunt through renderers.
// PUT HERE: Symbol choice, grouping, and compact formatting for tight UI slots.
// DO NOT PUT HERE: Bet math, rounding rules that affect the engine, or parsing of user input into
// game amounts.

export const CURRENCY_SYMBOL = "£";
export const CURRENCY_LOCALE = "en-GB";

function toSafeInteger(amount) {
	const parsed = Number(amount);
	if (!Number.isFinite(parsed)) {
		return 0;
	}
	return Math.round(parsed);
}

// Grouped form for roomy slots: notifications, buttons, the pot.
export function formatMoney(amount) {
	return `${CURRENCY_SYMBOL}${toSafeInteger(amount).toLocaleString(CURRENCY_LOCALE)}`;
}

// Ungrouped form for narrow seat slots, where a thousands separator costs a character we do not
// have. Still carries the symbol so no number on the table is ambiguous.
export function formatMoneyCompact(amount) {
	return `${CURRENCY_SYMBOL}${toSafeInteger(amount)}`;
}
