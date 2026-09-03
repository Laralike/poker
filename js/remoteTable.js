/* ==================================================================================================
MODULE BOUNDARY: Synced Remote Table Runtime
================================================================================================== */

// CURRENT STATE: Polls one table projection and maps synchronized state into shared table-view
// renderer and action-control helpers.
// TARGET STATE: Stay a thin runtime wrapper around polling, projection mapping, and shared helper
// composition.
// PUT HERE: Remote table polling, projection handling, and glue code that connects shared view and
// control modules.
// DO NOT PUT HERE: Reimplemented poker rules, sync schema helpers, or generic render-only
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
import {
	clearChipTransferAnimation,
	clearRenderedSeat,
	clearWinnerReaction,
	renderChipStacks,
	renderChipTransferAnimation,
	renderCommunityCards,
	renderNotificationBar,
	renderProjectedSeat,
	renderSeatActionLabel,
	showWinnerReaction,
} from "./shared/tableViewRenderer.js";

/* --------------------------------------------------------------------------------------------------
Constants And DOM References
---------------------------------------------------------------------------------------------------*/

const notificationEl = document.getElementById("notification");
const potEl = document.getElementById("pot");
const communityCardSlots = document.querySelectorAll("#community-cards .cardslot");
const tableRenderTarget = {
	potEl,
	chipTransferTimer: null,
	activeChipTransferId: null,
	activeChipTransferState: null,
};
const foldButton = document.getElementById("fold-button");
const actionButton = document.getElementById("action-button");
const amountControls = document.getElementById("amount-controls");
const amountDecrementButton = document.getElementById("amount-decrement-button");
const amountSlider = document.getElementById("amount-slider");
const amountIncrementButton = document.getElementById("amount-increment-button");
const sliderOutput = document.getElementById("amount-input");
const remoteSwitchLink = document.getElementById("remote-switch-link");
const soundButton = document.getElementById("sound-button");
const seatRefs = Array.from(document.querySelectorAll(".seat")).map((seatEl, seatSlot) => ({
	seatSlot,
	seatEl,
	cardEls: seatEl.querySelectorAll(".card"),
	nameEl: seatEl.querySelector("h3"),
	totalEl: seatEl.querySelector(".chips .total"),
	betEl: seatEl.querySelector(".chips .bet"),
	stackChipEls: seatEl.querySelectorAll(".stack-visual img"),
	dealerEl: seatEl.querySelector(".dealer"),
	smallBlindEl: seatEl.querySelector(".small-blind"),
	bigBlindEl: seatEl.querySelector(".big-blind"),
	winProbabilityEl: seatEl.querySelector(".win-probability"),
	handStrengthEl: seatEl.querySelector(".hand-strength"),
	actionLabelTimer: null,
	winnerReactionEl: seatEl.querySelector(".winner-reaction"),
	winnerReactionTimer: null,
}));
const urlParams = new URLSearchParams(globalThis.location.search);
const tableId = urlParams.get("tableId") || "";
const seatIndexParam = parseOptionalInt(urlParams.get("seatIndex"));
// Half of this is how long it takes to notice your own turn has come round.
const REFRESH_INTERVAL = 400;
// A backgrounded tab keeps checking in, just less often. Stopping altogether let the seat's presence
// lapse, so the shared table would grab the player's buttons the moment they looked at another
// window.
const BACKGROUND_REFRESH_INTERVAL = 3000;
const ACTION_STEP = 10;
// The backend answers 204 while nothing has changed, so a client that somehow holds a version the
// table can no longer beat — the table record expired and was recreated at version 1, say — would
// sit on 204 forever, showing a frozen board and no action buttons. After this much quiet, ask for
// the full state again; the cost is one extra payload, the alternative is a dead seat.
const RESYNC_AFTER_QUIET_MS = 20_000;
const DEFAULT_NOTIFICATION = "Waiting for updates...";
let lastVersion = 0;
let lastAppliedAt = 0;
let pollTimeoutId = null;
let isPolling = false;

/* --------------------------------------------------------------------------------------------------
Helpers
---------------------------------------------------------------------------------------------------*/

function parseOptionalInt(value) {
	if (value === null || value === "") {
		return null;
	}
	const parsed = Number.parseInt(value, 10);
	return Number.isNaN(parsed) ? null : parsed;
}

const tableControls = createTableControls({
	containerEl: document.getElementById("table-controls"),
	fastForwardButton: document.getElementById("fast-forward-button"),
	nextRoundButton: document.getElementById("next-round-button"),
	tableId,
	commandEndpoint: COMMAND_ENDPOINT,
});

const actionControls = createSeatActionControls({
	tableId,
	seatIndex: seatIndexParam,
	actionEndpoint: ACTION_ENDPOINT,
	actionStep: ACTION_STEP,
	visibleElements: [
		foldButton,
		actionButton,
		amountControls,
	],
	foldButton,
	actionButton,
	amountSlider,
	sliderOutput,
	decrementButton: amountDecrementButton,
	incrementButton: amountIncrementButton,
	// Two different things, and a player deserves to know which. If the move is on the server it
	// is waiting to be collected and will keep being offered until it is. If it never got there,
	// the problem is the connection, and pressing again is worth doing.
	onActionError: (_error, info) =>
		setNotification(
			info?.reachedServer
				? "Your move is with the table and waiting to be played. No need to press again."
				: "Could not reach the table — check your connection, then press again.",
		),
	// Their own move, confirmed on their own screen the instant they press. Whatever the connection
	// is doing, nobody should be left wondering whether the button worked.
	onActionSubmitted: (message) => setNotification(message),
	onNewTurn: () => playTurnChime(),
});

function setNotification(message) {
	renderNotificationBar(notificationEl, [], message || DEFAULT_NOTIFICATION);
}

function renderNotifications(messages = []) {
	renderNotificationBar(notificationEl, messages, DEFAULT_NOTIFICATION);
}

function findSeatRef(publicSeat) {
	if (typeof publicSeat?.seatSlot === "number" && seatRefs[publicSeat.seatSlot]) {
		return seatRefs[publicSeat.seatSlot];
	}
	return seatRefs.find((seatRef) => seatRef.seatSlot === publicSeat?.seatIndex) ?? null;
}

function getRemotePlayerRenderData(playersPublic = []) {
	return playersPublic
		.map((publicSeat) => {
			const seatRef = findSeatRef(publicSeat);
			if (!seatRef) {
				return null;
			}
			return {
				seatIndex: publicSeat.seatIndex,
				chips: publicSeat.chips,
				totalEl: seatRef.totalEl,
				stackChipEls: seatRef.stackChipEls,
			};
		})
		.filter((player) => player !== null);
}

function applyRemoteState(payload) {
	const tableView = getTableView(payload);
	const seatView = getSeatView(payload);
	if (!tableView || !seatView || seatView.seatIndex !== seatIndexParam) {
		setViewSwitchLinkVisible(remoteSwitchLink, false);
		actionControls.hide();
		tableControls.hide();
		setNotification("Seat unavailable.");
		clearChipTransferAnimation(tableRenderTarget);
		seatRefs.forEach(clearRenderedSeat);
		renderCommunityCards(communityCardSlots, []);
		potEl.textContent = "0";
		return;
	}

	const pendingAction = getSeatPendingAction(tableView, seatIndexParam);
	const showTurnControls = shouldShowSeatActionControls(seatView, pendingAction, seatIndexParam);
	const playersPublic = Array.isArray(tableView.playersPublic) ? tableView.playersPublic : [];
	seatRefs.forEach(clearRenderedSeat);
	playersPublic.forEach((publicSeat) => {
		const seatRef = findSeatRef(publicSeat);
		if (!seatRef) {
			return;
		}

		renderProjectedSeat(seatRef, publicSeat, {
			activeSeatIndex: tableView.activeSeatIndex,
			ownSeatIndex: seatIndexParam,
			ownSeatView: seatView,
		});
		renderSeatActionLabel(seatRef, {
			playerName: publicSeat.name,
			actionName: publicSeat.actionState?.name,
			labelUntil: publicSeat.actionState?.labelUntil,
		});
		if (publicSeat.winnerReaction?.emoji) {
			showWinnerReaction(
				seatRef,
				publicSeat.winnerReaction.emoji,
				publicSeat.winnerReaction.visibleUntil,
			);
		} else {
			clearWinnerReaction(seatRef);
		}
	});
	const remotePlayerRenderData = getRemotePlayerRenderData(playersPublic);
	renderChipStacks(remotePlayerRenderData);
	potEl.textContent = `${tableView.pot ?? 0}`;
	if (tableView.chipTransfer) {
		renderChipTransferAnimation(tableRenderTarget, {
			finalPot: tableView.pot ?? 0,
			players: remotePlayerRenderData,
			chipTransfer: tableView.chipTransfer,
		});
	} else {
		clearChipTransferAnimation(tableRenderTarget);
	}
	renderCommunityCards(communityCardSlots, tableView.communityCards);
	actionControls.render(seatView, pendingAction);
	tableControls.render(tableView.tableControls);
	setViewSwitchLinkVisible(remoteSwitchLink, !showTurnControls);
	renderNotifications(tableView.notifications);
}

function requestFullResync() {
	lastVersion = 0;
	lastAppliedAt = Date.now();
}

// A seat asks the table for the state several times a second, so on any real connection some of
// those asks will fail. Treating a single failure as a lost connection tore the buttons away
// mid-decision and announced a problem that did not exist: measured at 8% packet loss, the warning
// was on screen a fifth of the time and the controls vanished 26 times in two minutes.
//
// Keep showing the last known state, and only say something once the failures have run on long
// enough to mean it. Anything shorter is a blip, and a blip should be invisible.
const FAILED_POLLS_BEFORE_WARNING = 5;
let failedPolls = 0;

let warningShowing = false;

function noteFailedPoll(message) {
	failedPolls++;
	if (failedPolls < FAILED_POLLS_BEFORE_WARNING) {
		return;
	}
	warningShowing = true;
	setViewSwitchLinkVisible(remoteSwitchLink, false);
	actionControls.hide();
	tableControls.hide();
	setNotification(message);
}

// Once the table answers again, take the warning down. A quiet spell answers "nothing has changed"
// rather than sending new state, so without this the warning could sit there long after it stopped
// being true.
function notePollSucceeded() {
	failedPolls = 0;
	if (warningShowing) {
		warningShowing = false;
		setNotification("");
	}
}

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
		const res = await fetch(url, { cache: "no-store" });
		if (res.status === 204) {
			notePollSucceeded();
			if (Date.now() - lastAppliedAt > RESYNC_AFTER_QUIET_MS) {
				requestFullResync();
			}
			return;
		}
		if (res.ok) {
			notePollSucceeded();
			const payload = await res.json();
			lastVersion = payload.version;
			lastAppliedAt = Date.now();
			applyRemoteState(payload);
			return;
		}
		if (res.status === 404) {
			// The table was rebuilt under us; a stale version would keep us on 204 forever.
			requestFullResync();
		}
		noteFailedPoll("Table unavailable.");
	} catch (error) {
		console.warn("state fetch failed", error);
		noteFailedPoll("Connection lost.");
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

/* --------------------------------------------------------------------------------------------------
Bootstrap
---------------------------------------------------------------------------------------------------*/

function init() {
	initSound();
	initSoundButton(soundButton);
	document.addEventListener("visibilitychange", handleVisibilityChange);
	actionControls.init();
	tableControls.init();
	configureViewSwitchLink(remoteSwitchLink, "hole-cards.html", tableId, seatIndexParam);
	clearChipTransferAnimation(tableRenderTarget);
	seatRefs.forEach(clearRenderedSeat);
	setViewSwitchLinkVisible(remoteSwitchLink, false);
	renderCommunityCards(communityCardSlots, []);
	actionControls.hide();
	tableControls.hide();

	if (!tableId || seatIndexParam === null) {
		setNotification("Missing table link.");
		return;
	}

	setNotification("Loading table...");
	pollState();
}

globalThis.remoteTable = {
	init,
};

remoteTable.init();
