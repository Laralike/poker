/* ==================================================================================================
MODULE BOUNDARY: Main Table Runtime
================================================================================================== */

// CURRENT STATE: Coordinates browser-facing game flow, bots, sync, local persistence, timers,
// analytics, and DOM effects. Showdown resolution/commit state, hand-end/next-hand transition
// state, browserless hand/tournament runners, hand-start setup, turn-action resolution,
// betting-round start state, betting-round progress decisions, and street progression decisions
// are extracted; browser orchestration remains here.
// TARGET STATE: app.js should stay as the browser-facing orchestrator only. Pure poker rules and
// state transforms should live in gameEngine.js, while reusable UI, sync, and control primitives
// should live in shared/*.
// PUT HERE: Engine orchestration, notifications, timers, sync, local save/restore, analytics, bot
// playback, and flow-specific DOM wiring.
// DO NOT PUT HERE: Pure poker rules, reusable action math, sync schema helpers, or generic
// render-only helpers.
// PREFERENCE: Extend the existing modules before introducing new ones.

/* --------------------------------------------------------------------------------------------------
Imports
---------------------------------------------------------------------------------------------------*/

import {
	chooseBotAction,
	enqueueBotAction,
	normalizeBotActionRequest,
	pickBotThinkingTime,
	setBotPlaybackFast,
} from "./bot.js";
import {
	advanceDealer,
	calculateWinProbabilities,
	createBettingRoundProgressState,
	createBettingRoundStartPlan,
	createHandContextState,
	createHandEndPlan,
	createNextHandTransitionPlan,
	createPlayerSpotState,
	createShowdownCommitPlan,
	dealCommunityCardsForPhase,
	dealHoleCardsForNewHand,
	getBettingRoundStartExit,
	getBlindLevelUpdateForHand,
	getBotRevealDecision,
	getCurrentPhase,
	getNextBettingRoundStep,
	getNextPhasePlan,
	getPlayerActionFollowUpEffects,
	getResolvedTurnContinuation,
	getVisibleSolvedHand,
	INITIAL_BIG_BLIND,
	INITIAL_DECK,
	INITIAL_SMALL_BLIND,
	isAllInRunout,
	postBlinds,
	recordPlayerActionStats,
	resolveShowdown,
	resolveTurnAction,
} from "./gameEngine.js";
import QrCreator from "./qr-creator.js";
import { getActionButtonLabel, getPlayerActionState } from "./shared/actionModel.js";
import { createHumanTurnController } from "./shared/humanTurnController.js";
import { formatMoney, formatMoneyCompact } from "./shared/currency.js";
import {
	ACTION_ENDPOINT as ACTION_SYNC_ENDPOINT,
	HEALTH_ENDPOINT,
	IS_SYNC_BACKEND_CONFIGURED,
	STATE_ENDPOINT as STATE_SYNC_ENDPOINT,
} from "./shared/syncConfig.js";
import { initSound, initSoundButton, playTurnChime } from "./shared/sound.js";
import { buildPublicPlayerView, buildSyncView } from "./shared/syncViewModel.js";
import {
	clearChipTransferAnimation,
	clearRenderedSeat,
	clearSeatActionVisualState,
	renderChipStacks,
	renderChipTransferAnimation,
	renderCommunityCards as renderTableCommunityCards,
	renderHostSeat,
	renderNotificationBar,
	renderSeatActiveState,
	renderSeatActiveStates,
	renderSeatResolvedAction,
	renderSeatRotation,
	renderSeatSetupState,
} from "./shared/tableViewRenderer.js";
import { initServiceWorker } from "./serviceWorkerRegistration.js";
import { APP_VERSION, VERSION_LOG } from "./version.js";

/* --------------------------------------------------------------------------------------------------
Configuration And DOM References
---------------------------------------------------------------------------------------------------*/

const startButton = document.querySelector("#start-button");
const newRoundControls = document.querySelector("#new-round-controls");
const startButtonLabel = document.querySelector("#start-button-label");
const newRoundCountdown = document.querySelector("#new-round-countdown");
const newRoundCountdownValue = document.querySelector(
	"#new-round-countdown-value",
);
const newRoundCancelButton = document.querySelector("#new-round-cancel-button");
const instructionsButton = document.querySelector("#instructions-button");
const rotateIcons = document.querySelectorAll(".seat .rotate");
const closeButtons = document.querySelectorAll(".close");
const tableSetupEl = document.getElementById("table-setup");
const joinBannerEl = document.getElementById("join-banner");
const joinBannerUrlEl = document.getElementById("join-banner-url");
const joinBannerCodeEl = document.getElementById("join-banner-code");
const humansCountEl = document.getElementById("humans-count");
const botsCountEl = document.getElementById("bots-count");
const humansDecrementButton = document.getElementById("humans-decrement");
const humansIncrementButton = document.getElementById("humans-increment");
const botsDecrementButton = document.getElementById("bots-decrement");
const botsIncrementButton = document.getElementById("bots-increment");
const setupExplainerEl = document.getElementById("setup-explainer");
const setupNamesEl = document.getElementById("setup-names");
const waitingRoomEl = document.getElementById("waiting-room");
const waitingRoomMessageEl = document.getElementById("waiting-room-message");
const waitingRoomDealButton = document.getElementById("waiting-room-deal-button");
const notification = document.querySelector("#notification");
const foldButton = document.querySelector("#fold-button");
const actionButton = document.querySelector("#action-button");
const amountControls = document.querySelector("#amount-controls");
const amountDecrementButton = document.querySelector(
	"#amount-decrement-button",
);
const statsButton = document.querySelector("#stats-button");
const logButton = document.querySelector("#log-button");
const fastForwardButton = document.querySelector("#fast-forward-button");
const potEl = document.getElementById("pot");
const communityCardSlots = document.querySelectorAll(
	"#community-cards .cardslot",
);
const tableRenderTarget = {
	potEl,
	chipTransferTimer: null,
	activeChipTransferId: null,
	activeChipTransferState: null,
};
const overlayBackdrop = document.querySelector("#overlay-backdrop");
const resumeGameOverlay = document.querySelector("#resume-game-overlay");
const resumeContinueButton = document.querySelector("#resume-continue-button");
const resumeNewButton = document.querySelector("#resume-new-button");
const statsOverlay = document.querySelector("#stats-overlay");
const statsCloseButton = document.querySelector("#stats-close-button");
const statsTableBody = document.querySelector("#stats-table-body");
const logOverlay = document.querySelector("#log-overlay");
const logCloseButton = document.querySelector("#log-close-button");
const versionButton = document.querySelector("#version-button");
const soundButton = document.querySelector("#sound-button");
const versionOverlay = document.querySelector("#version-overlay");
const versionCloseButton = document.querySelector("#version-close-button");
const versionList = document.querySelector("#version-list");
const instructionsOverlay = document.querySelector("#instructions-overlay");
const instructionsCloseButton = document.querySelector(
	"#instructions-close-button",
);
const logList = document.querySelector("#log-list");
const amountSlider = document.querySelector("#amount-slider");
const amountIncrementButton = document.querySelector(
	"#amount-increment-button",
);
const sliderOutput = document.getElementById("amount-input");
const remoteTurnStatusEl = document.getElementById("remote-turn-status");
const remoteTurnMessageEl = document.getElementById("remote-turn-message");
const remoteTurnTakeoverButton = document.getElementById("remote-turn-takeover-button");
const seatRefs = Array.from(document.querySelectorAll(".seat")).map((
	seatEl,
	seatSlot,
) => ({
	seatSlot,
	seatEl,
	nameEl: seatEl.querySelector("h3"),
	totalEl: seatEl.querySelector(".chips .total"),
	betEl: seatEl.querySelector(".chips .bet"),
	stackChipEls: seatEl.querySelectorAll(".stack-visual img"),
	dealerEl: seatEl.querySelector(".dealer"),
	smallBlindEl: seatEl.querySelector(".small-blind"),
	bigBlindEl: seatEl.querySelector(".big-blind"),
	rotateEl: seatEl.querySelector(".rotate"),
	closeEl: seatEl.querySelector(".close"),
	winProbabilityEl: seatEl.querySelector(".win-probability"),
	handStrengthEl: seatEl.querySelector(".hand-strength"),
	cardEls: seatEl.querySelectorAll(".card"),
	qrContainer: seatEl.querySelector(".qr"),
	qrLink: seatEl.querySelector(".qr-link"),
	remoteLink: seatEl.querySelector(".remote-table-link"),
	winnerReactionEl: seatEl.querySelector(".winner-reaction"),
	winnerReactionTimer: null,
	actionLabelTimer: null,
	playerSeatIndex: null,
	clearActionLabelState: null,
	clearWinnerReactionState: null,
}));
const overlays = {
	stats: {
		el: statsOverlay,
		beforeOpen: () => renderStatsOverlay(),
	},
	resume: {
		el: resumeGameOverlay,
		blocking: true,
	},
	log: {
		el: logOverlay,
		canOpen: () => !!logList && logList.childElementCount > 0,
	},
	version: {
		el: versionOverlay,
		beforeOpen: () => renderVersionOverlay(),
	},
	instructions: {
		el: instructionsOverlay,
	},
};

/* --------------------------------------------------------------------------------------------------
Runtime Flags And Mutable UI State
---------------------------------------------------------------------------------------------------*/

const MAX_ITEMS = 8;
const notifArr = [];
const pendingNotif = [];
let isNotifProcessing = false;
let notifTimer = null;
const DEFAULT_NOTIF_INTERVAL = 450;
let NOTIF_INTERVAL = DEFAULT_NOTIF_INTERVAL;
const FAST_FORWARD_NOTIF_INTERVAL = 0;
const DEFAULT_ACTION_LABEL_DURATION = 1800;
let ACTION_LABEL_DURATION = DEFAULT_ACTION_LABEL_DURATION;
const FAST_FORWARD_ACTION_LABEL_DURATION = 180;
const DEFAULT_RUNOUT_PHASE_DELAY = 1600;
let RUNOUT_PHASE_DELAY = DEFAULT_RUNOUT_PHASE_DELAY;
const FAST_FORWARD_RUNOUT_PHASE_DELAY = 320;
const FAST_FORWARD_CHIP_TRANSFER_DURATION = 160;
const FAST_FORWARD_CHIP_TRANSFER_STEPS = 8;
const DEFAULT_CHIP_TRANSFER_STEPS = 30;
const WINNER_REACTION_DURATION = 2000;
// Long enough to read who won and see the chips move, short enough that nobody is drumming their
// fingers. Anyone can skip it with Deal Next Round.
const NEW_ROUND_COUNTDOWN_SECONDS = 7;
const NEW_ROUND_COUNTDOWN_INTERVAL = 1000;
const SAVED_GAME_SCHEMA_VERSION = 1;
const SAVED_GAME_STORAGE_KEY = "poker:saved-game:v1";

const HISTORY_LOG = false; // Set to true to enable history logging in the console
let DEBUG_FLOW = false; // Set to true for verbose game-flow logging
const CHIP_UNIT = 10;

const speedModeParam = new URLSearchParams(globalThis.location.search).get(
	"speedmode",
);
const SPEED_MODE = speedModeParam !== null && speedModeParam !== "0" &&
	speedModeParam !== "false";
if (SPEED_MODE) {
	NOTIF_INTERVAL = 0;
	ACTION_LABEL_DURATION = 0;
	RUNOUT_PHASE_DELAY = 0;
	DEBUG_FLOW = true;
}

let tableId = null;
// Seat indexes whose own device has checked in recently. Empty unless the backend says otherwise.
let presentRemoteSeats = new Set();
// How long ago each of those was last heard from, in ms. Lets the table say whether someone is
// sitting there thinking or has gone quiet, which look identical from the outside.
let remoteSeatLastSeen = {};
// When that set was last confirmed. Nothing is known before the first successful reply, and showing
// a seat's cards-in-hand options on the shared screen during that gap is exactly the leak we are
// trying to close, so the table waits briefly rather than assuming nobody joined.
let presenceRefreshedAt = 0;
const STATE_SYNC_DELAY = 750;
// How often the table checks whether a player has acted. This is dead time on every single turn,
// and it only runs while a person is actually being waited on, so it can afford to be brisk.
const ACTION_POLL_INTERVAL = 300;
// How often the shared table re-checks whether a seat's device is still there while waiting on it.
const REMOTE_TURN_REVIEW_INTERVAL = 1000;
// After this much silence from a device, stop implying its owner is sitting there playing.
const QUIET_DEVICE_SECONDS = 20;
// How long a turn holds back the shared controls while it finds out whether that seat has a device.
const PRESENCE_GRACE_INTERVAL = 2500;
let stateSyncTimer = null;
let stateSyncTimerDelay = null;
let runoutPhaseTimer = null;
let chipTransferFinishTimer = null;
let newRoundCountdownTimer = null;
let newRoundCountdownSeconds = 0;
let summaryButtonsVisible = false;
let handFastForwardActive = false;
let autoplayToGameEnd = false;
let nextChipTransferId = 1;
let pendingSavedGameSnapshot = null;
let currentFlowState = { type: "setup" };
let currentGameSaveEligible = false;

// --- Analytics --------------------------------------------------------------
let totalHands = 0;
let hadHumansAtStart = false;
let exitEventSent = false;

/* --------------------------------------------------------------------------------------------------
Game Constants And Game State
---------------------------------------------------------------------------------------------------*/

const WINNER_REACTION_EMOJIS = {
	reveal: ["😉", "😜", "🤭"],
	uncontested: ["😎", "😏", "😌"],
	split: ["🤝"],
	lucky: ["🥹", "😆", "😮‍💨"],
	comeback: ["💪", "😅"],
	monsterHand: ["🤩", "🥳"],
	strongHand: ["😁", "😄", "😬"],
	bigPot: ["🤑"],
	fallback: ["🙂", "😊"],
};
const WINNER_REACTION_MONSTER_HANDS = new Set([
	"Full House",
	"Four of a Kind",
	"Straight Flush",
]);
const WINNER_REACTION_STRONG_HANDS = new Set(["Straight", "Flush"]);
const WINNER_REACTION_LUCKY_MIN_GAP = 15;
const CARD_SUIT_SYMBOLS = {
	C: "♣",
	D: "♦",
	H: "♥",
	S: "♠",
};

const gameState = {
	currentPhaseIndex: 0,
	currentBet: 0,
	pot: 0,
	activeSeatIndex: null,
	handId: 0,
	nextDecisionId: 1,
	blindLevel: 0,
	gameStarted: false,
	gameFinished: false,
	openCardsMode: false,
	spectatorMode: false,
	raisesThisRound: 0,
	handInProgress: false,
	deck: INITIAL_DECK.slice(),
	cardGraveyard: [],
	communityCards: [],
	players: [],
	allPlayers: [],
	chipTransfer: null,
	pendingAction: null,
	smallBlind: INITIAL_SMALL_BLIND,
	bigBlind: INITIAL_BIG_BLIND,
	lastRaise: INITIAL_BIG_BLIND,
	handContext: createHandContextState(),
};

gameState.toJSON = function () {
	return {
		currentPhaseIndex: this.currentPhaseIndex,
		currentBet: this.currentBet,
		pot: this.pot,
		lastRaise: this.lastRaise,
		smallBlind: this.smallBlind,
		bigBlind: this.bigBlind,
		raisesThisRound: this.raisesThisRound,
		blindLevel: this.blindLevel,
		handContext: this.handContext ? { ...this.handContext } : null,
		communityCards: this.communityCards.slice(),
		pendingAction: this.pendingAction ? { ...this.pendingAction } : null,
		players: this.players,
		timestamp: Date.now(),
	};
};

/* --------------------------------------------------------------------------------------------------
Saved Game Persistence
---------------------------------------------------------------------------------------------------*/

function getLocalStorage() {
	try {
		return globalThis.localStorage ?? null;
	} catch (error) {
		console.warn("saved game storage unavailable", error);
		return null;
	}
}

function clonePlainValue(value, fallback = null) {
	if (value === undefined) {
		return fallback;
	}
	try {
		return JSON.parse(JSON.stringify(value));
	} catch (error) {
		console.warn("saved game clone failed", error);
		return fallback;
	}
}

function normalizeNumber(value, fallback) {
	return Number.isFinite(value) ? value : fallback;
}

function createStatsSnapshot(stats = {}) {
	return {
		hands: normalizeNumber(stats.hands, 0),
		handsWon: normalizeNumber(stats.handsWon, 0),
		vpip: normalizeNumber(stats.vpip, 0),
		pfr: normalizeNumber(stats.pfr, 0),
		calls: normalizeNumber(stats.calls, 0),
		aggressiveActs: normalizeNumber(stats.aggressiveActs, 0),
		reveals: normalizeNumber(stats.reveals, 0),
		showdowns: normalizeNumber(stats.showdowns, 0),
		showdownsWon: normalizeNumber(stats.showdownsWon, 0),
		folds: normalizeNumber(stats.folds, 0),
		foldsPreflop: normalizeNumber(stats.foldsPreflop, 0),
		foldsPostflop: normalizeNumber(stats.foldsPostflop, 0),
		allins: normalizeNumber(stats.allins, 0),
	};
}

function createBotLineSnapshot(botLine = {}) {
	return {
		preflopAggressor: botLine.preflopAggressor === true,
		cbetIntent: botLine.cbetIntent ?? null,
		barrelIntent: botLine.barrelIntent ?? null,
		cbetMade: botLine.cbetMade === true,
		barrelMade: botLine.barrelMade === true,
		nonValueAggressionMade: botLine.nonValueAggressionMade === true,
		checkRaiseIntent: clonePlainValue(botLine.checkRaiseIntent, null),
		passiveValueCheckIntent: clonePlainValue(
			botLine.passiveValueCheckIntent,
			null,
		),
	};
}

function createPlayerSnapshot(player) {
	return {
		name: player.name,
		isBot: player.isBot === true,
		seatSlot: player.seatSlot,
		winnerReactionEmoji: player.winnerReactionEmoji || "",
		winnerReactionUntil: normalizeNumber(player.winnerReactionUntil, 0),
		isWinner: player.isWinner === true,
		actionState: player.actionState ? { ...player.actionState } : null,
		winProbability: typeof player.winProbability === "number" ? player.winProbability : null,
		lastNonFinalWinProbability: typeof player.lastNonFinalWinProbability === "number"
			? player.lastNonFinalWinProbability
			: null,
		seatIndex: player.seatIndex,
		holeCards: Array.isArray(player.holeCards) ? player.holeCards.slice(0, 2) : [null, null],
		visibleHoleCards: Array.isArray(player.visibleHoleCards) ? player.visibleHoleCards.slice(0, 2) : [false, false],
		dealer: player.dealer === true,
		smallBlind: player.smallBlind === true,
		bigBlind: player.bigBlind === true,
		folded: player.folded === true,
		chips: normalizeNumber(player.chips, 0),
		allIn: player.allIn === true,
		totalBet: normalizeNumber(player.totalBet, 0),
		roundBet: normalizeNumber(player.roundBet, 0),
		stats: createStatsSnapshot(player.stats),
		botLine: createBotLineSnapshot(player.botLine),
		spotState: {
			...createPlayerSpotState(),
			...clonePlainValue(player.spotState, {}),
		},
	};
}

function createGameStateSnapshot() {
	return {
		currentPhaseIndex: gameState.currentPhaseIndex,
		currentBet: gameState.currentBet,
		pot: gameState.pot,
		activeSeatIndex: gameState.activeSeatIndex,
		handId: gameState.handId,
		nextDecisionId: gameState.nextDecisionId,
		blindLevel: gameState.blindLevel,
		gameStarted: gameState.gameStarted,
		gameFinished: gameState.gameFinished,
		openCardsMode: gameState.openCardsMode,
		spectatorMode: gameState.spectatorMode,
		raisesThisRound: gameState.raisesThisRound,
		handInProgress: gameState.handInProgress,
		deck: gameState.deck.slice(),
		cardGraveyard: gameState.cardGraveyard.slice(),
		communityCards: gameState.communityCards.slice(),
		activeSeatIndexes: gameState.players.map((player) => player.seatIndex),
		players: gameState.players.map(createPlayerSnapshot),
		allPlayers: gameState.allPlayers.map(createPlayerSnapshot),
		chipTransfer: clonePlainValue(gameState.chipTransfer, null),
		pendingAction: gameState.pendingAction ? { ...gameState.pendingAction } : null,
		smallBlind: gameState.smallBlind,
		bigBlind: gameState.bigBlind,
		lastRaise: gameState.lastRaise,
		handContext: clonePlainValue(gameState.handContext, createHandContextState()),
	};
}

function getLogEntriesSnapshot() {
	if (!logList) {
		return [];
	}
	return Array.from(logList.children).map((entry) => entry.textContent || "");
}

function hasExactlyOneHumanPlayer(players = []) {
	return Array.isArray(players) &&
		players.filter((player) => player?.isBot !== true).length === 1;
}

function createSavedGameSnapshot() {
	return {
		schemaVersion: SAVED_GAME_SCHEMA_VERSION,
		savedAt: Date.now(),
		appVersion: APP_VERSION,
		tableId,
		runtimeState: {
			totalHands,
			hadHumansAtStart,
			currentGameSaveEligible,
			exitEventSent,
			summaryButtonsVisible,
			handFastForwardActive,
			autoplayToGameEnd,
			nextChipTransferId,
			notifications: notifArr.slice(),
			pendingNotifications: pendingNotif.slice(),
			logEntries: getLogEntriesSnapshot(),
		},
		flowState: clonePlainValue(currentFlowState, { type: "unknown" }),
		gameState: createGameStateSnapshot(),
	};
}

function shouldSaveCurrentGame() {
	return !SPEED_MODE &&
		currentGameSaveEligible === true &&
		gameState.gameStarted === true &&
		gameState.gameFinished !== true &&
		hasExactlyOneHumanPlayer(gameState.players);
}

function shouldRemoveCurrentGameSave() {
	return currentGameSaveEligible === true &&
		gameState.gameStarted === true &&
		(
			gameState.gameFinished === true ||
			!hasExactlyOneHumanPlayer(gameState.players)
		);
}

function removeSavedGameSnapshot() {
	const storage = getLocalStorage();
	if (!storage) {
		return;
	}
	try {
		storage.removeItem(SAVED_GAME_STORAGE_KEY);
	} catch (error) {
		console.warn("saved game remove failed", error);
	}
}

function saveCurrentGameSnapshot() {
	if (!shouldSaveCurrentGame()) {
		if (shouldRemoveCurrentGameSave()) {
			removeSavedGameSnapshot();
		}
		return;
	}

	const storage = getLocalStorage();
	if (!storage) {
		return;
	}

	try {
		storage.setItem(
			SAVED_GAME_STORAGE_KEY,
			JSON.stringify(createSavedGameSnapshot()),
		);
	} catch (error) {
		console.warn("saved game write failed", error);
	}
}

function isValidSavedGameSnapshot(snapshot) {
	return snapshot?.schemaVersion === SAVED_GAME_SCHEMA_VERSION &&
		snapshot?.gameState?.gameStarted === true &&
		snapshot?.gameState?.gameFinished !== true &&
		Array.isArray(snapshot.gameState.allPlayers) &&
		Array.isArray(snapshot.gameState.players) &&
		hasExactlyOneHumanPlayer(snapshot.gameState.players) &&
		snapshot.flowState &&
		typeof snapshot.flowState.type === "string";
}

function readSavedGameSnapshot() {
	if (SPEED_MODE) {
		return null;
	}

	const storage = getLocalStorage();
	if (!storage) {
		return null;
	}

	try {
		const rawSnapshot = storage.getItem(SAVED_GAME_STORAGE_KEY);
		if (!rawSnapshot) {
			return null;
		}
		const snapshot = JSON.parse(rawSnapshot);
		if (isValidSavedGameSnapshot(snapshot)) {
			return snapshot;
		}
		storage.removeItem(SAVED_GAME_STORAGE_KEY);
	} catch (error) {
		console.warn("saved game read failed", error);
		removeSavedGameSnapshot();
	}
	return null;
}

function setCurrentFlowState(flowState) {
	currentFlowState = clonePlainValue(flowState, { type: "unknown" });
}

function createActiveTurnFlowState(player, cycles, progressState) {
	return {
		type: "active-turn",
		phaseIndex: gameState.currentPhaseIndex,
		seatIndex: player.seatIndex,
		cycles,
		progressState: {
			nextIndex: progressState.nextIndex,
			cycles: progressState.cycles,
		},
	};
}

function normalizeSavedProgressState(progressState) {
	if (
		!progressState ||
		!Number.isFinite(progressState.nextIndex) ||
		!Number.isFinite(progressState.cycles)
	) {
		return null;
	}
	return {
		nextIndex: progressState.nextIndex,
		cycles: progressState.cycles,
	};
}

function normalizeSavedPlayer(player) {
	return {
		name: typeof player?.name === "string" ? player.name : "Player",
		isBot: player?.isBot === true,
		seatSlot: normalizeNumber(player?.seatSlot, normalizeNumber(player?.seatIndex, 0)),
		winnerReactionEmoji: typeof player?.winnerReactionEmoji === "string" ? player.winnerReactionEmoji : "",
		winnerReactionUntil: normalizeNumber(player?.winnerReactionUntil, 0),
		isWinner: player?.isWinner === true,
		actionState: player?.actionState ? { ...player.actionState } : null,
		winProbability: typeof player?.winProbability === "number" ? player.winProbability : null,
		lastNonFinalWinProbability: typeof player?.lastNonFinalWinProbability === "number"
			? player.lastNonFinalWinProbability
			: null,
		seatIndex: normalizeNumber(player?.seatIndex, 0),
		holeCards: Array.isArray(player?.holeCards) ? player.holeCards.slice(0, 2) : [null, null],
		visibleHoleCards: Array.isArray(player?.visibleHoleCards)
			? player.visibleHoleCards.slice(0, 2)
			: [false, false],
		dealer: player?.dealer === true,
		smallBlind: player?.smallBlind === true,
		bigBlind: player?.bigBlind === true,
		folded: player?.folded === true,
		chips: normalizeNumber(player?.chips, 0),
		allIn: player?.allIn === true,
		totalBet: normalizeNumber(player?.totalBet, 0),
		roundBet: normalizeNumber(player?.roundBet, 0),
		stats: createStatsSnapshot(player?.stats),
		botLine: createBotLineSnapshot(player?.botLine),
		spotState: {
			...createPlayerSpotState(),
			...clonePlainValue(player?.spotState, {}),
		},
	};
}

function restoreRuntimeState(runtimeState = {}) {
	totalHands = normalizeNumber(runtimeState.totalHands, 0);
	hadHumansAtStart = runtimeState.hadHumansAtStart === true;
	currentGameSaveEligible = runtimeState.currentGameSaveEligible === true;
	exitEventSent = false;
	handFastForwardActive = runtimeState.handFastForwardActive === true;
	autoplayToGameEnd = runtimeState.autoplayToGameEnd === true;
	nextChipTransferId = normalizeNumber(runtimeState.nextChipTransferId, 1);

	notifArr.splice(
		0,
		notifArr.length,
		...(Array.isArray(runtimeState.notifications) ? runtimeState.notifications.slice(0, MAX_ITEMS) : []),
	);
	pendingNotif.splice(
		0,
		pendingNotif.length,
		...(Array.isArray(runtimeState.pendingNotifications) ? runtimeState.pendingNotifications : []),
	);

	if (logList) {
		logList.replaceChildren();
		const logEntries = Array.isArray(runtimeState.logEntries) ? runtimeState.logEntries : notifArr;
		logEntries.forEach((message) => {
			const logEntry = document.createElement("div");
			logEntry.textContent = message;
			logList.appendChild(logEntry);
		});
	}

	renderNotificationBar(notification, notifArr);
	setSummaryButtonsVisible(runtimeState.summaryButtonsVisible === true);
}

function restoreGameState(savedGameState) {
	const allPlayers = savedGameState.allPlayers.map(normalizeSavedPlayer);
	const playerBySeatIndex = new Map(
		allPlayers.map((player) => [player.seatIndex, player]),
	);
	const activeSeatIndexes = Array.isArray(savedGameState.activeSeatIndexes)
		? savedGameState.activeSeatIndexes
		: savedGameState.players.map((player) => player.seatIndex);
	const activePlayers = activeSeatIndexes
		.map((seatIndex) => playerBySeatIndex.get(seatIndex))
		.filter((player) => player !== undefined);

	Object.assign(gameState, {
		currentPhaseIndex: normalizeNumber(savedGameState.currentPhaseIndex, 0),
		currentBet: normalizeNumber(savedGameState.currentBet, 0),
		pot: normalizeNumber(savedGameState.pot, 0),
		activeSeatIndex: savedGameState.activeSeatIndex ?? null,
		handId: normalizeNumber(savedGameState.handId, 0),
		nextDecisionId: normalizeNumber(savedGameState.nextDecisionId, 1),
		blindLevel: normalizeNumber(savedGameState.blindLevel, 0),
		gameStarted: savedGameState.gameStarted === true,
		gameFinished: savedGameState.gameFinished === true,
		openCardsMode: savedGameState.openCardsMode === true,
		spectatorMode: savedGameState.spectatorMode === true,
		raisesThisRound: normalizeNumber(savedGameState.raisesThisRound, 0),
		handInProgress: savedGameState.handInProgress === true,
		deck: Array.isArray(savedGameState.deck) ? savedGameState.deck.slice() : INITIAL_DECK.slice(),
		cardGraveyard: Array.isArray(savedGameState.cardGraveyard) ? savedGameState.cardGraveyard.slice() : [],
		communityCards: Array.isArray(savedGameState.communityCards) ? savedGameState.communityCards.slice() : [],
		players: activePlayers,
		allPlayers,
		chipTransfer: clonePlainValue(savedGameState.chipTransfer, null),
		pendingAction: null,
		smallBlind: normalizeNumber(savedGameState.smallBlind, INITIAL_SMALL_BLIND),
		bigBlind: normalizeNumber(savedGameState.bigBlind, INITIAL_BIG_BLIND),
		lastRaise: normalizeNumber(savedGameState.lastRaise, INITIAL_BIG_BLIND),
		handContext: {
			...createHandContextState(),
			...clonePlainValue(savedGameState.handContext, {}),
		},
	});
}

function resetRuntimeBeforeRestore() {
	if (notifTimer) {
		clearTimeout(notifTimer);
		notifTimer = null;
	}
	if (stateSyncTimer !== null) {
		clearTimeout(stateSyncTimer);
		stateSyncTimer = null;
		stateSyncTimerDelay = null;
	}
	if (runoutPhaseTimer) {
		clearTimeout(runoutPhaseTimer);
		runoutPhaseTimer = null;
	}
	clearNewRoundCountdown({ notify: false });
	clearChipTransferFinishTimer();
	clearChipTransferAnimation(tableRenderTarget);
	humanTurnController.hide();
	isNotifProcessing = false;
}

function renderRestoredGameState() {
	seatRefs.forEach((seatRef) => {
		clearRenderedSeat(seatRef);
		seatRef.playerSeatIndex = null;
		seatRef.clearActionLabelState = null;
		seatRef.clearWinnerReactionState = null;
		renderSeatSetupState(seatRef, {
			visible: false,
			isBot: false,
			nameEditable: false,
			controlsVisible: false,
		});
	});

	gameState.players.forEach((player) => {
		bindSeatRefPlayer(player);
		renderSeatSetupState(getSeatRef(player), {
			visible: true,
			isBot: player.isBot,
			nameEditable: false,
			controlsVisible: false,
		});
		renderPlayerSeat(player);
		if (
			!player.isBot &&
			gameState.handInProgress &&
			!gameState.openCardsMode &&
			!player.folded &&
			player.holeCards.every(Boolean)
		) {
			showPlayerQr(player, player.holeCards[0], player.holeCards[1]);
		} else {
			hidePlayerQr(player);
		}
	});

	renderPot();
	renderTableCommunityCards(communityCardSlots, gameState.communityCards);
	renderPlayerChipStacks();
	updateFastForwardButton();
	renderStatsOverlay();
	syncLogUi();
	instructionsButton.classList.add("hidden");
	startButton.classList.toggle("hidden", gameState.handInProgress === true);
	if (!gameState.handInProgress) {
		setStartButtonLabel("New Round");
	}
}

function restoreTableUrl(savedTableId) {
	tableId = typeof savedTableId === "string" && savedTableId ? savedTableId : null;
	syncTableUrlWithState();
}

function resumeRestoredFlow(flowState = {}) {
	setCurrentFlowState(flowState);
	if (flowState.type === "chip-transfer") {
		gameState.chipTransfer = null;
		clearChipTransferAnimation(tableRenderTarget);
		finishHandAfterShowdown();
		return;
	}
	if (flowState.type === "runout") {
		setPhase();
		return;
	}
	if (flowState.type === "active-turn" && gameState.handInProgress) {
		startButton.classList.add("hidden");
		startBettingRound({
			resetRound: false,
			progressState: normalizeSavedProgressState(flowState.progressState),
			resumeTurn: {
				seatIndex: flowState.seatIndex,
				cycles: normalizeNumber(flowState.cycles, 0),
			},
		});
		return;
	}
	if (gameState.handInProgress) {
		startButton.classList.add("hidden");
		startBettingRound({ resetRound: false });
		return;
	}

	setCurrentFlowState({ type: "between-hands" });
	setSummaryButtonsVisible(true);
	setStartButtonLabel("New Round");
	startButton.classList.remove("hidden");
	startNewRoundCountdown();
	saveCurrentGameSnapshot();
}

function restoreSavedGame(snapshot) {
	resetRuntimeBeforeRestore();
	restoreRuntimeState(snapshot.runtimeState);
	restoreGameState(snapshot.gameState);
	currentGameSaveEligible = hasExactlyOneHumanPlayer(gameState.players);
	restoreTableUrl(snapshot.tableId);
	renderRestoredGameState();
	syncRuntimePlayback();
	resumeRestoredFlow(snapshot.flowState);
	queueStateSync(0);
}

function trackSavedGameResume() {
	if (SPEED_MODE) {
		return;
	}
	globalThis.umami?.track("Poker", {
		resumedGame: true,
	});
}

function openResumeGameOverlay(snapshot) {
	if (!resumeGameOverlay) {
		return;
	}
	pendingSavedGameSnapshot = snapshot;
	openOverlay("resume");
}

function closeResumeGameOverlay() {
	pendingSavedGameSnapshot = null;
	if (!resumeGameOverlay) {
		return;
	}
	resumeGameOverlay.classList.add("hidden");
	syncOverlayBackdrop();
}

function continueSavedGame() {
	const snapshot = pendingSavedGameSnapshot;
	if (!snapshot) {
		return;
	}
	removeSavedGameSnapshot();
	closeResumeGameOverlay();
	restoreSavedGame(snapshot);
	trackSavedGameResume();
}

function discardSavedGame() {
	removeSavedGameSnapshot();
	closeResumeGameOverlay();
}

function handlePageLifecycleSave() {
	saveCurrentGameSnapshot();
	trackUnfinishedExit();
}

// A game is live from the moment Start is pressed until somebody is crowned champion.
function isGameLive() {
	return gameState.gameStarted === true && gameState.gameFinished !== true;
}

// Only a table with a single person on it can be picked up again after a reload. Anywhere else,
// closing or refreshing the shared table ends the game for everyone who joined it, so make the
// browser ask first rather than letting a stray Ctrl+R bin the night.
function wouldLoseGameOnUnload() {
	return isGameLive() && !hasExactlyOneHumanPlayer(gameState.players);
}

function handleBeforeUnload(event) {
	handlePageLifecycleSave();
	if (!wouldLoseGameOnUnload()) {
		return undefined;
	}
	event.preventDefault();
	// Browsers show their own wording; a non-empty value is what asks the question.
	event.returnValue = "";
	return "";
}

/* --------------------------------------------------------------------------------------------------
Low-Level Utilities And Formatting Helpers
---------------------------------------------------------------------------------------------------*/

function logHistory(msg) {
	if (HISTORY_LOG) console.log(msg);
}

function logFlow(msg, data) {
	if (DEBUG_FLOW) {
		const ts = new Date().toISOString().slice(11, 23);
		if (data !== undefined) {
			console.log("%c" + ts, "color:#888", msg, data);
		} else {
			console.log("%c" + ts, "color:#888", msg);
		}
	}
}

function logSpeedmodeEvent(type, payload) {
	if (!SPEED_MODE) {
		return;
	}
	console.log("speedmode_event", { type, ...payload });
}

function clearBotCheckRaiseIntent(player, reason) {
	const intent = player.botLine?.checkRaiseIntent;
	if (!intent) {
		return;
	}

	logSpeedmodeEvent("bot_check_raise_intent_clear", {
		handId: gameState.handId ?? 0,
		player: player.name,
		seatIndex: player.seatIndex,
		reason,
		street: intent.street,
		edge: intent.edge,
		rawHandRank: intent.rawHandRank,
		rawHand: intent.rawHand,
		textureRisk: intent.textureRisk,
		structureTag: intent.structureTag,
		plannedAmount: intent.plannedAmount,
	});
	player.botLine.checkRaiseIntent = null;
}

function clearBotCheckRaiseIntents(reason) {
	gameState.players.forEach((player) => clearBotCheckRaiseIntent(player, reason));
}

function clearBotPassiveValueCheckIntent(player, reason) {
	const intent = player.botLine?.passiveValueCheckIntent;
	if (!intent) {
		return;
	}

	logSpeedmodeEvent("bot_passive_value_check_intent_clear", {
		handId: gameState.handId ?? 0,
		player: player.name,
		seatIndex: player.seatIndex,
		reason,
		street: intent.street,
		edge: intent.edge,
		rawHandRank: intent.rawHandRank,
		rawHand: intent.rawHand,
		textureRisk: intent.textureRisk,
		structureTag: intent.structureTag,
		plannedAmount: intent.plannedAmount,
	});
	player.botLine.passiveValueCheckIntent = null;
}

function clearBotPassiveValueCheckIntents(reason) {
	gameState.players.forEach((player) => clearBotPassiveValueCheckIntent(player, reason));
}

function buildSpeedmodeHandStartPlayers(players) {
	return players.map((player) => ({
		name: player.name,
		seatIndex: player.seatIndex,
		chipsStart: player.chips,
	}));
}

function buildSpeedmodeTotalBetByPlayer(contributors) {
	return contributors.reduce((totals, player) => {
		totals[player.name] = player.totalBet;
		return totals;
	}, {});
}

function buildSpeedmodeTotalBetBySeatIndex(contributors) {
	return contributors.reduce((totals, player) => {
		totals[player.seatIndex] = player.totalBet;
		return totals;
	}, {});
}

function buildSpeedmodePayoutByPlayer(totalPayoutByPlayer) {
	const payouts = {};
	for (const [player, amount] of totalPayoutByPlayer.entries()) {
		payouts[player.name] = amount;
	}
	return payouts;
}

function buildSpeedmodePayoutBySeatIndex(totalPayoutByPlayer) {
	const payouts = {};
	for (const [player, amount] of totalPayoutByPlayer.entries()) {
		payouts[player.seatIndex] = amount;
	}
	return payouts;
}

function createPageUrl(pageName) {
	const base = globalThis.location.origin +
		globalThis.location.pathname.replace(/[^/]*$/, "");
	return new URL(`${base}${pageName}`);
}

function formatPercent(numerator, denominator) {
	if (denominator === 0) {
		return "-";
	}
	return `${Math.round((numerator / denominator) * 100)}%`;
}

function getRandomItem(items) {
	return items[Math.floor(Math.random() * items.length)];
}

/* --------------------------------------------------------------------------------------------------
Seat And Player Binding Helpers
---------------------------------------------------------------------------------------------------*/

function getSeatRef(target) {
	if (typeof target === "number") {
		return seatRefs[target] ?? null;
	}
	if (!target) {
		return null;
	}
	if (target.seatEl) {
		return target;
	}
	if (typeof target.seatSlot === "number") {
		return seatRefs[target.seatSlot] ?? null;
	}
	return null;
}

function setPlayerActionState(player, actionName, labelUntil) {
	if (!player || !actionName || !Number.isFinite(labelUntil)) {
		clearPlayerActionState(player);
		return;
	}
	player.actionState = {
		name: actionName,
		labelUntil,
	};
}

function clearPlayerActionState(player) {
	if (!player) {
		return;
	}
	player.actionState = null;
}

function clearPlayerWinnerReactionState(player) {
	player.winnerReactionEmoji = "";
	player.winnerReactionUntil = 0;
}

function bindSeatRefPlayer(player) {
	const seatRef = getSeatRef(player);
	if (!seatRef) {
		return;
	}
	seatRef.playerSeatIndex = player.seatIndex;
	seatRef.clearActionLabelState = () => clearPlayerActionState(player);
	seatRef.clearWinnerReactionState = () => clearPlayerWinnerReactionState(player);
}

function buildPlayerSeatState(
	player,
	communityCards = getCommunityCardCodes(),
) {
	const publicPlayerView = buildPublicPlayerView(
		player,
		communityCards,
		gameState,
	);
	const winProbabilityLabel = publicPlayerView.showWinProbability &&
			typeof publicPlayerView.winProbability === "number"
		? `${Math.round(publicPlayerView.winProbability)}%`
		: "";

	return {
		name: publicPlayerView.name,
		chips: publicPlayerView.chips,
		roundBet: publicPlayerView.roundBet,
		visibleCardCodes: publicPlayerView.publicHoleCards,
		dealer: publicPlayerView.dealer,
		smallBlind: publicPlayerView.smallBlind,
		bigBlind: publicPlayerView.bigBlind,
		folded: publicPlayerView.folded,
		allIn: publicPlayerView.allIn,
		active: gameState.activeSeatIndex === player.seatIndex,
		winner: publicPlayerView.winner,
		handStrengthLabel: publicPlayerView.handStrengthLabel,
		winProbabilityLabel,
		actionState: publicPlayerView.actionState,
		winnerReaction: publicPlayerView.winnerReaction,
	};
}

function renderPlayerSeat(player, communityCards = getCommunityCardCodes()) {
	const seatRef = getSeatRef(player);
	if (!seatRef) {
		return;
	}
	renderHostSeat(seatRef, buildPlayerSeatState(player, communityCards));
}

function renderPlayerResolvedAction(player) {
	const seatRef = getSeatRef(player);
	if (!seatRef) {
		return;
	}
	renderSeatResolvedAction(seatRef, {
		playerName: player.name,
		actionName: player.actionState?.name,
		labelUntil: player.actionState?.labelUntil,
		isFolded: player.folded,
	});
}

function getPlayerSeatRenderData(playerList = gameState.players) {
	return playerList
		.map((player) => {
			const seatRef = getSeatRef(player);
			if (!seatRef) {
				return null;
			}
			return {
				seatIndex: player.seatIndex,
				chips: player.chips,
				totalEl: seatRef.totalEl,
				stackChipEls: seatRef.stackChipEls,
			};
		})
		.filter((playerView) => playerView !== null);
}

function renderPlayerChipStacks(playerList = gameState.players) {
	renderChipStacks(getPlayerSeatRenderData(playerList));
}

function renderPlayerTotal(player) {
	renderPlayerSeat(player);
}

function showPlayerQr(player, card1, card2) {
	const seatRef = getSeatRef(player);
	if (!seatRef?.qrContainer || !seatRef.qrLink || !seatRef.remoteLink) {
		return;
	}

	seatRef.qrContainer.classList.remove("hidden");
	const holeCardsUrl = createPageUrl("hole-cards.html");
	holeCardsUrl.searchParams.set("card1", card1);
	holeCardsUrl.searchParams.set("card2", card2);
	holeCardsUrl.searchParams.set("name", player.name);
	holeCardsUrl.searchParams.set("chips", `${player.chips}`);
	holeCardsUrl.searchParams.set("seatIndex", `${player.seatIndex}`);
	if (tableId !== null) {
		holeCardsUrl.searchParams.set("tableId", tableId);
	}
	holeCardsUrl.searchParams.set("t", `${Date.now()}`);
	const url = holeCardsUrl.toString();
	seatRef.qrLink.replaceChildren();
	seatRef.qrLink.href = url;
	QrCreator.render({
		text: url,
		size: 200,
		fill: "#333",
		background: "#fff",
		radius: 0,
	}, seatRef.qrLink);

	if (tableId !== null) {
		const remoteTableUrl = createPageUrl("remoteTable.html");
		remoteTableUrl.searchParams.set("tableId", tableId);
		remoteTableUrl.searchParams.set("seatIndex", `${player.seatIndex}`);
		seatRef.remoteLink.href = remoteTableUrl.toString();
		seatRef.remoteLink.classList.remove("hidden");
	} else {
		seatRef.remoteLink.removeAttribute("href");
		seatRef.remoteLink.classList.add("hidden");
	}

	seatRef.qrContainer.dataset.url = url;
}

function hidePlayerQr(player) {
	const seatRef = getSeatRef(player);
	if (!seatRef?.qrContainer || !seatRef.qrLink || !seatRef.remoteLink) {
		return;
	}

	seatRef.qrContainer.classList.add("hidden");
	seatRef.qrLink.replaceChildren();
	seatRef.qrLink.removeAttribute("href");
	seatRef.remoteLink.removeAttribute("href");
	seatRef.remoteLink.classList.add("hidden");
	delete seatRef.qrContainer.dataset.url;
}

function resetPlayerRoundBet(player) {
	player.roundBet = 0;
	renderPlayerSeat(player);
}

function clearPlayerActionLabel(player) {
	clearPlayerActionState(player);
	renderPlayerResolvedAction(player);
}

function applyPlayerPatches(playerPatches) {
	playerPatches.forEach(({ player, patch }) => {
		Object.assign(player, patch);
	});
}

function applyGameStatePatch(gameStatePatch) {
	Object.assign(gameState, gameStatePatch);
}

function applyHandContextPatch(handContextPatch) {
	if (!handContextPatch) {
		return;
	}
	if (!gameState.handContext) {
		gameState.handContext = createHandContextState();
	}
	Object.assign(gameState.handContext, handContextPatch);
}

function clearPlayerWinnerReaction(player) {
	clearPlayerWinnerReactionState(player);
	renderPlayerSeat(player);
}

function showPlayerWinnerReaction(player, emoji, visibleUntil) {
	player.winnerReactionEmoji = emoji;
	player.winnerReactionUntil = visibleUntil;
	renderPlayerSeat(player);
}

/* --------------------------------------------------------------------------------------------------
Render And Overlay Helpers
---------------------------------------------------------------------------------------------------*/

function renderPot() {
	potEl.textContent = gameState.pot;
}

function setCommunityCards(cardCodes) {
	gameState.communityCards = cardCodes.slice();
	renderTableCommunityCards(communityCardSlots, gameState.communityCards);
}

function setPlayerVisibleHoleCards(player, visibleHoleCards) {
	player.visibleHoleCards = visibleHoleCards.slice();
	renderPlayerHoleCards(player);
}

function renderPlayerHoleCards(player) {
	renderPlayerSeat(player);
}

function getStatsPlayers() {
	return gameState.allPlayers.slice().sort((a, b) => {
		if (b.chips !== a.chips) {
			return b.chips - a.chips;
		}
		return a.seatIndex - b.seatIndex;
	});
}

function createStatsCell(tagName, value) {
	const cell = document.createElement(tagName);
	cell.textContent = `${value}`;
	return cell;
}

function renderStatsOverlay() {
	if (!statsTableBody) {
		return;
	}

	statsTableBody.replaceChildren();
	getStatsPlayers().forEach((player) => {
		const row = document.createElement("tr");
		row.appendChild(createStatsCell("th", player.name));
		row.appendChild(createStatsCell("td", formatMoneyCompact(player.chips)));
		row.appendChild(createStatsCell("td", player.stats.hands));
		row.appendChild(createStatsCell("td", player.stats.handsWon));
		row.appendChild(
			createStatsCell(
				"td",
				formatPercent(player.stats.handsWon, player.stats.hands),
			),
		);
		row.appendChild(createStatsCell("td", player.stats.showdowns));
		row.appendChild(createStatsCell("td", player.stats.showdownsWon));
		row.appendChild(
			createStatsCell(
				"td",
				formatPercent(
					player.stats.showdownsWon,
					player.stats.showdowns,
				),
			),
		);
		row.appendChild(createStatsCell("td", player.stats.folds));
		row.appendChild(createStatsCell("td", player.stats.foldsPreflop));
		row.appendChild(createStatsCell("td", player.stats.foldsPostflop));
		row.appendChild(createStatsCell("td", player.stats.allins));
		statsTableBody.appendChild(row);
	});
}

function renderVersionOverlay() {
	if (!versionList) {
		return;
	}

	versionList.replaceChildren();
	VERSION_LOG.forEach((entry) => {
		const versionEntry = document.createElement("article");
		versionEntry.className = "version-entry";

		const heading = document.createElement("div");
		heading.className = "version-entry-heading";

		const versionLabel = document.createElement("h3");
		versionLabel.className = "version-entry-version";
		versionLabel.textContent = `v${entry.version}`;
		heading.appendChild(versionLabel);

		const title = document.createElement("p");
		title.className = "version-entry-title";
		title.textContent = entry.title;
		heading.appendChild(title);

		const meta = document.createElement("span");
		meta.className = "version-entry-meta";
		meta.textContent = entry.date;
		heading.appendChild(meta);

		if (entry.credit) {
			const credit = document.createElement("a");
			credit.className = "version-entry-credit";
			credit.href = entry.credit.url;
			credit.target = "_blank";
			credit.rel = "noopener noreferrer";
			credit.textContent = `Contributed by @${entry.credit.name}`;
			heading.appendChild(credit);
		}

		const notes = document.createElement("ul");
		notes.className = "version-entry-notes";
		entry.notes.forEach((note) => {
			const noteItem = document.createElement("li");
			noteItem.textContent = note;
			notes.appendChild(noteItem);
		});

		versionEntry.appendChild(heading);
		versionEntry.appendChild(notes);
		versionList.appendChild(versionEntry);
	});
}

function syncOverlayBackdrop() {
	const isOverlayOpen = Object.values(overlays).some(({ el }) => el && !el.classList.contains("hidden"));
	overlayBackdrop.classList.toggle("hidden", !isOverlayOpen);
}

function isBlockingOverlayOpen() {
	return Object.values(overlays).some((overlay) =>
		overlay.blocking === true &&
		overlay.el &&
		!overlay.el.classList.contains("hidden")
	);
}

function openOverlay(name) {
	const overlay = overlays[name];
	if (!overlay) {
		return;
	}
	if (overlay.canOpen && !overlay.canOpen()) {
		return;
	}
	Object.entries(overlays).forEach(([key, entry]) => {
		entry.el?.classList.toggle("hidden", key !== name);
	});
	overlay.beforeOpen?.();
	syncOverlayBackdrop();
}

function closeOverlay(name) {
	const overlay = overlays[name];
	if (!overlay || overlay.blocking === true) {
		return;
	}
	overlay.el.classList.add("hidden");
	syncOverlayBackdrop();
}

function closeAllOverlays() {
	Object.values(overlays).forEach(({ el, blocking }) => {
		if (blocking !== true) {
			el?.classList.add("hidden");
		}
	});
	syncOverlayBackdrop();
}

function syncLogUi() {
	const hasLogHistory = !!logList && logList.childElementCount > 0;
	const showSummaryButtons = !SPEED_MODE && summaryButtonsVisible;

	statsButton.classList.toggle("hidden", !showSummaryButtons);
	logButton.classList.toggle("hidden", !showSummaryButtons || !hasLogHistory);
}

function setSummaryButtonsVisible(isVisible) {
	summaryButtonsVisible = isVisible;
	syncLogUi();
}

function setStartButtonLabel(text) {
	if (startButtonLabel) {
		startButtonLabel.textContent = text;
		startButtonLabel.classList.remove("hidden");
		return;
	}
	startButton.textContent = text;
}

function showNewRoundCountdown(seconds) {
	if (!newRoundCountdown || !newRoundCountdownValue) {
		setStartButtonLabel(`New Round in ${seconds}`);
		return;
	}
	newRoundCountdownValue.textContent = String(seconds);
	newRoundCountdown.classList.remove("hidden");
}

function clearNewRoundCountdown({ notify } = { notify: false }) {
	const wasActive = newRoundCountdownTimer !== null ||
		newRoundCountdownSeconds > 0;
	if (newRoundCountdownTimer !== null) {
		clearTimeout(newRoundCountdownTimer);
		newRoundCountdownTimer = null;
	}
	newRoundCountdownSeconds = 0;
	if (newRoundControls) {
		newRoundControls.classList.remove("new-round-countdown-active");
	}
	startButton.classList.remove("new-round-countdown-active");
	if (newRoundCountdown) {
		newRoundCountdown.classList.add("hidden");
	}
	if (newRoundCancelButton) {
		newRoundCancelButton.classList.add("hidden");
		newRoundCancelButton.classList.remove("new-round-countdown-active");
	}
	if (newRoundCountdownValue) {
		newRoundCountdownValue.textContent = String(
			NEW_ROUND_COUNTDOWN_SECONDS,
		);
	}
	if (!newRoundCountdown || !newRoundCountdownValue) {
		setStartButtonLabel("New Round");
	}
	if (notify && wasActive) {
		enqueueNotification("New round countdown canceled.");
	}
}

function tickNewRoundCountdown() {
	newRoundCountdownSeconds--;
	if (newRoundCountdownSeconds <= 0) {
		clearNewRoundCountdown({ notify: false });
		preFlop();
		return;
	}
	showNewRoundCountdown(newRoundCountdownSeconds);
	newRoundCountdownTimer = setTimeout(
		tickNewRoundCountdown,
		NEW_ROUND_COUNTDOWN_INTERVAL,
	);
}

function startNewRoundCountdown() {
	clearNewRoundCountdown({ notify: false });
	if (SPEED_MODE || autoplayToGameEnd) {
		return;
	}
	newRoundCountdownSeconds = NEW_ROUND_COUNTDOWN_SECONDS;
	showNewRoundCountdown(newRoundCountdownSeconds);
	if (newRoundControls) {
		newRoundControls.classList.add("new-round-countdown-active");
	}
	startButton.classList.add("new-round-countdown-active");
	if (newRoundCancelButton) {
		newRoundCancelButton.classList.remove("hidden");
		newRoundCancelButton.classList.add("new-round-countdown-active");
	}
	newRoundCountdownTimer = setTimeout(
		tickNewRoundCountdown,
		NEW_ROUND_COUNTDOWN_INTERVAL,
	);
}

function cancelNewRoundCountdown() {
	clearNewRoundCountdown({ notify: true });
}

/* --------------------------------------------------------------------------------------------------
Notification And Playback Helpers
---------------------------------------------------------------------------------------------------*/

function isFastPlaybackActive() {
	return SPEED_MODE || handFastForwardActive || autoplayToGameEnd;
}

function isTurboPlaybackActive() {
	return handFastForwardActive || autoplayToGameEnd;
}

function getNotifInterval() {
	if (SPEED_MODE) {
		return 0;
	}
	if (isTurboPlaybackActive()) {
		return FAST_FORWARD_NOTIF_INTERVAL;
	}
	return NOTIF_INTERVAL;
}

function getActionLabelDuration() {
	if (SPEED_MODE) {
		return 0;
	}
	if (isTurboPlaybackActive()) {
		return FAST_FORWARD_ACTION_LABEL_DURATION;
	}
	return ACTION_LABEL_DURATION;
}

// `amount` here is the player's TOTAL for the round after the action, not the chips just added.
// Quoting the stake instead is what made a raise to 50 announce itself as "raised to 40".
function getPlayerActionNotificationText(playerName, actionName, amount = 0) {
	switch (actionName) {
		case "fold":
			return `${playerName} folded.`;
		case "check":
			return `${playerName} checked.`;
		case "call":
			return `${playerName} called ${formatMoney(amount)}.`;
		case "raise":
			return `${playerName} raised to ${formatMoney(amount)}.`;
		case "allin":
			return `${playerName} is all-in.`;
		default:
			return `${playerName} did something…`;
	}
}

function logSkippedPlayerActionProbability(
	player,
	action,
	skipProbabilityLogReason,
) {
	switch (skipProbabilityLogReason) {
		case "allin-runout-preflop":
			logFlow("winProbability: preflop all-in runout pending", {
				action,
				name: player.name,
			});
			break;
		case "fold-preflop":
			logFlow("winProbability: preflop fold skipped", {
				name: player.name,
			});
			break;
	}
}

function getRunoutPhaseDelay() {
	if (SPEED_MODE) {
		return 0;
	}
	if (isTurboPlaybackActive()) {
		return FAST_FORWARD_RUNOUT_PHASE_DELAY;
	}
	return RUNOUT_PHASE_DELAY;
}

function scheduleNextNotif() {
	if (notifTimer) {
		clearTimeout(notifTimer);
	}
	notifTimer = setTimeout(() => {
		notifTimer = null;
		showNextNotif();
	}, getNotifInterval());
}

function deliverNotification(msg) {
	// newest message first for tracking
	if (logList) {
		const logEntry = document.createElement("div");
		logEntry.textContent = msg;
		logList.prepend(logEntry);
	}
	notifArr.unshift(msg);
	if (notifArr.length > MAX_ITEMS) notifArr.pop();
	syncLogUi();
	queueStateSync();
	renderNotificationBar(notification, notifArr);
	logHistory(msg);
}

function flushPendingNotifications() {
	if (notifTimer) {
		clearTimeout(notifTimer);
		notifTimer = null;
	}
	if (pendingNotif.length === 0) {
		isNotifProcessing = false;
		return;
	}
	isNotifProcessing = true;
	while (pendingNotif.length > 0) {
		deliverNotification(pendingNotif.shift());
	}
	isNotifProcessing = false;
}

function refreshNotificationPlayback() {
	if (!isNotifProcessing || pendingNotif.length === 0) {
		return;
	}
	scheduleNextNotif();
}

function syncRuntimePlayback() {
	setBotPlaybackFast(handFastForwardActive || autoplayToGameEnd);
	if (isFastPlaybackActive()) {
		flushPendingNotifications();
		return;
	}
	refreshNotificationPlayback();
}

function clearChipTransferFinishTimer() {
	if (chipTransferFinishTimer === null) {
		return;
	}
	clearTimeout(chipTransferFinishTimer);
	chipTransferFinishTimer = null;
}

function enqueueNotification(msg) {
	pendingNotif.push(msg);
	if (isFastPlaybackActive()) {
		flushPendingNotifications();
		return;
	}
	if (!isNotifProcessing) {
		showNextNotif();
	}
}

function showNextNotif() {
	if (pendingNotif.length === 0) {
		isNotifProcessing = false;
		notifTimer = null;
		return;
	}
	isNotifProcessing = true;
	deliverNotification(pendingNotif.shift());
	scheduleNextNotif();
}

function clearActionLabels() {
	gameState.players.forEach((player) => {
		clearPlayerActionLabel(player);
	});
}

function getHumanPlayers() {
	return gameState.players.filter((p) => !p.isBot);
}

function getHumansWithChipsCount() {
	return gameState.players.filter((p) => !p.isBot && p.chips > 0).length;
}

// Whether skipping ahead makes sense right now: a hand is running and no person left in it can act,
// so everyone is waiting on bots. The players' own views ask the same question, so it lives here
// rather than being re-derived and drifting.
function canFastForwardNow() {
	const humanPlayers = getHumanPlayers();
	const noHumanCanAct = humanPlayers.length === 0 ||
		humanPlayers.every((player) => player.folded);
	return !SPEED_MODE &&
		hadHumansAtStart &&
		gameState.handInProgress &&
		!gameState.gameFinished &&
		!handFastForwardActive &&
		!autoplayToGameEnd &&
		noHumanCanAct;
}

function updateFastForwardButton() {
	if (!fastForwardButton) {
		return;
	}
	fastForwardButton.classList.toggle("hidden", !canFastForwardNow());
}

// The buttons that belong to the table rather than to a seat, described so every player's view can
// offer them too instead of one person switching windows to press them.
function getTableControls() {
	const betweenHands = gameState.gameStarted &&
		!gameState.handInProgress &&
		!gameState.gameFinished;
	return {
		canFastForward: canFastForwardNow(),
		canStartNextRound: betweenHands,
		nextRoundSeconds: betweenHands && newRoundCountdownSeconds > 0 ? newRoundCountdownSeconds : null,
	};
}

// Pressed from a player's own view. Guarded so a stale press cannot deal a hand that is already
// running, or one that someone else has just dealt.
function runTableCommand(command) {
	if (command === "fastforward") {
		if (canFastForwardNow()) {
			logFlow("fast forward requested from a seat");
			activateFastForward();
		}
		return;
	}
	if (command === "nextround") {
		if (gameState.gameStarted && !gameState.handInProgress && !gameState.gameFinished) {
			logFlow("next round requested from a seat");
			startGame();
		}
	}
}

function resetRuntimeFastForward() {
	handFastForwardActive = false;
	autoplayToGameEnd = false;
	syncRuntimePlayback();
	updateFastForwardButton();
}

function activateFastForward() {
	if (
		!gameState.handInProgress || handFastForwardActive ||
		autoplayToGameEnd || SPEED_MODE
	) {
		return;
	}
	handFastForwardActive = true;
	clearActionLabels();
	syncRuntimePlayback();
	updateFastForwardButton();
	if (runoutPhaseTimer) {
		clearTimeout(runoutPhaseTimer);
		runoutPhaseTimer = null;
		setPhase();
	}
}

/* --------------------------------------------------------------------------------------------------
Analytics And Remote State-Sync Helpers
---------------------------------------------------------------------------------------------------*/

function getHandsPlayedBucket(handCount) {
	if (handCount < 35) return "<35";
	if (handCount <= 40) return "36-40";
	if (handCount <= 45) return "41-45";
	if (handCount <= 50) return "46-50";
	if (handCount <= 55) return "51-55";
	if (handCount <= 60) return "56-60";
	if (handCount <= 70) return "61-70";
	if (handCount <= 80) return "71-80";
	if (handCount <= 90) return "81-90";
	if (handCount <= 100) return "91-100";
	if (handCount <= 120) return "101-120";
	return ">120";
}

function getExitCounts() {
	const humansWithChipsAtExit = gameState.players.filter((p) => !p.isBot && p.chips > 0).length;
	const botsWithChipsAtExit = gameState.players.filter((p) => p.isBot && p.chips > 0).length;
	return { humansWithChipsAtExit, botsWithChipsAtExit };
}

function trackUnfinishedExit() {
	if (
		SPEED_MODE ||
		!globalThis.umami ||
		!gameState.gameStarted ||
		gameState.gameFinished ||
		exitEventSent ||
		!hadHumansAtStart
	) {
		return;
	}
	const { humansWithChipsAtExit, botsWithChipsAtExit } = getExitCounts();
	const exitCategory = humansWithChipsAtExit === 0 ? "last_human_bust" : "humans_left_with_chips";
	exitEventSent = true;
	globalThis.umami?.track("Poker", {
		finished: false,
		humansWithChipsAtExit,
		botsWithChipsAtExit,
		exitCategory,
	});
}

function registerBotReveal(player) {
	if (player?.stats) {
		player.stats.reveals++;
	}
	if (SPEED_MODE) {
		return;
	}
	globalThis.umami?.track("Poker", {
		botReveal: true,
	});
}

function hasStateSyncEnabled() {
	return tableId !== null;
}

function getHumanPlayerCount(players = gameState.players) {
	return players.filter((player) => !player.isBot).length;
}

function shouldEnableStateSyncForGame() {
	return getHumanPlayerCount() >= 2;
}

function syncTableUrlWithState() {
	const tableUrl = new URL(globalThis.location.href);
	if (tableId === null) {
		tableUrl.searchParams.delete("tableId");
	} else {
		tableUrl.searchParams.set("tableId", tableId);
	}
	globalThis.history.replaceState(null, "", tableUrl.toString());
}

function initStateSyncForGame() {
	if (!shouldEnableStateSyncForGame()) {
		tableId = null;
		syncTableUrlWithState();
		return;
	}

	const tableUrl = new URL(globalThis.location.href);
	tableId = tableUrl.searchParams.get("tableId") ||
		Math.random().toString(36).slice(2, 8);
	syncTableUrlWithState();
	startStateSyncHeartbeat();
}

/* --------------------------------------------------------------------------------------------------
State heartbeat

State is normally published when something happens. That is not enough on its own: while the table
waits for a person to act, nothing happens, so nothing is published -- and if the server restarts in
that window (a redeploy, or waking from sleep, both routine on free hosting) it comes back empty and
stays empty. Every seat then sits on "Table unavailable" while the table waits for an action nobody
can send. Re-publishing on a slow timer closes that hole: a restarted server is refilled within a few
seconds without anyone doing anything.
---------------------------------------------------------------------------------------------------*/

const STATE_HEARTBEAT_INTERVAL = 5000;
// A press of Fast Forward or Deal Next Round comes back on the next state push, so while either is
// available the table checks in more often. Five seconds of nothing happening after a button press
// feels broken.
const ACTIVE_HEARTBEAT_INTERVAL = 1200;
let stateHeartbeatTimer = null;

function startStateSyncHeartbeat() {
	stopStateSyncHeartbeat();
	if (!hasStateSyncEnabled()) {
		return;
	}
	const tick = () => {
		if (!hasStateSyncEnabled()) {
			stopStateSyncHeartbeat();
			return;
		}
		queueStateSync(0);
		// Check in briskly only while there is a table button someone might be pressing; the rest of
		// the time a slow pulse is enough to keep a restarted server topped up.
		const controls = getTableControls();
		const delay = (controls.canFastForward || controls.canStartNextRound)
			? ACTIVE_HEARTBEAT_INTERVAL
			: STATE_HEARTBEAT_INTERVAL;
		stateHeartbeatTimer = setTimeout(tick, delay);
	};
	stateHeartbeatTimer = setTimeout(tick, ACTIVE_HEARTBEAT_INTERVAL);
}

function stopStateSyncHeartbeat() {
	if (stateHeartbeatTimer === null) {
		return;
	}
	clearTimeout(stateHeartbeatTimer);
	stateHeartbeatTimer = null;
}

// The QR codes are only useful to someone holding a phone that reads them. Showing the join address
// and the code in plain text means a laptop can join by typing, which is what most people at a table
// actually have to hand.
function renderJoinBanner() {
	if (!joinBannerEl) {
		return;
	}

	if (!hasStateSyncEnabled()) {
		joinBannerEl.classList.add("hidden");
		return;
	}

	const joinUrl = createPageUrl("join.html");
	joinBannerUrlEl.textContent = `${joinUrl.host}${joinUrl.pathname}`;
	joinBannerCodeEl.textContent = tableId;
	joinBannerEl.classList.remove("hidden");
}

function createTurnToken() {
	return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function setPendingAction(player) {
	if (
		!hasStateSyncEnabled() || !player || player.isBot || player.folded ||
		player.allIn
	) {
		if (gameState.pendingAction !== null) {
			gameState.pendingAction = null;
			queueStateSync(0);
		}
		return null;
	}

	const actionState = getPlayerActionState(gameState, player);
	const pendingAction = {
		seatIndex: player.seatIndex,
		turnToken: createTurnToken(),
		needToCall: actionState.needToCall,
		minAmount: actionState.minAmount,
		maxAmount: actionState.maxAmount,
		minRaise: actionState.minRaise,
		maxRaiseAmount: actionState.maxRaiseAmount,
		canCheck: actionState.canCheck,
		roundBet: actionState.roundBet,
		buttonLabel: getActionButtonLabel(actionState.minAmount, actionState),
	};
	gameState.pendingAction = pendingAction;
	queueStateSync(0);
	return pendingAction;
}

function clearPendingAction() {
	if (gameState.pendingAction === null) {
		return;
	}
	gameState.pendingAction = null;
	queueStateSync(0);
}

async function fetchPendingRemoteAction(turnToken) {
	if (!hasStateSyncEnabled() || !turnToken) {
		return null;
	}

	try {
		const url = `${ACTION_SYNC_ENDPOINT}?tableId=${encodeURIComponent(tableId)}&turnToken=${
			encodeURIComponent(turnToken)
		}`;
		const res = await fetch(url, {
			cache: "no-store",
		});
		if (res.status === 204) {
			return null;
		}
		if (!res.ok) {
			logFlow("remote action poll failed", { status: res.status });
			return null;
		}
		// The same reply tells us which seats are live on their own devices.
		const payload = await res.json();
		setPresentRemoteSeats(payload?.presentSeats);
		setSeatLastSeen(payload?.seatsLastSeen);
		presenceRefreshedAt = Date.now();
		// An action is present only when it carries a turn token. Everything else in the reply is
		// presence, and an empty reply means there is nothing waiting.
		return payload?.turnToken ? payload : null;
	} catch (error) {
		logFlow("remote action poll failed", error);
		return null;
	}
}

/* --------------------------------------------------------------------------------------------------
Seat Presence

Which seats are being played from their own device. The backend refreshes a heartbeat whenever a seat
polls, and hands the live set back on every state push, so the shared table knows whose controls it
should not be showing.
---------------------------------------------------------------------------------------------------*/

function setSeatLastSeen(seatsLastSeen) {
	remoteSeatLastSeen = (seatsLastSeen && typeof seatsLastSeen === "object") ? seatsLastSeen : {};
}

function getSeatQuietMs(player) {
	const age = Number(remoteSeatLastSeen[player?.seatIndex]);
	return Number.isFinite(age) ? age : 0;
}

function setPresentRemoteSeats(seatIndexes) {
	const nextSeats = new Set(
		(Array.isArray(seatIndexes) ? seatIndexes : []).filter(Number.isInteger),
	);
	const changed = nextSeats.size !== presentRemoteSeats.size ||
		[...nextSeats].some((seatIndex) => !presentRemoteSeats.has(seatIndex));

	presentRemoteSeats = nextSeats;
	presenceRefreshedAt = Date.now();
	if (changed) {
		logFlow("remote seat presence", { seats: [...presentRemoteSeats] });
	}
}

function isSeatPresenceKnown() {
	// With sync off there are no devices in play, so there is nothing to wait to hear about and a
	// solo game must not sit on its hands before showing the controls.
	return !hasStateSyncEnabled() || presenceRefreshedAt > 0;
}

// A seat plays on its own device only while sync is on and its heartbeat is fresh. Anything else --
// sync off, backend unreachable, link never opened, phone asleep -- falls back to the shared screen,
// so a table can never be left with nobody able to act.
function isSeatPlayedRemotely(player) {
	return hasStateSyncEnabled() &&
		!!player &&
		!player.isBot &&
		presentRemoteSeats.has(player.seatIndex);
}

async function sendTableState() {
	const payload = {
		tableId: tableId,
		view: buildSyncView(gameState, notifArr.slice(0, MAX_ITEMS), Date.now(), getTableControls()),
	};

	try {
		const res = await fetch(STATE_SYNC_ENDPOINT, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});
		if (!res.ok) {
			throw new Error(`state sync failed with status ${res.status}`);
		}
		const result = await res.json();
		setPresentRemoteSeats(result?.presentSeats);
		setSeatLastSeen(result?.seatsLastSeen);
		if (typeof result?.command === "string") {
			runTableCommand(result.command);
		}
	} catch (error) {
		logFlow("state sync failed", error);
		// Losing contact with the backend must not strand a seat on a device we can no longer hear
		// from; hand every seat back to the shared screen until sync recovers.
		setPresentRemoteSeats([]);
		setSeatLastSeen({});
		queueStateSync();
	}
}

function queueStateSync(delay = STATE_SYNC_DELAY) {
	if (!hasStateSyncEnabled()) {
		return;
	}

	const nextDelay = Math.max(0, delay);
	if (stateSyncTimer !== null) {
		if (stateSyncTimerDelay !== null && stateSyncTimerDelay <= nextDelay) {
			return;
		}
		clearTimeout(stateSyncTimer);
	}

	stateSyncTimerDelay = nextDelay;
	stateSyncTimer = setTimeout(() => {
		stateSyncTimer = null;
		stateSyncTimerDelay = null;
		sendTableState();
	}, nextDelay);
}

/* --------------------------------------------------------------------------------------------------
Waiting for players

The join code only exists once a game has started, so pressing Start used to deal immediately and
leave the host trying to get everyone in while cards were already out. For a game with two or more
people the table now opens, publishes its code, and waits until everyone is at their own device --
or until whoever set it up says go anyway.
---------------------------------------------------------------------------------------------------*/

const WAITING_ROOM_POLL_INTERVAL = 2000;
let waitingForPlayers = false;
let waitingRoomTimer = null;

function shouldWaitForPlayersToJoin() {
	return hasStateSyncEnabled() && getHumanPlayers().length >= 2;
}

function renderWaitingRoom() {
	if (!waitingRoomEl || !waitingRoomMessageEl) {
		return;
	}

	if (!waitingForPlayers) {
		waitingRoomEl.classList.add("hidden");
		return;
	}

	const humans = getHumanPlayers();
	const joined = humans.filter((player) => presentRemoteSeats.has(player.seatIndex));
	const missing = humans.filter((player) => !presentRemoteSeats.has(player.seatIndex));

	waitingRoomMessageEl.textContent = missing.length === 0
		? "Everyone is in. Dealing…"
		: `Waiting for ${missing.map((player) => player.name).join(", ")}. ` +
			(joined.length > 0
				? `${joined.map((player) => player.name).join(", ")} ready.`
				: "Nobody has joined yet — use the code above.");
	waitingRoomEl.classList.remove("hidden");
}

function stopWaitingForPlayers() {
	waitingForPlayers = false;
	if (waitingRoomTimer !== null) {
		clearInterval(waitingRoomTimer);
		waitingRoomTimer = null;
	}
	renderWaitingRoom();
}

function dealNow() {
	if (!waitingForPlayers) {
		return;
	}
	stopWaitingForPlayers();
	preFlop();
}

function beginWaitingForPlayers() {
	waitingForPlayers = true;
	renderWaitingRoom();

	// Each state push comes back with who is on a device, so pushing is also how we find out.
	queueStateSync(0);
	waitingRoomTimer = setInterval(() => {
		queueStateSync(0);
		renderWaitingRoom();
		const humans = getHumanPlayers();
		if (humans.length > 0 && humans.every((player) => presentRemoteSeats.has(player.seatIndex))) {
			dealNow();
		}
	}, WAITING_ROOM_POLL_INTERVAL);
}

waitingRoomDealButton?.addEventListener("click", dealNow);

// Shown on the shared screen in place of a seat's action buttons while that seat is being played
// from its own device. Carries an escape hatch so the table is never stuck if the device gives up.
let remoteTurnTakeOver = null;

function handleRemoteTurnTakeoverClick() {
	const takeOver = remoteTurnTakeOver;
	if (typeof takeOver === "function") {
		takeOver();
	}
}

function renderRemoteTurnStatus(player, takeOver, { awaitingPresence = false } = {}) {
	remoteTurnTakeOver = typeof takeOver === "function" ? takeOver : null;
	if (!remoteTurnStatusEl || !remoteTurnMessageEl) {
		return;
	}

	if (!player) {
		remoteTurnStatusEl.classList.add("hidden");
		remoteTurnMessageEl.textContent = "";
		return;
	}

	// Once a device has been quiet for a while it may just be a slow decision, or the laptop may be
	// shut. Saying which lets whoever is at the table decide whether to wait or step in, instead of
	// being told someone is "playing" when they may have gone.
	const quietSeconds = Math.round(getSeatQuietMs(player) / 1000);
	if (awaitingPresence) {
		remoteTurnMessageEl.textContent = `Checking whether ${player.name} has joined on their own device…`;
	} else if (quietSeconds >= QUIET_DEVICE_SECONDS) {
		remoteTurnMessageEl.textContent = `Waiting for ${player.name}. Their device has not been in touch for ` +
			`${quietSeconds} seconds — take the turn here if they have dropped out.`;
	} else {
		remoteTurnMessageEl.textContent = `${player.name} is playing this turn on their own device.`;
	}
	remoteTurnStatusEl.classList.toggle("setup-warning", quietSeconds >= QUIET_DEVICE_SECONDS);
	remoteTurnStatusEl.classList.remove("hidden");
}

remoteTurnTakeoverButton?.addEventListener("click", handleRemoteTurnTakeoverClick);

const humanTurnController = createHumanTurnController({
	foldButton,
	actionButton,
	amountControls,
	amountSlider,
	sliderOutput,
	decrementButton: amountDecrementButton,
	incrementButton: amountIncrementButton,
	actionPollInterval: ACTION_POLL_INTERVAL,
	actionStep: CHIP_UNIT,
	onControlsHidden: updateFastForwardButton,
	onNewTurn: () => {
		if (!hasStateSyncEnabled()) {
			playTurnChime();
		}
	},
	setActiveTurnPlayer,
	setPendingAction,
	clearPendingAction,
	fetchPendingRemoteAction,
	applyTurnAction,
	continueAfterResolvedTurn,
	getPlayerActionState: (player) => getPlayerActionState(gameState, player),
	getResolvedTurnMeta,
	remoteTurnReviewInterval: REMOTE_TURN_REVIEW_INTERVAL,
	presenceGraceInterval: PRESENCE_GRACE_INTERVAL,
	isSeatPlayedRemotely,
	isSeatPresenceKnown,
	renderRemoteTurnStatus,
});

/* --------------------------------------------------------------------------------------------------
Card Visibility, Hand-Strength, Reveal, And Winner-Reaction Logic
---------------------------------------------------------------------------------------------------*/

function revealPlayerHoleCards(player) {
	setPlayerVisibleHoleCards(player, [true, true]);
}

function getCommunityCardCodes() {
	return gameState.communityCards.slice();
}

function revealActiveHoleCards() {
	gameState.players.filter((p) => !p.folded).forEach((p) => {
		revealPlayerHoleCards(p);
		hidePlayerQr(p);
	});
	updateHandStrengthDisplays();
}

function formatCardLabel(cardCode) {
	if (!cardCode || cardCode.length < 2) {
		return "";
	}
	const rank = cardCode[0] === "T" ? "10" : cardCode[0];
	const suit = CARD_SUIT_SYMBOLS[cardCode[1]] || cardCode[1];
	return `${rank}${suit}`;
}

function applyBotReveal(player, revealDecision) {
	if (!revealDecision) {
		return;
	}
	if (gameState.spectatorMode) {
		updateHandStrengthDisplays();
		return;
	}
	const revealedCards = new Set(revealDecision.codes);
	setPlayerVisibleHoleCards(
		player,
		player.holeCards.map((cardCode) => revealedCards.has(cardCode)),
	);
	hidePlayerQr(player);
	updateHandStrengthDisplays();
}

function getLuckyWinnerReactionGap(player, showdownPlayers = []) {
	const playerSnapshot = player?.lastNonFinalWinProbability;
	if (typeof playerSnapshot !== "number" || !Array.isArray(showdownPlayers)) {
		return null;
	}

	let hasOtherSnapshot = false;
	let highestSnapshot = playerSnapshot;
	showdownPlayers.forEach((showdownPlayer) => {
		if (showdownPlayer === player) {
			return;
		}
		const showdownSnapshot = showdownPlayer?.lastNonFinalWinProbability;
		if (typeof showdownSnapshot !== "number") {
			return;
		}
		hasOtherSnapshot = true;
		if (showdownSnapshot > highestSnapshot) {
			highestSnapshot = showdownSnapshot;
		}
	});

	if (!hasOtherSnapshot || playerSnapshot === highestSnapshot) {
		return null;
	}

	return highestSnapshot - playerSnapshot;
}

function getWinnerReactionEmoji(player, context) {
	if (context.revealedPlayers.has(player)) {
		return getRandomItem(WINNER_REACTION_EMOJIS.reveal);
	}

	if (context.activePlayerCount === 1) {
		return getRandomItem(WINNER_REACTION_EMOJIS.uncontested);
	}

	if (context.mainPotWinnerCount > 1) {
		return getRandomItem(WINNER_REACTION_EMOJIS.split);
	}

	if (context.hadShowdown) {
		const luckyGap = getLuckyWinnerReactionGap(
			player,
			context.showdownPlayers,
		);
		if (
			luckyGap !== null &&
			luckyGap >= WINNER_REACTION_LUCKY_MIN_GAP
		) {
			return getRandomItem(WINNER_REACTION_EMOJIS.lucky);
		}
	}

	const totalPayout = context.totalPayout;
	const stackBeforePayout = context.stackBeforePayout;
	const stackAfterPayout = stackBeforePayout + totalPayout;
	if (
		stackBeforePayout <= 6 * context.bigBlind &&
		stackAfterPayout >= 12 * context.bigBlind &&
		stackAfterPayout >= stackBeforePayout * 3
	) {
		return getRandomItem(WINNER_REACTION_EMOJIS.comeback);
	}

	if (context.hadShowdown) {
		const solvedHand = getVisibleSolvedHand(player, context.communityCards);
		if (solvedHand) {
			if (
				solvedHand.descr === "Royal Flush" ||
				WINNER_REACTION_MONSTER_HANDS.has(solvedHand.name)
			) {
				return getRandomItem(WINNER_REACTION_EMOJIS.monsterHand);
			}
			if (WINNER_REACTION_STRONG_HANDS.has(solvedHand.name)) {
				return getRandomItem(WINNER_REACTION_EMOJIS.strongHand);
			}
		}
	}

	if (totalPayout >= Math.max(12 * context.bigBlind, stackBeforePayout)) {
		return getRandomItem(WINNER_REACTION_EMOJIS.bigPot);
	}

	return getRandomItem(WINNER_REACTION_EMOJIS.fallback);
}

function triggerMainPotWinnerReactions(context) {
	if (isFastPlaybackActive() || context.mainPotWinners.length === 0) {
		return;
	}

	context.mainPotWinners.forEach((player) => {
		const totalPayout = context.totalPayoutByPlayer.get(player) || 0;
		if (totalPayout <= 0) {
			return;
		}
		const emoji = getWinnerReactionEmoji(player, {
			...context,
			totalPayout,
			stackBeforePayout: player.chips,
		});
		const visibleUntil = Date.now() + WINNER_REACTION_DURATION;
		player.winnerReactionEmoji = emoji;
		player.winnerReactionUntil = visibleUntil;
		showPlayerWinnerReaction(player, emoji, visibleUntil);
		queueStateSync(0);
	});
}

function updateHandStrengthDisplays() {
	const communityCards = getCommunityCardCodes();
	gameState.players.forEach((player) => renderPlayerSeat(player, communityCards));
}

function updateWinProbabilityDisplays() {
	const communityCards = getCommunityCardCodes();
	gameState.players.forEach((player) => renderPlayerSeat(player, communityCards));
}

function computeSpectatorWinProbabilities(reason = "") {
	if (
		!gameState.spectatorMode &&
		!isAllInRunout(gameState.players, gameState.currentBet)
	) {
		return;
	}
	if (gameState.currentPhaseIndex === 0) {
		logFlow("winProbability: preflop skipped", { reason });
		updateWinProbabilityDisplays();
		return;
	}

	const communityCards = getCommunityCardCodes();
	const missingCount = 5 - communityCards.length;
	if (missingCount < 0) {
		logFlow("winProbability: invalid board state", {
			communityCards,
			missingCount,
		});
		return;
	}

	const activePlayers = gameState.players.filter((p) => !p.folded);
	if (activePlayers.length === 0) {
		updateWinProbabilityDisplays();
		return;
	}

	gameState.players.forEach((p) => {
		p.winProbability = p.folded ? 0 : null;
	});
	const result = calculateWinProbabilities(
		gameState.players,
		communityCards,
		gameState.deck,
	);

	if (result.status === "invalid_board") {
		logFlow("winProbability: invalid board state", {
			communityCards,
			missingCount,
		});
		return;
	}

	if (result.status === "no_players") {
		updateWinProbabilityDisplays();
		return;
	}

	if (result.status === "too_many_boards") {
		logFlow("winProbability: skipped heavy enumeration", {
			phase: getCurrentPhase(gameState.currentPhaseIndex),
			reason,
			missingCount,
			totalBoards: result.totalBoards,
			deckSize: gameState.deck.length,
		});
		updateWinProbabilityDisplays();
		return;
	}

	if (result.status === "no_boards") {
		logFlow("winProbability: no boards to evaluate", {
			deckSize: gameState.deck.length,
			missingCount,
		});
		updateWinProbabilityDisplays();
		return;
	}

	result.activePlayers.forEach((player) => {
		player.winProbability = result.probabilities.get(player) ?? null;
		if (missingCount > 0 && typeof player.winProbability === "number") {
			player.lastNonFinalWinProbability = player.winProbability;
		}
	});

	updateWinProbabilityDisplays();

	logFlow("winProbability", {
		phase: getCurrentPhase(gameState.currentPhaseIndex),
		reason,
		missingCount,
		totalBoards: result.totalBoards,
		boards: result.boardsSeen,
		players: result.activePlayers.map((player) => ({
			name: player.name,
			winProbability: Number(player.winProbability.toFixed(2)),
		})),
	});
}

/* --------------------------------------------------------------------------------------------------
Game Setup And Hand Lifecycle
---------------------------------------------------------------------------------------------------*/

function startGame() {
	if (!gameState.gameStarted) {
		resetRuntimeFastForward();
		totalHands = 0;
		gameState.handId = 0;
		gameState.nextDecisionId = 1;
		gameState.blindLevel = 0;
		gameState.smallBlind = INITIAL_SMALL_BLIND;
		gameState.bigBlind = INITIAL_BIG_BLIND;
		gameState.lastRaise = INITIAL_BIG_BLIND;
		gameState.handInProgress = false;
		createPlayers();
		hadHumansAtStart = gameState.players.some((p) => !p.isBot);
		currentGameSaveEligible = hasExactlyOneHumanPlayer(gameState.players);
		exitEventSent = false;

		if (gameState.players.length > 1) {
			seatRefs.forEach((seatRef) =>
				renderSeatSetupState(seatRef, {
					nameEditable: false,
					controlsVisible: false,
				})
			);
			startButton.classList.add("hidden");
			instructionsButton.classList.add("hidden");
			setTableSetupVisible(false);
			closeAllOverlays();
			gameState.gameStarted = true;
			initStateSyncForGame();
			renderJoinBanner();

			if (shouldWaitForPlayersToJoin()) {
				beginWaitingForPlayers();
			} else {
				preFlop();
			}
		} else {
			hadHumansAtStart = false;
			currentGameSaveEligible = false;
			seatRefs.forEach((seatRef) => {
				if (seatRef.nameEl.textContent === "") {
					renderSeatSetupState(seatRef, { visible: true });
				}
			});
			gameState.players = [];
			gameState.allPlayers = [];
			enqueueNotification("Not enough players");
		}
	} else {
		// New Round
		preFlop();
	}
}

/* --------------------------------------------------------------------------------------------------
Drawing for seats

People were seated in the order they were typed in, so they always ended up next to each other. The
dealer button does move every hand, but it moves by rotating the running order, which keeps everyone
in the same order relative to each other -- so two people at a six-handed table stayed neighbours for
the whole session, one of them always acting immediately after the other. Position is most of what
makes hold'em interesting, and that arrangement quietly removes the part of it worth learning.

Seats are therefore drawn at random each game, the way a real table does it.
---------------------------------------------------------------------------------------------------*/

function drawForSeats() {
	const visibleSeats = seatRefs.filter((seatRef) => !seatRef.seatEl.classList.contains("hidden"));
	const names = visibleSeats
		.map((seatRef) => seatRef.nameEl.textContent.trim())
		.filter((name) => name !== "");

	// Fisher-Yates over the seats, then deal the names into them.
	const shuffledSeats = visibleSeats.slice();
	for (let i = shuffledSeats.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[shuffledSeats[i], shuffledSeats[j]] = [shuffledSeats[j], shuffledSeats[i]];
	}

	shuffledSeats.forEach((seatRef, index) => {
		// Anything past the last person is left blank, which is what makes a seat a bot.
		seatRef.nameEl.textContent = index < names.length ? names[index] : "";
	});
}

function createPlayers() {
	drawForSeats();
	gameState.players = [];
	gameState.allPlayers = [];
	let botIndex = 1;
	for (const seatRef of seatRefs) {
		seatRef.playerSeatIndex = null;
		seatRef.clearActionLabelState = null;
		seatRef.clearWinnerReactionState = null;
		if (seatRef.seatEl.classList.contains("hidden")) {
			continue;
		}
		if (seatRef.nameEl.textContent.trim() === "") {
			seatRef.nameEl.textContent = `Bot ${botIndex++}`;
			renderSeatSetupState(seatRef, { isBot: true });
		} else {
			renderSeatSetupState(seatRef, { isBot: false });
		}
	}

	const activeSeatRefs = seatRefs.filter((seatRef) => !seatRef.seatEl.classList.contains("hidden"));
	for (const seatRef of activeSeatRefs) {
		const seatIndex = gameState.players.length;
		const playerState = {
			name: seatRef.nameEl.textContent,
			isBot: seatRef.seatEl.classList.contains("bot"),
			seatSlot: seatRef.seatSlot,
			winnerReactionEmoji: "",
			winnerReactionUntil: 0,
			isWinner: false,
			actionState: null,
			winProbability: null,
			lastNonFinalWinProbability: null,
			seatIndex,
			holeCards: [null, null],
			visibleHoleCards: [false, false],
			dealer: false,
			smallBlind: false,
			bigBlind: false,
			folded: false,
			chips: 2000,
			allIn: false,
			totalBet: 0,
			roundBet: 0,
			stats: {
				hands: 0,
				handsWon: 0,
				vpip: 0,
				pfr: 0,
				calls: 0,
				aggressiveActs: 0,
				reveals: 0,
				showdowns: 0,
				showdownsWon: 0,
				folds: 0,
				foldsPreflop: 0,
				foldsPostflop: 0,
				allins: 0,
			},
			botLine: {
				preflopAggressor: false,
				cbetIntent: null,
				barrelIntent: null,
				cbetMade: false,
				barrelMade: false,
				nonValueAggressionMade: false,
				checkRaiseIntent: null,
				passiveValueCheckIntent: null,
			},
			spotState: createPlayerSpotState(),
		};
		bindSeatRefPlayer(playerState);
		gameState.players.push(playerState);
	}
	renderPlayerChipStacks();
	gameState.players.forEach((player) => {
		renderPlayerTotal(player);
		resetPlayerRoundBet(player);
		renderPlayerHoleCards(player);
	});
	gameState.allPlayers = gameState.players.slice();
}

function setDealer() {
	const dealerPlan = advanceDealer(gameState.players);
	if (!dealerPlan) {
		return;
	}
	applyPlayerPatches(dealerPlan.playerPatches);
	gameState.players = dealerPlan.players;
	if (dealerPlan.previousDealer) {
		renderPlayerSeat(dealerPlan.previousDealer);
	}
	renderPlayerSeat(dealerPlan.dealer);

	enqueueNotification(`${gameState.players[0].name} is Dealer.`);
}

function updateBlindLevelForCurrentHand() {
	const blindLevelUpdate = getBlindLevelUpdateForHand(totalHands, gameState);
	if (!blindLevelUpdate) {
		return;
	}

	applyGameStatePatch(blindLevelUpdate.gameStatePatch);
	if (blindLevelUpdate.blindsChanged) {
		enqueueNotification(
			`Blinds are now ${formatMoney(gameState.smallBlind)}/${formatMoney(gameState.bigBlind)}.`,
		);
	}
}

function setBlinds() {
	updateBlindLevelForCurrentHand();

	const blindPlan = postBlinds(gameState);
	applyPlayerPatches(blindPlan.playerPatches);
	applyGameStatePatch(blindPlan.gameStatePatch);
	blindPlan.playerPatches.forEach(({ player }) => {
		renderPlayerSeat(player);
	});
	renderPot();

	enqueueNotification(
		`${blindPlan.smallBlindPlayer.name} posted small blind of ${formatMoney(blindPlan.smallBlindAmount)}.`,
	);
	enqueueNotification(
		`${blindPlan.bigBlindPlayer.name} posted big blind of ${formatMoney(blindPlan.bigBlindAmount)}.`,
	);
}

function dealCards() {
	const dealPlan = dealHoleCardsForNewHand(gameState);
	applyPlayerPatches(dealPlan.playerPatches);
	applyGameStatePatch(dealPlan.gameStatePatch);

	dealPlan.dealtPlayers.forEach(({ player, card1, card2 }) => {
		renderPlayerHoleCards(player);
		if (!player.isBot) {
			if (gameState.openCardsMode) {
				hidePlayerQr(player);
			} else {
				showPlayerQr(player, card1, card2);
			}
		} else {
			hidePlayerQr(player);
		}
	});
}

// Execute the standard pre-flop steps: rotate dealer, post blinds, deal cards, start betting.
function preFlop() {
	// --- Hand Start And Reset ---------------------------------------------------
	setCurrentFlowState({ type: "hand-start" });
	clearNewRoundCountdown({ notify: false });
	// Analytics: count hands and mark start time
	totalHands++;
	if (runoutPhaseTimer) {
		clearTimeout(runoutPhaseTimer);
		runoutPhaseTimer = null;
	}
	clearChipTransferFinishTimer();
	clearChipTransferAnimation(tableRenderTarget);

	startButton.classList.add("hidden");
	closeAllOverlays();
	setSummaryButtonsVisible(false);
	clearActionLabels();
	clearActiveTurnPlayer(false);

	const nextHandPlan = createNextHandTransitionPlan(gameState, totalHands);
	applyPlayerPatches(nextHandPlan.playerPatches);
	applyGameStatePatch(nextHandPlan.gameStatePatch);

	nextHandPlan.playerPatches.forEach(({ player }) => {
		clearPlayerWinnerReaction(player);
		renderPlayerSeat(player);
		renderPlayerHoleCards(player);
		hidePlayerQr(player);
	});
	setCommunityCards(gameState.communityCards);

	nextHandPlan.bustedPlayers.forEach((player) => {
		renderSeatSetupState(getSeatRef(player), { visible: false });
		enqueueNotification(`${player.name} is out of the game!`);
		logFlow("player_bust", { name: player.name });
		logSpeedmodeEvent("player_bust", {
			handId: gameState.handId,
			player: player.name,
			seatIndex: player.seatIndex,
		});
	});

	updateWinProbabilityDisplays();
	updateHandStrengthDisplays();

	// --- Game Over Check ---------------------------------------------------------
	// GAME OVER: only one player left at the table
	if (nextHandPlan.type === "game-over") {
		const champion = nextHandPlan.champion;
		clearActiveTurnPlayer(false);
		enqueueNotification(`${champion.name} wins the game! 🏆`);
		// Reveal champion's stack
		renderPlayerTotal(champion);
		renderPlayerSeat(champion);
		logFlow("tournament_end", { champion: champion.name });
		clearPendingAction();
		humanTurnController.hide();
		resetRuntimeFastForward();
		if (!SPEED_MODE) {
			globalThis.umami?.track("Poker", {
				champion: champion.name,
				botWon: champion.isBot,
				handsPlayed: getHandsPlayedBucket(totalHands),
				finished: true,
			});
			renderStatsOverlay();
			setSummaryButtonsVisible(true);
		}
		if (currentGameSaveEligible) {
			removeSavedGameSnapshot();
		}
		queueStateSync(0);
		return; // skip the rest of preFlop()
	}
	// ----------------------------------------------------------

	// --- Dealer, Blinds, Deal, And First Round ----------------------------------
	updateFastForwardButton();

	// Assign dealer
	setDealer();

	// post blinds
	setBlinds();
	const handStartPlayers = buildSpeedmodeHandStartPlayers(gameState.players);

	// Shuffle and deal new hole cards
	dealCards();
	if (totalHands === 1 && !SPEED_MODE) {
		globalThis.umami?.track("Poker", {
			players: gameState.players.length,
			bots: gameState.players.filter((p) => p.isBot).length,
			humans: gameState.players.filter((p) => !p.isBot).length,
		});
	}
	logSpeedmodeEvent("hand_start", {
		handId: gameState.handId,
		blindLevel: gameState.blindLevel,
		smallBlind: gameState.smallBlind,
		bigBlind: gameState.bigBlind,
		dealerSeatIndex: gameState.players.find((player) => player.dealer)?.seatIndex ?? null,
		communityCards: [],
		players: handStartPlayers,
	});

	// Start first betting round (preflop)
	queueStateSync();
	startBettingRound();
}

function dealCommunityCards(amount) {
	const dealPlan = dealCommunityCardsForPhase(
		gameState,
		amount,
		communityCardSlots.length,
	);
	if (!dealPlan) {
		console.warn("Not enough empty slots for", amount);
		logFlow("dealCommunityCards: not enough slots");
		return;
	}
	applyGameStatePatch(dealPlan.gameStatePatch);
	renderTableCommunityCards(communityCardSlots, gameState.communityCards);
	updateHandStrengthDisplays();
	if (
		gameState.spectatorMode ||
		isAllInRunout(gameState.players, gameState.currentBet)
	) {
		computeSpectatorWinProbabilities("dealCommunityCards");
	}
}

function setPhase() {
	logFlow("setPhase", {
		phase: getCurrentPhase(gameState.currentPhaseIndex),
	});
	const phasePlan = getNextPhasePlan(gameState);
	if (phasePlan.botIntentResetReason) {
		clearBotCheckRaiseIntents(phasePlan.botIntentResetReason);
		clearBotPassiveValueCheckIntents(phasePlan.botIntentResetReason);
	}
	if (phasePlan.reason === "onlyActivePlayer") {
		return doShowdown();
	}

	applyGameStatePatch(phasePlan.gameStatePatch);
	applyHandContextPatch(phasePlan.handContextPatch);

	switch (phasePlan.phase) {
		case "flop":
			dealCommunityCards(phasePlan.cardsToDeal);
			enqueueNotification("Flop (3 cards) dealt.");
			startBettingRound();
			break;
		case "turn":
			dealCommunityCards(phasePlan.cardsToDeal);
			enqueueNotification("Turn (4th card) dealt.");
			startBettingRound();
			break;
		case "river":
			dealCommunityCards(phasePlan.cardsToDeal);
			enqueueNotification("River (5th card) dealt.");
			startBettingRound();
			break;
		case "showdown":
			doShowdown();
			break;
	}
	queueStateSync();
}

function queueRunoutPhaseAdvance(reason = "") {
	humanTurnController.hide();
	setCurrentFlowState({
		type: "runout",
		reason,
		phaseIndex: gameState.currentPhaseIndex,
	});
	const runoutPhaseDelay = getRunoutPhaseDelay();
	if (
		!isAllInRunout(gameState.players, gameState.currentBet) ||
		runoutPhaseDelay === 0
	) {
		saveCurrentGameSnapshot();
		return setPhase();
	}
	if (runoutPhaseTimer) {
		return;
	}
	logFlow("delay runout phase", {
		reason,
		phase: getCurrentPhase(gameState.currentPhaseIndex),
		delay: runoutPhaseDelay,
	});
	runoutPhaseTimer = setTimeout(() => {
		runoutPhaseTimer = null;
		setPhase();
	}, runoutPhaseDelay);
	saveCurrentGameSnapshot();
}

/* --------------------------------------------------------------------------------------------------
Turn Handling And Betting Round Flow
---------------------------------------------------------------------------------------------------*/

function notifyPlayerAction(player, action = "", actionMeta = {}) {
	recordPlayerActionStats(gameState, player, action, actionMeta);

	// Patches are applied before this runs, so roundBet is already the new total.
	const msg = getPlayerActionNotificationText(player.name, action, player.roundBet);
	if (action) {
		setPlayerActionState(
			player,
			action,
			Date.now() + getActionLabelDuration(),
		);
	} else {
		clearPlayerActionState(player);
	}

	renderPlayerResolvedAction(player);

	const followUpEffects = getPlayerActionFollowUpEffects(
		gameState,
		player,
		action,
	);
	if (followUpEffects.clearWinProbability) {
		player.winProbability = 0;
	}
	if (followUpEffects.revealActiveHoleCards) {
		revealActiveHoleCards();
	} else if (followUpEffects.refreshHandStrength) {
		updateHandStrengthDisplays();
	}
	if (followUpEffects.recomputeSpectatorWinProbabilities) {
		computeSpectatorWinProbabilities(followUpEffects.probabilityReason);
	} else if (followUpEffects.skipProbabilityLogReason) {
		logSkippedPlayerActionProbability(
			player,
			action,
			followUpEffects.skipProbabilityLogReason,
		);
	}
	queueStateSync(0);
	updateFastForwardButton();
	enqueueNotification(msg);
}

function setActiveTurnPlayer(player) {
	const previousActiveSeatIndex = gameState.activeSeatIndex;
	gameState.activeSeatIndex = player.seatIndex;
	renderSeatActiveStates(seatRefs, gameState.activeSeatIndex);
	if (previousActiveSeatIndex !== player.seatIndex) {
		queueStateSync(0);
	}
}

function clearActiveTurnPlayer(sync = true) {
	renderSeatActiveStates(seatRefs, null);
	if (gameState.activeSeatIndex === null) {
		return;
	}
	gameState.activeSeatIndex = null;
	if (sync) {
		queueStateSync(0);
	}
}

function continueAfterResolvedTurn({
	player,
	cycles,
	nextPlayer,
	logPrefix,
	advanceReason,
}) {
	const continuation = getResolvedTurnContinuation(gameState, cycles);
	if (continuation.type === "next") {
		logFlow(`${logPrefix} next`, { name: player.name });
		nextPlayer();
	} else if (continuation.type === "wait") {
		logFlow(`${logPrefix} wait`, { name: player.name });
		nextPlayer();
	} else {
		clearActiveTurnPlayer(false);
		logFlow(`${logPrefix} advance`, { name: player.name });
		queueRunoutPhaseAdvance(advanceReason);
	}
}

function getResolvedTurnMeta(resolvedAction) {
	if (resolvedAction?.action === "fold") {
		return {
			logPrefix: "fold",
			advanceReason: "fold",
		};
	}
	if (resolvedAction?.action === "allin") {
		return {
			logPrefix: "human",
			advanceReason: "human-allin",
		};
	}
	return {
		logPrefix: "human",
		advanceReason: "human",
	};
}

function applyResolvedTurnActionPatches(player, resolvedAction) {
	Object.assign(player, resolvedAction.playerPatch);
	Object.assign(gameState, resolvedAction.gameStatePatch);

	if (Object.keys(resolvedAction.playerPatch).length > 0) {
		renderPlayerSeat(player);
	}
	if (
		Object.prototype.hasOwnProperty.call(
			resolvedAction.gameStatePatch,
			"pot",
		)
	) {
		renderPot();
	}
}

function applyTurnAction(player, actionRequest) {
	const resolvedAction = resolveTurnAction(gameState, player, actionRequest);
	if (!resolvedAction) {
		return null;
	}

	applyResolvedTurnActionPatches(player, resolvedAction);
	notifyPlayerAction(
		player,
		resolvedAction.action,
		resolvedAction.actionMeta,
	);
	if (resolvedAction.action === "fold") {
		hidePlayerQr(player);
	}
	return resolvedAction;
}

function runBotTurn({ player, cycles, nextPlayer }) {
	setActiveTurnPlayer(player);
	humanTurnController.hide();
	clearPlayerActionLabel(player);
	clearSeatActionVisualState(getSeatRef(player));

	// Snapshot before the bot commits to a line, so a reload mid-pause replays the turn cleanly.
	saveCurrentGameSnapshot();
	// Decide now and pause afterwards, rather than pausing and then deciding. How long the pause
	// runs depends on what was decided, which is what stops the table feeling metronomic.
	const decision = chooseBotAction(player, gameState);
	const actionRequest = normalizeBotActionRequest(decision);

	enqueueBotAction(() => {
		let resolvedAction = applyTurnAction(player, actionRequest);
		if (!resolvedAction) {
			logFlow("bot action fallback", {
				name: player.name,
				decision: decision?.action ?? null,
			});
			const fallbackActionState = getPlayerActionState(gameState, player);
			resolvedAction = applyTurnAction(
				player,
				fallbackActionState.canCheck ? { action: "check" } : { action: "fold" },
			);
		}
		continueAfterResolvedTurn({
			player,
			cycles,
			nextPlayer,
			logPrefix: "bot",
			advanceReason: "bot",
		});
	}, pickBotThinkingTime(actionRequest));
}

function startBettingRound(options = {}) {
	// --- Round Reset -------------------------------------------------------------
	const shouldResetRound = options.resetRound !== false;
	if (shouldResetRound) {
		const roundStartPlan = createBettingRoundStartPlan(gameState);
		if (roundStartPlan.botIntentResetReason) {
			clearBotCheckRaiseIntents(roundStartPlan.botIntentResetReason);
			clearBotPassiveValueCheckIntents(roundStartPlan.botIntentResetReason);
		}
		applyPlayerPatches(roundStartPlan.playerPatches);
		applyGameStatePatch(roundStartPlan.gameStatePatch);
		applyHandContextPatch(roundStartPlan.handContextPatch);
		roundStartPlan.playerPatches.forEach(({ player, patch }) => {
			if ("roundBet" in patch) {
				renderPlayerSeat(player);
			}
		});
	}
	logFlow("startBettingRound", {
		phase: getCurrentPhase(gameState.currentPhaseIndex),
		currentBet: gameState.currentBet,
		lastRaise: gameState.lastRaise,
		order: gameState.players.map((p) => p.name),
		resume: !shouldResetRound,
	});
	// Clear action indicators from the previous betting round
	clearActiveTurnPlayer(false);
	if (shouldResetRound) {
		gameState.players.forEach((player) => {
			clearSeatActionVisualState(getSeatRef(player), { preserveAllIn: true });
		});
	}
	clearPendingAction();

	const startExit = getBettingRoundStartExit(gameState);
	if (startExit) {
		logFlow("skip betting round", {
			active: startExit.activePlayerCount,
			actionable: startExit.actionablePlayerCount,
		});
		clearActiveTurnPlayer(false);
		clearPendingAction();
		return queueRunoutPhaseAdvance(startExit.reason);
	}

	let progressState = normalizeSavedProgressState(options.progressState) ||
		createBettingRoundProgressState(gameState);
	const loggedStartPlayer = gameState.players.length > 0
		? gameState.players[progressState.nextIndex % gameState.players.length]
		: null;

	logFlow("betting start index", {
		index: progressState.nextIndex,
		player: loggedStartPlayer?.name ?? null,
	});

	// --- Turn Loop ----------------------------------------------------------------
	function nextPlayer() {
		const step = getNextBettingRoundStep(gameState, progressState);
		if (step.progressState) {
			progressState = step.progressState;
		}

		if (step.type === "advance" && step.reason === "nextPlayer") {
			logFlow("no actionable players, advance phase (nextPlayer)", {
				active: step.activePlayers.map((p) => ({
					name: p.name,
					allIn: p.allIn,
					roundBet: p.roundBet,
				})),
			});
			clearActiveTurnPlayer(false);
			clearPendingAction();
			return queueRunoutPhaseAdvance("nextPlayer");
		}

		logFlow(
			"nextPlayer",
			{
				index: step.index,
				cycles: step.previousCycles,
				name: step.player.name,
				folded: step.player.folded,
				allIn: step.player.allIn,
				roundBet: step.player.roundBet,
			},
		);

		if (step.reason === "foldedAllIn") {
			logFlow("skip folded/allin", { name: step.player.name });
			return setTimeout(nextPlayer, 0); // avoid recursive stack growth
		}

		if (step.reason === "waitUncalled") {
			logFlow("already matched bet", {
				name: step.player.name,
				cycles: step.cycles,
			});
			logFlow("wait uncalled", { name: step.player.name });
			return setTimeout(nextPlayer, 0); // schedule asynchronously to break call chain
		}

		if (step.type === "advance") {
			logFlow("already matched bet", {
				name: step.player.name,
				cycles: step.cycles,
			});
			logFlow("advance phase", { name: step.player.name });
			clearActiveTurnPlayer(false);
			clearPendingAction();
			return queueRunoutPhaseAdvance(step.reason);
		}

		if (step.reason === "firstPassMatched") {
			logFlow("already matched bet", {
				name: step.player.name,
				cycles: step.cycles,
			});
		}

		return runTurn(step.player, step.cycles, nextPlayer);
	}

	function runTurn(player, cycles, nextPlayer) {
		setCurrentFlowState(
			createActiveTurnFlowState(player, cycles, progressState),
		);

		// --- Bot Branch --------------------------------------------------------------
		// If this is a bot, choose an action based on hand strength
		if (player.isBot) {
			// runBotTurn snapshots itself, before the bot decides.
			runBotTurn({
				player,
				cycles,
				nextPlayer,
			});
			return;
		}

		// --- Human Branch ------------------------------------------------------------
		humanTurnController.runHumanTurn({
			player,
			cycles,
			nextPlayer,
		});
		saveCurrentGameSnapshot();
	}

	const resumeTurn = options.resumeTurn;
	if (
		resumeTurn &&
		Number.isFinite(resumeTurn.seatIndex) &&
		Number.isFinite(resumeTurn.cycles)
	) {
		const resumePlayer = gameState.players.find((player) => player.seatIndex === resumeTurn.seatIndex);
		if (resumePlayer && !resumePlayer.folded && !resumePlayer.allIn) {
			runTurn(resumePlayer, resumeTurn.cycles, nextPlayer);
			return;
		}
	}

	nextPlayer();
}

/* --------------------------------------------------------------------------------------------------
Showdown And Payout Flow
---------------------------------------------------------------------------------------------------*/

// Build the synchronized payout transfer plan and let the shared table-view renderer
// animate the visible pot and stack counts from the final canonical state.
function getChipTransferStepCount() {
	if (isTurboPlaybackActive()) {
		return FAST_FORWARD_CHIP_TRANSFER_STEPS;
	}
	return DEFAULT_CHIP_TRANSFER_STEPS;
}

function getChipTransferDurationMs(amount) {
	if (isTurboPlaybackActive()) {
		return FAST_FORWARD_CHIP_TRANSFER_DURATION;
	}
	return Math.min(Math.max(amount * 20, 300), 3000);
}

function buildChipTransferState(transferQueue) {
	if (
		SPEED_MODE ||
		!Array.isArray(transferQueue) ||
		transferQueue.length === 0
	) {
		return null;
	}

	const startedAt = Date.now();
	return {
		id: nextChipTransferId++,
		startedAt,
		transfers: transferQueue.map((transfer) => ({
			seatIndex: transfer.player.seatIndex,
			amount: transfer.amount,
			durationMs: getChipTransferDurationMs(transfer.amount),
			stepCount: getChipTransferStepCount(),
		})),
	};
}

function applyChipTransferResults(commitPlan) {
	applyPlayerPatches(commitPlan.payoutPlayerPatches);
	applyGameStatePatch(commitPlan.payoutGameStatePatch);
}

function getChipTransferRemainingDuration(chipTransfer) {
	if (
		!chipTransfer || !Array.isArray(chipTransfer.transfers) ||
		chipTransfer.transfers.length === 0
	) {
		return 0;
	}

	const endAt = chipTransfer.transfers.reduce(
		(maxEndAt, transfer) => Math.max(maxEndAt, chipTransfer.startedAt + transfer.durationMs),
		chipTransfer.startedAt,
	);
	return Math.max(0, Math.ceil(endAt - Date.now()));
}

function startChipTransferAnimation(commitPlan, onDone) {
	const transferQueue = commitPlan.transferQueue;
	if (!Array.isArray(transferQueue) || transferQueue.length === 0) {
		if (onDone) {
			onDone();
		}
		return;
	}

	clearChipTransferFinishTimer();
	clearChipTransferAnimation(tableRenderTarget);

	const chipTransfer = buildChipTransferState(transferQueue);
	gameState.chipTransfer = chipTransfer;
	applyChipTransferResults(commitPlan);

	if (!chipTransfer) {
		if (onDone) {
			onDone();
		}
		return;
	}

	renderChipTransferAnimation(tableRenderTarget, {
		finalPot: gameState.pot,
		players: getPlayerSeatRenderData(gameState.players),
		chipTransfer,
	});
	setCurrentFlowState({ type: "chip-transfer" });
	queueStateSync(0);
	saveCurrentGameSnapshot();

	chipTransferFinishTimer = setTimeout(() => {
		chipTransferFinishTimer = null;
		gameState.chipTransfer = null;
		clearChipTransferAnimation(tableRenderTarget);
		queueStateSync(0);
		if (onDone) {
			onDone();
		}
	}, getChipTransferRemainingDuration(chipTransfer));
}

function finishHandAfterShowdown() {
	const handEndPlan = createHandEndPlan(gameState);
	renderPlayerChipStacks();

	clearActiveTurnPlayer(false);
	applyGameStatePatch(handEndPlan.gameStatePatch);
	renderPot();

	humanTurnController.hide();
	if (SPEED_MODE) {
		queueStateSync();
		preFlop();
		return;
	}
	if (autoplayToGameEnd) {
		queueStateSync();
		preFlop();
		return;
	}
	if (handFastForwardActive && getHumansWithChipsCount() === 0) {
		handFastForwardActive = false;
		autoplayToGameEnd = true;
		syncRuntimePlayback();
		updateFastForwardButton();
		queueStateSync();
		preFlop();
		return;
	}
	handFastForwardActive = false;
	syncRuntimePlayback();
	updateFastForwardButton();
	renderStatsOverlay();
	setSummaryButtonsVisible(true);
	setStartButtonLabel("New Round");
	startButton.classList.remove("hidden");
	setCurrentFlowState({ type: "between-hands" });
	startNewRoundCountdown();
	queueStateSync();
	saveCurrentGameSnapshot();
}

function doShowdown() {
	// --- Active Players And Showdown State ---------------------------------------
	const communityCards = getCommunityCardCodes();
	const showdownResult = resolveShowdown(
		gameState.players,
		communityCards,
		CHIP_UNIT,
	);
	const {
		activePlayers,
		contributors,
		hadShowdown,
		uncontestedWinner,
		mainPotWinners,
		winningPlayers,
		potResults,
		totalPayoutByPlayer,
		totalPot,
	} = showdownResult;
	const commitPlan = createShowdownCommitPlan(gameState, showdownResult);
	logSpeedmodeEvent("hand_result", {
		handId: gameState.handId,
		communityCards: communityCards.slice(),
		hadShowdown,
		uncontestedWinner: uncontestedWinner?.name ?? null,
		uncontestedWinnerSeatIndex: uncontestedWinner?.seatIndex ?? null,
		mainPotWinners: mainPotWinners.map((player) => player.name),
		mainPotWinnerSeatIndexes: mainPotWinners.map((player) => player.seatIndex),
		winningPlayers: winningPlayers.map((player) => player.name),
		winningSeatIndexes: winningPlayers.map((player) => player.seatIndex),
		potResults: potResults.map((result) => ({ ...result })),
		totalPayoutByPlayer: buildSpeedmodePayoutByPlayer(totalPayoutByPlayer),
		totalPayoutBySeatIndex: buildSpeedmodePayoutBySeatIndex(
			totalPayoutByPlayer,
		),
		totalBetByPlayer: buildSpeedmodeTotalBetByPlayer(contributors),
		totalBetBySeatIndex: buildSpeedmodeTotalBetBySeatIndex(contributors),
		totalPot,
	});

	applyPlayerPatches(commitPlan.playerPatches);
	commitPlan.playerPatches.forEach(({ player }) => {
		renderPlayerSeat(player);
	});
	commitPlan.revealPlayers.forEach((player) => {
		hidePlayerQr(player);
	});
	if (commitPlan.revealPlayers.length > 0) {
		updateHandStrengthDisplays();
	}
	commitPlan.mainPotWinners.forEach((player) => {
		renderSeatActiveState(getSeatRef(player), false);
	});

	if (uncontestedWinner) {
		const revealedPlayers = new Set();
		const revealDecision = getBotRevealDecision(
			uncontestedWinner,
			communityCards,
		);
		if (revealDecision) {
			revealedPlayers.add(uncontestedWinner);
			applyBotReveal(uncontestedWinner, revealDecision);
			registerBotReveal(uncontestedWinner);
			enqueueNotification(
				`${uncontestedWinner.name} reveals ${revealDecision.codes.map(formatCardLabel).join(" ")}`,
			);
		} else {
			hidePlayerQr(uncontestedWinner);
		}
		triggerMainPotWinnerReactions({
			activePlayerCount: activePlayers.length,
			bigBlind: gameState.bigBlind,
			communityCards,
			contributors,
			hadShowdown,
			mainPotWinnerCount: mainPotWinners.length,
			mainPotWinners,
			revealedPlayers,
			showdownPlayers: activePlayers,
			totalPayoutByPlayer,
		});
		enqueueNotification(`${uncontestedWinner.name} wins ${formatMoney(totalPot)}!`);
		startChipTransferAnimation(commitPlan, () => {
			finishHandAfterShowdown();
		});
		return;
	}

	// Skip pure refund-only side pots in the log. They animate correctly, but they are not real wins.
	const filteredResults = potResults.filter((result) => result.isRefundOnly !== true);

	// --- Notification Consolidation ----------------------------------------------
	// Consolidate notifications: if same player wins all pots, combine amounts
	if (filteredResults.length > 0) {
		const allSame = filteredResults.every((r) =>
			r.players.length === 1 &&
			r.players[0] === filteredResults[0].players[0]
		);
		if (allSame) {
			const total = filteredResults.reduce((sum, r) => sum + r.amount, 0);
			let msg = `${filteredResults[0].players[0]} wins ${formatMoney(total)}`;
			if (filteredResults[0].hand) {
				msg += ` with ${filteredResults[0].hand}`;
			}
			enqueueNotification(msg);
		} else {
			filteredResults.forEach((r) => {
				if (r.players.length === 1) {
					let msg = `${r.players[0]} wins ${formatMoney(r.amount)}`;
					if (r.hand) msg += ` with ${r.hand}`;
					enqueueNotification(msg);
				} else {
					enqueueNotification(
						`${r.players.join(" & ")} split ${formatMoney(r.amount)}`,
					);
				}
			});
		}
	}

	triggerMainPotWinnerReactions({
		activePlayerCount: activePlayers.length,
		bigBlind: gameState.bigBlind,
		communityCards,
		contributors,
		hadShowdown,
		mainPotWinnerCount: mainPotWinners.length,
		mainPotWinners,
		revealedPlayers: new Set(),
		showdownPlayers: activePlayers,
		totalPayoutByPlayer,
	});

	// --- Payout Animation --------------------------------------------------------
	// Build one synced transfer plan and let host and remote play the same animation locally.
	startChipTransferAnimation(commitPlan, () => {
		finishHandAfterShowdown();
	});
	return; // exit doShowdown early because UI flow continues in animation
}

/* --------------------------------------------------------------------------------------------------
Seat-Editing Helpers
---------------------------------------------------------------------------------------------------*/

/* --------------------------------------------------------------------------------------------------
Table Setup

Who is playing was decided entirely by which seats had a name typed into them -- blank meant bot --
with nothing on screen to say so, and nothing to warn that picking two people hides everybody's cards
until each of them joins on their own phone. This panel makes both explicit.

The seats stay the source of truth: these controls just add and clear names, so typing directly on a
seat still works and the counts follow along.
---------------------------------------------------------------------------------------------------*/

const MIN_TABLE_SEATS = 2;
const DEFAULT_PLAYER_NAMES = ["Player 1", "Player 2", "Player 3", "Player 4", "Player 5", "Player 6"];

function getVisibleSetupSeats() {
	return seatRefs.filter((seatRef) => !seatRef.seatEl.classList.contains("hidden"));
}

function getSeatName(seatRef) {
	return seatRef.nameEl.textContent.trim();
}

function readTableSetup() {
	const visibleSeats = getVisibleSetupSeats();
	const humanSeats = visibleSeats.filter((seatRef) => getSeatName(seatRef) !== "");
	return {
		visibleSeats,
		humanSeats,
		humans: humanSeats.length,
		bots: visibleSeats.length - humanSeats.length,
	};
}

function getSetupExplainerText({ humans, bots }) {
	if (humans + bots < MIN_TABLE_SEATS) {
		return "A table needs at least two players. Add a bot or a person.";
	}
	if (humans === 0) {
		return `Nobody is playing. The ${bots} bots play themselves with every hand face up, which ` +
			"is a decent way to watch how it goes.";
	}
	if (humans === 1) {
		return `You against ${bots} ${bots === 1 ? "bot" : "bots"}. Your cards show face up here and ` +
			"the bots play themselves. Nothing else to set up.";
	}
	if (!IS_SYNC_BACKEND_CONFIGURED) {
		return `With ${humans} people, nobody's cards appear on this screen. Each person is meant to ` +
			"see their own on their phone, and the server that does that has not been set up for " +
			"this copy yet. Until it is, choose 1 person.";
	}

	const base = `${humans} people and ${bots} ${bots === 1 ? "bot" : "bots"}. Cards stay off this ` +
		"shared screen — each person opens the join link on their own device to see their hand.";
	const serverText = getServerCheckText();
	return serverText ? `${base}\n${serverText}` : base;
}

/* --------------------------------------------------------------------------------------------------
Table server check

Choosing two or more people commits everyone to seeing their cards on their own device, which only
works if the server is up and willing to talk to this site. Both can be false with no visible symptom
beyond a game that never updates, so ask the server directly and say what came back.
---------------------------------------------------------------------------------------------------*/

// null = not asked yet. Otherwise { state, detail }.
let serverCheck = null;
let serverCheckInFlight = false;

function getOwnOrigin() {
	return globalThis.location.origin;
}

async function checkTableServer() {
	if (serverCheckInFlight || !IS_SYNC_BACKEND_CONFIGURED) {
		return;
	}

	serverCheckInFlight = true;
	serverCheck = { state: "checking" };
	refreshTableSetup();

	try {
		// Free hosting sleeps when idle and can take the best part of a minute to wake, which is not
		// a failure -- so wait properly rather than reporting a problem that is not there.
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 90_000);
		const res = await fetch(HEALTH_ENDPOINT, {
			cache: "no-store",
			signal: controller.signal,
		});
		clearTimeout(timeout);

		if (!res.ok) {
			serverCheck = { state: "error", detail: `The server answered with an error (${res.status}).` };
			return;
		}

		const payload = await res.json();
		const allowed = Array.isArray(payload?.allowedOrigins) ? payload.allowedOrigins : [];
		if (!allowed.includes(getOwnOrigin())) {
			serverCheck = {
				state: "origin",
				detail: `The server is running but does not allow this site (${getOwnOrigin()}). ` +
					`It allows: ${allowed.join(", ") || "nothing"}.`,
			};
			return;
		}

		serverCheck = { state: "ok" };
	} catch (error) {
		logFlow("table server check failed", error);
		serverCheck = {
			state: "unreachable",
			detail: "Could not reach the table server. Free hosting sleeps when idle, so if it has " +
				"not been used for a while, wait a minute and check again.",
		};
	} finally {
		serverCheckInFlight = false;
		refreshTableSetup();
	}
}

function getServerCheckText() {
	switch (serverCheck?.state) {
		case "checking":
			return "Checking the table server… this can take a minute if it has been asleep.";
		case "ok":
			return "Table server is ready.";
		case "origin":
		case "error":
		case "unreachable":
			return serverCheck.detail;
		default:
			return "";
	}
}

/* --------------------------------------------------------------------------------------------------
Names

Names live on the seats, where they always have -- typing on a seat still works. But once the People
and Bots counters started filling those seats in for you, "Player 1" stopped looking like something
you were meant to change, and there was nothing to say where to put real names. So the panel asks.
---------------------------------------------------------------------------------------------------*/

let renderedNameSeats = null;

function getUnusedDefaultName(takenNames) {
	return DEFAULT_PLAYER_NAMES.find((name) => !takenNames.has(name)) ?? "Player";
}

function handleSetupNameInput(event) {
	const seatRef = seatRefs[Number(event.currentTarget.dataset.seat)];
	if (seatRef) {
		seatRef.nameEl.textContent = event.currentTarget.value;
	}
}

function handleSetupNameBlur(event) {
	const input = event.currentTarget;
	const seatRef = seatRefs[Number(input.dataset.seat)];
	if (!seatRef) {
		return;
	}

	// An empty name is how a seat becomes a bot, which is not what clearing a name box means. The
	// People and Bots counters are for that, so put a name back rather than quietly losing a player.
	if (input.value.trim() === "") {
		const taken = new Set(readTableSetup().humanSeats.map(getSeatName));
		const fallback = getUnusedDefaultName(taken);
		seatRef.nameEl.textContent = fallback;
		input.value = fallback;
	}
	refreshTableSetup();
}

function renderSetupNames(humanSeats) {
	if (!setupNamesEl) {
		return;
	}

	const seatKey = humanSeats.map((seatRef) => seatRefs.indexOf(seatRef)).join(",");
	if (seatKey === renderedNameSeats) {
		// Same seats: just keep the values in step, leaving alone whichever box is being typed in.
		for (const input of setupNamesEl.querySelectorAll("input")) {
			const seatRef = seatRefs[Number(input.dataset.seat)];
			if (seatRef && input !== document.activeElement) {
				input.value = getSeatName(seatRef);
			}
		}
		return;
	}

	// Rebuilding would move focus out of a box mid-word.
	if (setupNamesEl.contains(document.activeElement)) {
		return;
	}

	renderedNameSeats = seatKey;
	setupNamesEl.replaceChildren();
	humanSeats.forEach((seatRef, index) => {
		const row = document.createElement("label");
		row.className = "setup-name-row";

		const label = document.createElement("span");
		label.className = "setup-name-label";
		label.textContent = `Person ${index + 1}`;

		const input = document.createElement("input");
		input.type = "text";
		input.className = "setup-name-input";
		input.maxLength = 20;
		input.autocomplete = "off";
		input.dataset.seat = `${seatRefs.indexOf(seatRef)}`;
		input.value = getSeatName(seatRef);
		input.addEventListener("input", handleSetupNameInput);
		input.addEventListener("blur", handleSetupNameBlur);

		row.append(label, input);
		setupNamesEl.appendChild(row);
	});
}

function refreshTableSetup() {
	if (!tableSetupEl || gameState.gameStarted) {
		return;
	}

	const setup = readTableSetup();
	humansCountEl.textContent = `${setup.humans}`;
	botsCountEl.textContent = `${setup.bots}`;
	renderSetupNames(setup.humanSeats);
	setupExplainerEl.textContent = getSetupExplainerText(setup);
	const serverProblem = serverCheck !== null && serverCheck.state !== "ok" &&
		serverCheck.state !== "checking";
	setupExplainerEl.classList.toggle(
		"setup-warning",
		setup.humans >= 2 && (!IS_SYNC_BACKEND_CONFIGURED || serverProblem),
	);

	// Ask the server as soon as the choice starts to depend on it, not at start time when it is too
	// late to do anything about the answer.
	if (setup.humans >= 2 && IS_SYNC_BACKEND_CONFIGURED && serverCheck === null) {
		checkTableServer();
	}

	const total = setup.visibleSeats.length;
	humansDecrementButton.disabled = setup.humans <= 0;
	humansIncrementButton.disabled = setup.humans >= seatRefs.length;
	botsDecrementButton.disabled = setup.bots <= 0;
	botsIncrementButton.disabled = total >= seatRefs.length;
	startButton.disabled = total < MIN_TABLE_SEATS;
}

// Bring a hidden seat back so a count can grow past the seats currently on the table.
function revealNextSeat() {
	const hiddenSeat = seatRefs.find((seatRef) => seatRef.seatEl.classList.contains("hidden"));
	if (!hiddenSeat) {
		return null;
	}
	renderSeatSetupState(hiddenSeat, { visible: true });
	return hiddenSeat;
}

function addHumanSeat() {
	const setup = readTableSetup();
	// Prefer turning an existing bot seat into a person, so the table size stays put.
	const botSeat = setup.visibleSeats.find((seatRef) => getSeatName(seatRef) === "") ??
		revealNextSeat();
	if (!botSeat) {
		return;
	}

	const taken = new Set(setup.humanSeats.map(getSeatName));
	botSeat.nameEl.textContent = DEFAULT_PLAYER_NAMES.find((name) => !taken.has(name)) ?? "Player";
	refreshTableSetup();
}

function removeHumanSeat() {
	const setup = readTableSetup();
	const lastHuman = setup.humanSeats[setup.humanSeats.length - 1];
	if (!lastHuman) {
		return;
	}
	// Clearing the name is what makes a seat a bot.
	lastHuman.nameEl.textContent = "";
	refreshTableSetup();
}

function addBotSeat() {
	const revealed = revealNextSeat();
	if (revealed) {
		revealed.nameEl.textContent = "";
	}
	refreshTableSetup();
}

function removeBotSeat() {
	const setup = readTableSetup();
	const lastBot = [...setup.visibleSeats].reverse().find((seatRef) => getSeatName(seatRef) === "");
	if (!lastBot) {
		return;
	}
	renderSeatSetupState(lastBot, { visible: false });
	refreshTableSetup();
}

function setTableSetupVisible(isVisible) {
	tableSetupEl?.classList.toggle("hidden", !isVisible);
}

function initTableSetup() {
	if (!tableSetupEl) {
		return;
	}

	humansIncrementButton.addEventListener("click", addHumanSeat);
	humansDecrementButton.addEventListener("click", removeHumanSeat);
	botsIncrementButton.addEventListener("click", addBotSeat);
	botsDecrementButton.addEventListener("click", removeBotSeat);
	// Typing a name straight onto a seat still works; the counts follow it.
	seatRefs.forEach((seatRef) => {
		seatRef.nameEl.addEventListener("input", refreshTableSetup);
		seatRef.nameEl.addEventListener("blur", refreshTableSetup);
	});

	// Open on the one combination that needs nothing else set up.
	const visibleSeats = getVisibleSetupSeats();
	if (visibleSeats.length > 0 && readTableSetup().humans === 0) {
		visibleSeats[0].nameEl.textContent = DEFAULT_PLAYER_NAMES[0];
	}
	refreshTableSetup();
}

function rotateSeat(ev) {
	const seatEl = ev.currentTarget.closest(".seat");
	const seatRef = seatRefs.find((currentSeatRef) => currentSeatRef.seatEl === seatEl);
	const rotation = Number.parseInt(seatEl?.dataset.rotation ?? "0", 10);
	renderSeatRotation(seatRef, rotation + 90);
}

function deletePlayer(ev) {
	const seatEl = ev.currentTarget.closest(".seat");
	const seatRef = seatRefs.find((currentSeatRef) => currentSeatRef.seatEl === seatEl);
	renderSeatSetupState(seatRef, { visible: false });
	refreshTableSetup();
}

/* --------------------------------------------------------------------------------------------------
App Bootstrap And Public API
---------------------------------------------------------------------------------------------------*/

function init() {
	initSound();
	initSoundButton(soundButton);

	// Prevent framing
	if (globalThis.top !== globalThis.self) {
		try {
			globalThis.top.location.href = globalThis.location.href;
		} catch {
			alert("No framing allowed. Please open this page directly.");
			throw new Error("No framing allowed. Open this page directly.");
		}
	}

	if (versionButton) {
		versionButton.textContent = `v${APP_VERSION}`;
	}

	document.addEventListener("touchstart", function () {}, false);
	document.addEventListener("keydown", (ev) => {
		if (ev.key === "Escape" && !isBlockingOverlayOpen()) {
			closeAllOverlays();
		}
	}, false);
	initTableSetup();
	startButton.addEventListener("click", startGame, false);
	newRoundCancelButton.addEventListener(
		"click",
		cancelNewRoundCountdown,
		false,
	);
	instructionsButton.addEventListener(
		"click",
		() => openOverlay("instructions"),
		false,
	);
	versionButton.addEventListener(
		"click",
		() => openOverlay("version"),
		false,
	);
	notification.addEventListener("click", () => openOverlay("log"), false);
	statsButton.addEventListener("click", () => openOverlay("stats"), false);
	logButton.addEventListener("click", () => openOverlay("log"), false);
	fastForwardButton.addEventListener("click", activateFastForward, false);
	statsCloseButton.addEventListener(
		"click",
		() => closeOverlay("stats"),
		false,
	);
	logCloseButton.addEventListener("click", () => closeOverlay("log"), false);
	versionCloseButton.addEventListener(
		"click",
		() => closeOverlay("version"),
		false,
	);
	instructionsCloseButton.addEventListener(
		"click",
		() => closeOverlay("instructions"),
		false,
	);
	resumeContinueButton?.addEventListener("click", continueSavedGame, false);
	resumeNewButton?.addEventListener("click", discardSavedGame, false);
	overlayBackdrop.addEventListener("click", () => {
		if (!isBlockingOverlayOpen()) {
			closeAllOverlays();
		}
	}, false);
	globalThis.addEventListener("pagehide", handlePageLifecycleSave, false);
	globalThis.addEventListener("beforeunload", handleBeforeUnload, false);
	document.addEventListener(
		"visibilitychange",
		() => {
			if (document.visibilityState === "hidden") {
				handlePageLifecycleSave();
			}
		},
		false,
	);
	humanTurnController.init();
	renderPot();
	renderTableCommunityCards(communityCardSlots, gameState.communityCards);

	for (const rotateIcon of rotateIcons) {
		rotateIcon.addEventListener("click", rotateSeat, false);
	}
	for (const closeButton of closeButtons) {
		closeButton.addEventListener("click", deletePlayer, false);
	}

	const savedGameSnapshot = readSavedGameSnapshot();
	if (savedGameSnapshot) {
		openResumeGameOverlay(savedGameSnapshot);
	}
}

globalThis.poker = {
	init,
	get players() {
		return gameState.allPlayers;
	},
	get gameFinished() {
		return gameState.gameFinished;
	},
	get handInProgress() {
		return gameState.handInProgress;
	},
	get reveals() {
		return gameState.allPlayers.map((player) => ({
			name: player.name,
			reveals: player.stats.reveals,
		}));
	},
};

poker.init();

/* --------------------------------------------------------------------------------------------------
 * Service Worker configuration
 * - USE_SERVICE_WORKER: enable or disable SW for this project
 * - SERVICE_WORKER_VERSION: bump to force new SW and new cache
 * - AUTO_RELOAD_ON_SW_UPDATE: reload page once after an update
 -------------------------------------------------------------------------------------------------- */
const USE_SERVICE_WORKER = true;
const SERVICE_WORKER_VERSION = "2026-09-01-v12";
const AUTO_RELOAD_ON_SW_UPDATE = true;

initServiceWorker({
	useServiceWorker: USE_SERVICE_WORKER,
	serviceWorkerVersion: SERVICE_WORKER_VERSION,
	autoReloadOnUpdate: AUTO_RELOAD_ON_SW_UPDATE,
	// A table with more than one person on it is never saved, so reloading it mid-game loses the
	// game for everyone who joined. Take the new version once the game is over instead.
	canReloadNow: () => !isGameLive(),
});
