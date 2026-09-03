/* ==================================================================================================
MODULE BOUNDARY: Synced Single-Seat Runtime
================================================================================================== */

// CURRENT STATE: Polls one private seat projection and maps synchronized state into the local seat
// view.
// TARGET STATE: Stay a thin runtime wrapper around seat projection polling and private-seat UI
// mapping.
// PUT HERE: Seat polling, projection handling, and glue code that connects shared helpers to the
// local seat UI.
// DO NOT PUT HERE: Recomputed poker rules, visibility decisions, shared action math, or renderer
// primitives.

/* --------------------------------------------------------------------------------------------------
Imports
---------------------------------------------------------------------------------------------------*/

import {
	configureViewSwitchLink,
	createSeatActionControls,
	createTableControls,
	getSeatPendingAction,
	setViewSwitchLinkVisible,
	shouldShowSeatActionControls,
} from "./shared/humanTurnController.js";
import { getSeatView, getTableView } from "./shared/syncViewModel.js";
import { initSound, initSoundButton, playTurnChime } from "./shared/sound.js";
import { ACTION_ENDPOINT, COMMAND_ENDPOINT, STATE_ENDPOINT } from "./shared/syncConfig.js";

/* --------------------------------------------------------------------------------------------------
Variables
---------------------------------------------------------------------------------------------------*/

const singleViewEl = document.getElementById("single");
const cardSlots = document.querySelectorAll(".hole-cards img");
const nameBadge = document.querySelector("h3");
const chipsEl = document.querySelector(".total");
const betEl = document.querySelector(".bet");
const potEl = document.querySelector("#pot");
const notificationsEl = document.querySelector("#singleview-notifications");
const handStrengthEl = document.querySelector("#single .hand-strength");
const winProbabilityEl = document.querySelector("#single .win-probability");
const singleActionPanelEl = document.getElementById("single-action-panel");
const singleFoldButton = document.getElementById("single-fold-button");
const singleActionButton = document.getElementById("single-action-button");
const singleAmountControls = document.getElementById("single-amount-controls");
const singleAmountDecrementButton = document.getElementById("single-amount-decrement-button");
const singleAmountSlider = document.getElementById("single-amount-slider");
const singleAmountIncrementButton = document.getElementById("single-amount-increment-button");
const singleSliderOutput = document.getElementById("single-amount-input");
const singleSwitchLink = document.getElementById("single-switch-link");
const soundButton = document.getElementById("sound-button");
const onlineOnlyElements = [betEl, potEl, singleActionPanelEl];
const urlParams = new URLSearchParams(globalThis.location.search);
const tableId = urlParams.get("tableId") || "";
// Half of this is how long it takes to notice your own turn has come round.
const REFRESH_INTERVAL = 400;
const ACTION_STEP = 10;
// See remoteTable.js: 204 means "nothing new", so a client holding an unbeatable version would
// never refresh again. Fall back to a full fetch after a quiet spell.
const RESYNC_AFTER_QUIET_MS = 20_000;
let lastVersion = 0;
let lastAppliedAt = 0;
let pollTimeoutId = null;
let isPolling = false;
let hasSyncedState = false;

function parseOptionalInt(value) {
	if (value === null || value === "") {
		return null;
	}
	const parsed = Number.parseInt(value, 10);
	return Number.isNaN(parsed) ? null : parsed;
}

function getInitialViewState() {
	return {
		card1: urlParams.get("card1") || "",
		card2: urlParams.get("card2") || "",
		playerName: urlParams.get("name") || "",
		chips: parseOptionalInt(urlParams.get("chips")),
		seatIndex: parseOptionalInt(urlParams.get("seatIndex")),
	};
}

const initialViewState = getInitialViewState();
const seatIndexParam = initialViewState.seatIndex;
const tableControls = createTableControls({
	containerEl: document.getElementById("single-table-controls"),
	fastForwardButton: document.getElementById("single-fast-forward-button"),
	nextRoundButton: document.getElementById("single-next-round-button"),
	tableId,
	commandEndpoint: COMMAND_ENDPOINT,
});

const actionControls = createSeatActionControls({
	tableId,
	seatIndex: seatIndexParam,
	actionEndpoint: ACTION_ENDPOINT,
	actionStep: ACTION_STEP,
	visibleElements: [
		singleFoldButton,
		singleActionButton,
		singleAmountControls,
	],
	foldButton: singleFoldButton,
	actionButton: singleActionButton,
	amountSlider: singleAmountSlider,
	sliderOutput: singleSliderOutput,
	decrementButton: singleAmountDecrementButton,
	incrementButton: singleAmountIncrementButton,
	// Two different things, and a player deserves to know which. If the move is on the server it is
	// waiting to be collected and will keep being offered until it is. If it never got there, the
	// problem is the connection, and pressing again is worth doing.
	onActionError: (_error, info) =>
		renderNotifications([
			info?.reachedServer
				? "Your move is with the table and waiting to be played. No need to press again."
				: "Could not reach the table — check your connection, then press again.",
		]),
	// Their own move, confirmed on their own screen the instant they press. Whatever the connection
	// is doing, nobody should be left wondering whether the button worked.
	onActionSubmitted: (message) => renderNotifications([message]),
	onNewTurn: () => playTurnChime(),
});

/* --------------------------------------------------------------------------------------------------
Functions
---------------------------------------------------------------------------------------------------*/

function init() {
	initSound();
	initSoundButton(soundButton);
	document.addEventListener("touchstart", function () {}, false);
	document.addEventListener("visibilitychange", handleVisibilityChange);
	actionControls.init();
	tableControls.init();
	configureViewSwitchLink(singleSwitchLink, "remoteTable.html", tableId, seatIndexParam);
	clearSyncedDisplays();
	applyParams();
	consumeLaunchParams();
	if (!tableId || seatIndexParam === null) {
		setOnlineElementsVisible(false);
		actionControls.hide();
		tableControls.hide();
		return;
	}
	pollState();
}

function applyParams() {
	setCards(initialViewState.card1, initialViewState.card2);
	nameBadge.textContent = initialViewState.playerName;
	if (typeof initialViewState.chips === "number") {
		chipsEl.textContent = initialViewState.chips;
	}
}

function consumeLaunchParams() {
	if (!globalThis.location.search) {
		return;
	}

	const cleanUrl = new URL(globalThis.location.href);
	cleanUrl.searchParams.delete("card1");
	cleanUrl.searchParams.delete("card2");
	cleanUrl.searchParams.delete("name");
	cleanUrl.searchParams.delete("chips");
	cleanUrl.searchParams.delete("t");
	globalThis.history.replaceState(globalThis.history.state, "", cleanUrl.toString());
}

function setCards(card1, card2, folded = false) {
	cardSlots[0].src = card1 ? `cards/${card1}.svg` : "cards/1B.svg";
	cardSlots[1].src = card2 ? `cards/${card2}.svg` : "cards/1B.svg";

	if (folded) {
		singleViewEl.classList.add("folded");
	} else {
		singleViewEl.classList.remove("folded");
	}
}

function setChips(amount, roundBet, pot) {
	if (typeof amount === "number") {
		chipsEl.textContent = amount;
	}
	if (typeof roundBet === "number") {
		betEl.textContent = roundBet;
	}
	if (typeof pot === "number") {
		potEl.textContent = pot;
	}
}

function setOnlineElementsVisible(isOnline) {
	onlineOnlyElements.forEach((el) => {
		if (!el) {
			return;
		}
		el.classList.toggle("hidden", !isOnline);
	});
	if (!isOnline) {
		notificationsEl.classList.add("hidden");
		setViewSwitchLinkVisible(singleSwitchLink, false);
		actionControls.hide();
		tableControls.hide();
		clearSyncedDisplays();
	}
}

function clearSyncedDisplays() {
	renderHandStrength("");
	renderWinProbability(null, false);
}

function renderNotifications(notifications = []) {
	notificationsEl.textContent = "";
	for (const message of notifications) {
		const item = document.createElement("div");
		item.textContent = message;
		notificationsEl.appendChild(item);
	}
	notificationsEl.classList.toggle("hidden", notifications.length === 0);
}

function renderHandStrength(label) {
	if (!handStrengthEl) {
		return;
	}
	handStrengthEl.textContent = label || "";
	handStrengthEl.classList.toggle("hidden", !label);
}

function renderWinProbability(value, shouldShow) {
	if (!winProbabilityEl) {
		return;
	}
	const showValue = shouldShow && typeof value === "number";
	winProbabilityEl.textContent = showValue ? `${Math.round(value)}%` : "";
	winProbabilityEl.classList.toggle("hidden", !showValue);
}

// Constant polling is intentional.
// Poker tables have bursty activity; 204 does not imply inactivity ahead.
async function pollState() {
	if (!tableId || seatIndexParam === null) {
		return;
	}
	// Another run owns the loop; it will schedule the next tick when it finishes.
	if (isPolling) {
		return;
	}
	isPolling = true;
	try {
		const url = `${STATE_ENDPOINT}?tableId=${
			encodeURIComponent(tableId)
		}&seatIndex=${seatIndexParam}&sinceVersion=${lastVersion}`;
		const res = await fetch(url);
		if (res.status === 204) {
			if (Date.now() - lastAppliedAt > RESYNC_AFTER_QUIET_MS) {
				lastVersion = 0;
				lastAppliedAt = Date.now();
			}
			setOnlineElementsVisible(hasSyncedState);
			return;
		}
		if (res.ok) {
			const payload = await res.json();
			lastVersion = payload.version;
			lastAppliedAt = Date.now();
			setOnlineElementsVisible(applyRemoteState(payload));
		} else {
			if (res.status === 404) {
				lastVersion = 0;
				lastAppliedAt = Date.now();
			}
			setOnlineElementsVisible(false);
		}
	} catch (error) {
		console.warn("state fetch failed", error);
		setOnlineElementsVisible(false);
	} finally {
		isPolling = false;
		schedulePoll();
	}
}

function getPollInterval() {
	return document.visibilityState === "visible" ? REFRESH_INTERVAL : BACKGROUND_REFRESH_INTERVAL;
}

function schedulePoll(delay = getPollInterval()) {
	// Exactly one tick is ever pending. Leaking a second timer means two loops racing, which shows
	// up as cancelled requests and a view that lurches between versions.
	if (pollTimeoutId !== null) {
		clearTimeout(pollTimeoutId);
	}
	pollTimeoutId = setTimeout(pollState, delay);
}

function handleVisibilityChange() {
	// Coming back to the tab should feel instant, and the seat needs to re-register straight away
	// so the shared screen hands the controls back.
	schedulePoll(document.visibilityState === "visible" ? 0 : getPollInterval());
}

function applyRemoteState(payload) {
	const tableView = getTableView(payload);
	const seatView = getSeatView(payload);
	if (!tableView || !seatView || seatView.seatIndex !== seatIndexParam) {
		hasSyncedState = false;
		setViewSwitchLinkVisible(singleSwitchLink, false);
		actionControls.hide();
		tableControls.hide();
		clearSyncedDisplays();
		return false;
	}

	hasSyncedState = true;
	const pendingAction = getSeatPendingAction(tableView, seatIndexParam);
	const showTurnControls = shouldShowSeatActionControls(seatView, pendingAction, seatIndexParam);
	nameBadge.textContent = seatView.name;
	setCards(seatView.holeCards?.[0], seatView.holeCards?.[1], seatView.folded);
	setChips(seatView.chips, seatView.roundBet, tableView.pot);
	renderNotifications(tableView.notifications);
	// Display values are prepared by the table before syncing.
	// The single view only applies them and does not compute odds or hand labels itself.
	renderHandStrength(seatView.handStrengthLabel || "");
	renderWinProbability(seatView.winProbability, seatView.showWinProbability === true);
	actionControls.render(seatView, pendingAction);
	tableControls.render(tableView.tableControls);
	setViewSwitchLinkVisible(singleSwitchLink, !showTurnControls);
	return true;
}

/* --------------------------------------------------------------------------------------------------
Public API
---------------------------------------------------------------------------------------------------*/

globalThis.app = {
	init,
};

app.init();
