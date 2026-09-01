/* ==================================================================================================
MODULE BOUNDARY: Shared Human Turn Controller
================================================================================================== */

// CURRENT STATE: Shared action-control shell for the host table, remote table, and private seat
// views. It submits local/remote human action requests, while betting-round progress decisions stay
// with the caller/engine boundary.
// TARGET STATE: Keep input wiring and control-state synchronization shared, while poker rules stay
// in actionModel and runtime flow ownership stays with the callers.
// LAYERS:
// 1) amount-only slider/button math
// 2) one shared interactive control shell
// 3) thin flow-specific wrappers for host and synced seat views
// DO NOT PUT HERE: Poker rules already covered by actionModel, sync schema helpers, or generic
// rendering primitives.

// AMOUNT CONVENTION: the DOM controls below speak in TOTALS ("raise to 40"), because that is what a
// player means. Everything handed to actionModel is a STAKE. Convert at the boundary, never in the
// middle.

import { formatMoney } from "./currency.js";
import {
	clampActionAmount,
	fromTotalAmount,
	getActionButtonLabel,
	getActionRequestForAmount,
	isInvalidRaiseAmount,
	normalizeActionAmount,
	toTotalAmount,
} from "./actionModel.js";

export function shouldShowSeatActionControls(seatView, pendingAction, seatIndex) {
	return !!pendingAction &&
		pendingAction.seatIndex === seatIndex &&
		!seatView.folded &&
		!seatView.allIn;
}

export function getSeatPendingAction(tableView, seatIndex) {
	const tablePendingAction = tableView?.pendingAction ?? null;
	if (tablePendingAction?.seatIndex === seatIndex) {
		return tablePendingAction;
	}
	return null;
}

// Fast Forward and Deal Next Round belong to the table, not to a seat, but they were only ever on
// the shared screen -- so whoever was running the table had to keep switching windows to press them.
// Both player views now offer the same two buttons, driven by what the table publishes.
export function createTableControls({
	containerEl,
	fastForwardButton,
	nextRoundButton,
	tableId,
	commandEndpoint,
	onCommandError = null,
}) {
	let inFlight = false;

	async function send(command) {
		if (inFlight || !tableId) {
			return;
		}
		inFlight = true;
		fastForwardButton && (fastForwardButton.disabled = true);
		nextRoundButton && (nextRoundButton.disabled = true);
		try {
			const res = await fetch(commandEndpoint, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ tableId, command }),
			});
			if (!res.ok) {
				throw new Error(`command failed with status ${res.status}`);
			}
		} catch (error) {
			console.warn("table command failed", error);
			onCommandError?.(error);
		} finally {
			inFlight = false;
		}
	}

	function init() {
		fastForwardButton?.addEventListener("click", () => send("fastforward"));
		nextRoundButton?.addEventListener("click", () => send("nextround"));
	}

	function render(tableControls) {
		if (!containerEl) {
			return;
		}

		const canFastForward = tableControls?.canFastForward === true;
		const canStartNextRound = tableControls?.canStartNextRound === true;
		const seconds = tableControls?.nextRoundSeconds;

		if (fastForwardButton) {
			fastForwardButton.classList.toggle("hidden", !canFastForward);
			// Re-enable once the table has acted, so the button is ready for the next hand.
			if (canFastForward) {
				fastForwardButton.disabled = false;
			}
		}
		if (nextRoundButton) {
			nextRoundButton.classList.toggle("hidden", !canStartNextRound);
			nextRoundButton.textContent = Number.isFinite(seconds) && seconds > 0
				? `Deal Next Round (${seconds})`
				: "Deal Next Round";
			if (canStartNextRound) {
				nextRoundButton.disabled = false;
			}
		}
		containerEl.classList.toggle("hidden", !canFastForward && !canStartNextRound);
	}

	function hide() {
		containerEl?.classList.add("hidden");
	}

	return { init, render, hide };
}

export function configureViewSwitchLink(linkEl, targetPath, tableId, seatIndex) {
	if (!linkEl || !tableId || seatIndex === null) {
		return;
	}
	linkEl.href = `${targetPath}?tableId=${encodeURIComponent(tableId)}&seatIndex=${seatIndex}`;
}

export function setViewSwitchLinkVisible(linkEl, isVisible) {
	if (!linkEl) {
		return;
	}
	linkEl.classList.toggle("hidden", !isVisible);
}

function getSliderStepAmount(amountSlider) {
	const parsedStep = Number.parseInt(amountSlider.step, 10);
	if (Number.isNaN(parsedStep) || parsedStep <= 0) {
		return 1;
	}
	return parsedStep;
}

function getSteppedActionAmount(currentAmount, actionState, sliderStep, direction) {
	const nextAmount = clampActionAmount(currentAmount + (direction * sliderStep), actionState);
	if (!isInvalidRaiseAmount(nextAmount, actionState)) {
		return nextAmount;
	}

	return direction > 0 ? normalizeActionAmount(nextAmount, actionState) : actionState.minAmount;
}

// An <output> can only be read; an <input> can also be typed into. Both expose .value, so the shell
// treats them the same and only wires keyboard entry when the field can actually accept it.
function isEditableAmountField(amountField) {
	return amountField?.tagName === "INPUT";
}

export function createActionAmountControls({
	actionButton,
	amountSlider,
	sliderOutput,
	decrementButton = null,
	incrementButton = null,
}) {
	const amountField = sliderOutput;
	const canTypeAmount = isEditableAmountField(amountField);
	let currentActionState = null;

	// `stake` is what the engine takes; the DOM below shows the matching total.
	function setCurrentAmount(stake, { normalize = false, syncField = true } = {}) {
		if (!currentActionState) {
			return;
		}

		const parsedStake = Number.isNaN(stake) ? currentActionState.minAmount : stake;
		const nextStake = normalize
			? normalizeActionAmount(parsedStake, currentActionState)
			: clampActionAmount(parsedStake, currentActionState);
		const nextTotal = toTotalAmount(nextStake, currentActionState);

		amountSlider.value = nextTotal;
		// While someone is mid-keystroke, leave their text alone and only reflect what pressing the
		// action button would actually do.
		if (syncField) {
			amountField.value = nextTotal;
		}
		amountField.classList.toggle(
			"invalid",
			isInvalidRaiseAmount(nextStake, currentActionState),
		);
		actionButton.textContent = getActionButtonLabel(nextStake, currentActionState);
	}

	// Reads whichever control the player last touched. Both are kept in sync, and the typed field
	// wins while it holds raw text, so a typed amount is never lost by clicking straight through to
	// the action button.
	function getCurrentStake() {
		if (!currentActionState) {
			return Number.NaN;
		}

		const source = canTypeAmount ? amountField : amountSlider;
		return fromTotalAmount(Number.parseInt(source.value, 10), currentActionState);
	}

	function handleActionSliderInput() {
		setCurrentAmount(fromTotalAmount(
			Number.parseInt(amountSlider.value, 10),
			currentActionState,
		));
	}

	function handleActionSliderChange() {
		setCurrentAmount(
			fromTotalAmount(Number.parseInt(amountSlider.value, 10), currentActionState),
			{ normalize: true },
		);
	}

	function handleAmountFieldInput() {
		setCurrentAmount(
			fromTotalAmount(Number.parseInt(amountField.value, 10), currentActionState),
			{ syncField: false },
		);
	}

	function handleAmountFieldChange() {
		setCurrentAmount(
			fromTotalAmount(Number.parseInt(amountField.value, 10), currentActionState),
			{ normalize: true },
		);
	}

	function handleAmountFieldKeydown(event) {
		if (event.key !== "Enter") {
			return;
		}
		// Commit the typed amount without letting Enter submit anything implicitly.
		event.preventDefault();
		handleAmountFieldChange();
		amountField.blur();
	}

	function stepAmount(direction) {
		if (!currentActionState) {
			return;
		}

		const currentAmount = clampActionAmount(getCurrentStake(), currentActionState);
		const sliderStep = getSliderStepAmount(amountSlider);
		const nextAmount = getSteppedActionAmount(
			currentAmount,
			currentActionState,
			sliderStep,
			direction,
		);
		setCurrentAmount(nextAmount);
	}

	function handleDecrementClick() {
		stepAmount(-1);
	}

	function handleIncrementClick() {
		stepAmount(1);
	}

	function init() {
		amountSlider.addEventListener("input", handleActionSliderInput);
		amountSlider.addEventListener("change", handleActionSliderChange);
		if (canTypeAmount) {
			amountField.addEventListener("input", handleAmountFieldInput);
			amountField.addEventListener("change", handleAmountFieldChange);
			amountField.addEventListener("blur", handleAmountFieldChange);
			amountField.addEventListener("keydown", handleAmountFieldKeydown);
		}
		decrementButton?.addEventListener("click", handleDecrementClick);
		incrementButton?.addEventListener("click", handleIncrementClick);
	}

	function clear() {
		currentActionState = null;
		amountField.classList.remove("invalid");
	}

	function render(actionState, { actionStep = amountSlider.step, resetAmount = false } = {}) {
		currentActionState = actionState;
		if (!currentActionState) {
			clear();
			return;
		}

		// Slider bounds are totals, so the handle position matches the number on the button.
		amountSlider.min = toTotalAmount(currentActionState.minAmount, currentActionState);
		amountSlider.max = toTotalAmount(currentActionState.maxAmount, currentActionState);
		amountSlider.step = actionStep;
		if (canTypeAmount) {
			amountField.min = amountSlider.min;
			amountField.max = amountSlider.max;
			amountField.step = actionStep;
		}

		const nextStake = resetAmount ? currentActionState.minAmount : getCurrentStake();
		setCurrentAmount(nextStake);
	}

	return {
		init,
		clear,
		render,
		getCurrentStake,
	};
}

function createTurnActionUi({
	visibleElements,
	foldButton,
	actionButton,
	amountSlider,
	sliderOutput,
	decrementButton = null,
	incrementButton = null,
	actionStep = 10,
	onHidden = null,
}) {
	let isInitialized = false;
	let currentActionState = null;
	let currentOnSubmit = null;
	let currentOnFold = null;
	const amountControls = createActionAmountControls({
		actionButton,
		amountSlider,
		sliderOutput,
		decrementButton,
		incrementButton,
	});

	// Keep all DOM-only control behavior in one place so host and remote flows cannot drift.

	function setVisible(isVisible) {
		visibleElements.forEach((el) => {
			if (!el) {
				return;
			}
			el.classList.toggle("hidden", !isVisible);
		});
	}

	function setEnabled(enabled) {
		foldButton.disabled = !enabled;
		actionButton.disabled = !enabled;
		amountSlider.disabled = !enabled;
		if (isEditableAmountField(sliderOutput)) {
			sliderOutput.disabled = !enabled;
		}
		if (decrementButton) {
			decrementButton.disabled = !enabled;
		}
		if (incrementButton) {
			incrementButton.disabled = !enabled;
		}
	}

	function handlePrimaryAction() {
		if (!currentActionState || typeof currentOnSubmit !== "function") {
			return;
		}

		// getCurrentStake() already converts the displayed total back to a stake.
		const amount = amountControls.getCurrentStake();
		if (Number.isNaN(amount)) {
			return;
		}

		const actionRequest = getActionRequestForAmount(amount, currentActionState);
		currentOnSubmit(actionRequest);
	}

	function handleFoldAction() {
		if (typeof currentOnFold !== "function") {
			return;
		}
		currentOnFold();
	}

	function init() {
		if (isInitialized) {
			return;
		}

		amountControls.init();
		foldButton.addEventListener("click", handleFoldAction);
		actionButton.addEventListener("click", handlePrimaryAction);
		isInitialized = true;
		hide();
	}

	function show(actionState, {
		resetAmount = false,
		enabled = true,
		onSubmit = null,
		onFold = null,
	} = {}) {
		if (!isInitialized) {
			init();
		}

		currentActionState = actionState;
		currentOnSubmit = onSubmit;
		currentOnFold = onFold;
		setVisible(true);
		amountControls.render(actionState, {
			actionStep,
			resetAmount,
		});
		setEnabled(enabled);
	}

	function hide() {
		currentActionState = null;
		currentOnSubmit = null;
		currentOnFold = null;
		setVisible(false);
		amountControls.clear();
		setEnabled(false);
		onHidden?.();
	}

	return {
		init,
		show,
		hide,
		setEnabled,
	};
}

export function createHumanTurnController({
	foldButton,
	actionButton,
	amountControls,
	amountSlider,
	sliderOutput,
	decrementButton = null,
	incrementButton = null,
	actionPollInterval = 1000,
	actionStep = 10,
	remoteTurnReviewInterval = 1000,
	presenceGraceInterval = 2500,
	onControlsHidden = null,
	onNewTurn = null,
	setActiveTurnPlayer,
	setPendingAction,
	clearPendingAction,
	fetchPendingRemoteAction,
	applyTurnAction,
	continueAfterResolvedTurn,
	getPlayerActionState,
	getResolvedTurnMeta,
	isSeatPlayedRemotely = null,
	isSeatPresenceKnown = null,
	renderRemoteTurnStatus = null,
}) {
	// The host wrapper owns turn session state and polling.
	// The shared UI shell above only handles controls, listeners, and reset behavior.
	let activeTurnState = null;
	const turnActionUi = createTurnActionUi({
		visibleElements: [
			foldButton,
			actionButton,
			amountControls,
		],
		foldButton,
		actionButton,
		amountSlider,
		sliderOutput,
		decrementButton,
		incrementButton,
		actionStep,
		onHidden: onControlsHidden,
	});

	function clearRemoteActionTimer(turnState) {
		if (!turnState || turnState.remoteActionTimer === null) {
			return;
		}
		clearTimeout(turnState.remoteActionTimer);
		turnState.remoteActionTimer = null;
	}

	function clearRemoteTurnReviewTimer(turnState) {
		if (!turnState || turnState.remoteTurnReviewTimer === null) {
			return;
		}
		clearTimeout(turnState.remoteTurnReviewTimer);
		turnState.remoteTurnReviewTimer = null;
	}

	function releaseActiveTurn({ clearPending = false } = {}) {
		const turnState = activeTurnState;
		if (turnState) {
			turnState.cancelled = true;
			clearRemoteActionTimer(turnState);
			clearRemoteTurnReviewTimer(turnState);
			if (
				clearPending &&
				turnState.pendingAction &&
				turnState.pendingActionCleared !== true
			) {
				clearPendingAction();
				turnState.pendingActionCleared = true;
			}
			activeTurnState = null;
		}
		renderRemoteTurnStatus?.(null, null);
		turnActionUi.hide();
	}

	/* ------------------------------------------------------------------------------------------
	Turn ownership

	A seat being played from its own phone must not have its options laid out on the shared screen
	for everyone to read. When the backend says that seat's device is live, the table waits for it
	instead of drawing the controls, and re-checks periodically so a device that goes quiet — dead
	battery, closed tab, walked off — hands the seat back rather than stalling the game. Anyone at
	the table can also take the turn over deliberately.
	------------------------------------------------------------------------------------------- */

	function isTurnStateLive(turnState) {
		return activeTurnState === turnState &&
			turnState.turnResolved !== true &&
			turnState.cancelled !== true;
	}

	function scheduleRemoteTurnReview(turnState) {
		clearRemoteTurnReviewTimer(turnState);
		if (!isTurnStateLive(turnState)) {
			return;
		}
		turnState.remoteTurnReviewTimer = setTimeout(() => {
			turnState.remoteTurnReviewTimer = null;
			presentTurnControls(turnState);
		}, remoteTurnReviewInterval);
	}

	function takeOverTurnLocally(turnState) {
		if (!isTurnStateLive(turnState)) {
			return;
		}
		turnState.takenOverLocally = true;
		presentTurnControls(turnState);
	}

	function presentTurnControls(turnState) {
		if (!isTurnStateLive(turnState)) {
			return;
		}

		// Until the backend has told us who is on a device, assume the seat might be, and hold the
		// controls back for a moment. Showing them first and retracting them a second later would
		// have already put that seat's options in front of the room. The wait is bounded, so a seat
		// with no device is only briefly delayed.
		const awaitingPresence = turnState.takenOverLocally !== true &&
			typeof isSeatPresenceKnown === "function" &&
			isSeatPresenceKnown() !== true &&
			Date.now() - turnState.startedAt < presenceGraceInterval;

		const deferToDevice = awaitingPresence ||
			(turnState.takenOverLocally !== true &&
				isSeatPlayedRemotely?.(turnState.player) === true);

		if (deferToDevice) {
			if (turnState.controlsShown !== false) {
				turnState.controlsShown = false;
				turnActionUi.hide();
			}
			renderRemoteTurnStatus?.(
				turnState.player,
				() => takeOverTurnLocally(turnState),
				{ awaitingPresence },
			);
			scheduleRemoteTurnReview(turnState);
			return;
		}

		renderRemoteTurnStatus?.(null, null);
		turnActionUi.show(turnState.actionState, {
			// Only reset the amount the first time the controls appear for this turn, so taking a
			// turn over does not throw away an amount already dialled in.
			resetAmount: turnState.controlsShown !== true,
			enabled: true,
			onSubmit: (actionRequest) => submitHumanTurn(turnState, actionRequest),
			onFold: () => submitHumanTurn(turnState, { action: "fold" }),
		});
		turnState.controlsShown = true;

		// Keep watching even while the controls are up. Presence is learned from the backend's reply
		// to a state push, so a seat can be confirmed as "on its own device" a moment after its turn
		// began -- or someone can open their link mid-turn. Without this re-check the shared screen
		// would keep a seat's options on display for the rest of the turn.
		if (turnState.takenOverLocally === true) {
			clearRemoteTurnReviewTimer(turnState);
			return;
		}
		scheduleRemoteTurnReview(turnState);
	}

	function init() {
		turnActionUi.init();
	}

	function hide() {
		releaseActiveTurn({ clearPending: true });
	}

	function normalizeRemoteActionRequest(turnState, remoteAction) {
		if (
			!remoteAction ||
			remoteAction.seatIndex !== turnState.player.seatIndex ||
			remoteAction.turnToken !== turnState.pendingAction?.turnToken
		) {
			return null;
		}

		switch (remoteAction.action) {
			case "fold":
				return { action: "fold" };
			case "check":
				return turnState.actionState.canCheck ? getActionRequestForAmount(0, turnState.actionState) : null;
			case "call":
				return turnState.actionState.needToCall > 0
					? getActionRequestForAmount(
						Math.min(turnState.actionState.needToCall, turnState.player.chips),
						turnState.actionState,
					)
					: null;
			case "allin":
				return turnState.player.chips > 0 ? { action: "allin", amount: turnState.player.chips } : null;
			case "raise": {
				const amount = Number.parseInt(remoteAction.amount, 10);
				if (Number.isNaN(amount) || amount <= turnState.actionState.needToCall) {
					return null;
				}
				return getActionRequestForAmount(
					Math.min(amount, turnState.player.chips),
					turnState.actionState,
				);
			}
			default:
				return null;
		}
	}

	function submitHumanTurn(turnState, actionRequest) {
		if (
			activeTurnState !== turnState ||
			turnState.turnResolved ||
			turnState.cancelled ||
			!actionRequest
		) {
			return false;
		}

		turnActionUi.setEnabled(false);
		const resolvedAction = applyTurnAction(turnState.player, actionRequest);
		if (!resolvedAction) {
			if (activeTurnState === turnState && turnState.cancelled !== true) {
				turnActionUi.setEnabled(true);
			}
			return false;
		}

		turnState.turnResolved = true;
		clearRemoteTurnReviewTimer(turnState);
		clearPendingAction();
		turnState.pendingActionCleared = true;
		activeTurnState = null;
		renderRemoteTurnStatus?.(null, null);
		turnActionUi.hide();
		const turnMeta = getResolvedTurnMeta(resolvedAction);
		continueAfterResolvedTurn({
			player: turnState.player,
			cycles: turnState.cycles,
			nextPlayer: turnState.nextPlayer,
			logPrefix: turnMeta.logPrefix,
			advanceReason: turnMeta.advanceReason,
		});
		return true;
	}

	function scheduleRemoteActionPoll(turnState) {
		if (
			activeTurnState !== turnState ||
			turnState.turnResolved ||
			turnState.cancelled ||
			!turnState.pendingAction?.turnToken
		) {
			return;
		}
		turnState.remoteActionTimer = setTimeout(() => {
			pollRemoteAction(turnState);
		}, actionPollInterval);
	}

	async function pollRemoteAction(turnState) {
		turnState.remoteActionTimer = null;
		if (
			activeTurnState !== turnState ||
			turnState.turnResolved ||
			turnState.cancelled ||
			turnState.remoteActionInFlight ||
			!turnState.pendingAction?.turnToken
		) {
			return;
		}

		turnState.remoteActionInFlight = true;
		try {
			const remoteAction = await fetchPendingRemoteAction(turnState.pendingAction.turnToken);
			if (
				activeTurnState !== turnState ||
				turnState.turnResolved ||
				turnState.cancelled
			) {
				return;
			}
			const normalizedRequest = normalizeRemoteActionRequest(turnState, remoteAction);
			if (normalizedRequest) {
				submitHumanTurn(turnState, normalizedRequest);
				return;
			}
		} finally {
			turnState.remoteActionInFlight = false;
		}

		if (
			activeTurnState === turnState &&
			turnState.turnResolved !== true &&
			turnState.cancelled !== true
		) {
			scheduleRemoteActionPoll(turnState);
		}
	}

	function runHumanTurn({ player, cycles, nextPlayer }) {
		releaseActiveTurn({ clearPending: true });
		setActiveTurnPlayer(player);
		onNewTurn?.(player);

		const turnState = {
			player,
			cycles,
			nextPlayer,
			actionState: getPlayerActionState(player),
			pendingAction: null,
			remoteActionTimer: null,
			remoteActionInFlight: false,
			remoteTurnReviewTimer: null,
			turnResolved: false,
			cancelled: false,
			pendingActionCleared: false,
			controlsShown: null,
			takenOverLocally: false,
			startedAt: Date.now(),
		};
		turnState.pendingAction = setPendingAction(player);
		activeTurnState = turnState;

		// Start listening for the device's action before deciding what to draw, so a fast player
		// is never waiting on the shared screen to make up its mind.
		if (turnState.pendingAction?.turnToken) {
			scheduleRemoteActionPoll(turnState);
		}
		presentTurnControls(turnState);
	}

	return {
		init,
		hide,
		runHumanTurn,
	};
}

export function createSeatActionControls({
	tableId,
	seatIndex,
	actionEndpoint,
	actionStep = 10,
	submitRecoveryDelay = 12000,
	visibleElements = [],
	foldButton,
	actionButton,
	amountSlider,
	sliderOutput,
	decrementButton = null,
	incrementButton = null,
	onActionError = null,
	onActionSubmitted = null,
	onNewTurn = null,
}) {
	// Synced seat views only submit actions to the host/backend.
	// They reuse the same control shell, but do not own a local turn lifecycle.
	let currentPendingAction = null;
	let isSubmittingAction = false;
	let submitRecoveryTimer = null;
	const turnActionUi = createTurnActionUi({
		visibleElements,
		foldButton,
		actionButton,
		amountSlider,
		sliderOutput,
		decrementButton,
		incrementButton,
		actionStep,
	});

	function clearSubmitRecoveryTimer() {
		if (submitRecoveryTimer === null) {
			return;
		}
		clearTimeout(submitRecoveryTimer);
		submitRecoveryTimer = null;
	}

	// The controls stay disabled after a successful submit, because the turn is over as far as this
	// device is concerned and the next state update takes them away. But if the table never acts on
	// it -- a dropped request, or a table running an older script that could not read the reply --
	// the player is left staring at dead buttons for the rest of the hand with no way back. So give
	// up waiting after a while and let them try again.
	function scheduleSubmitRecovery() {
		clearSubmitRecoveryTimer();
		submitRecoveryTimer = setTimeout(() => {
			submitRecoveryTimer = null;
			if (!isSubmittingAction || !currentPendingAction) {
				return;
			}
			isSubmittingAction = false;
			turnActionUi.setEnabled(true);
			if (typeof onActionError === "function") {
				onActionError(new Error("action not acknowledged"));
			}
		}, submitRecoveryDelay);
	}

	// What the player just did, said back to them in the same numbers the button showed. There is no
	// point making somebody wait for a round trip to find out what they themselves pressed.
	function describeOwnAction(actionRequest, actionState) {
		if (actionRequest?.action === "fold") {
			return "You folded.";
		}
		const stake = actionRequest?.amount ?? 0;
		if (!actionState) {
			return "Sent to the table.";
		}
		const total = formatMoney(toTotalAmount(stake, actionState));
		if (stake === 0) {
			return "You checked.";
		}
		if (stake === actionState.maxAmount) {
			return `You went all-in for ${total}.`;
		}
		if (stake === actionState.needToCall) {
			return `You called ${total}.`;
		}
		return `You raised to ${total}.`;
	}

	async function submitActionRequest(actionRequest) {
		if (!currentPendingAction || !tableId || seatIndex === null || isSubmittingAction) {
			return;
		}

		// Say so on this screen first, before anything touches the network. A person's own move must
		// never appear to hang while it travels; only the table's reaction to it can take time.
		onActionSubmitted?.(
			describeOwnAction(actionRequest, currentPendingAction),
			actionRequest,
		);

		isSubmittingAction = true;
		turnActionUi.setEnabled(false);
		scheduleSubmitRecovery();

		try {
			const res = await fetch(actionEndpoint, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					tableId,
					seatIndex,
					turnToken: currentPendingAction.turnToken,
					action: actionRequest.action,
					amount: actionRequest.amount ?? null,
				}),
			});
			if (!res.ok) {
				throw new Error(`action request failed with status ${res.status}`);
			}
		} catch (error) {
			console.warn("action request failed", error);
			clearSubmitRecoveryTimer();
			isSubmittingAction = false;
			turnActionUi.setEnabled(true);
			if (typeof onActionError === "function") {
				onActionError(error);
			}
		}
	}

	function init() {
		turnActionUi.init();
	}

	function hide() {
		clearSubmitRecoveryTimer();
		currentPendingAction = null;
		isSubmittingAction = false;
		turnActionUi.hide();
	}

	function render(seatView, pendingAction) {
		if (!shouldShowSeatActionControls(seatView, pendingAction, seatIndex)) {
			hide();
			return;
		}

		const isNewTurn = currentPendingAction?.turnToken !== pendingAction.turnToken;
		currentPendingAction = pendingAction;
		if (isNewTurn) {
			clearSubmitRecoveryTimer();
			isSubmittingAction = false;
			onNewTurn?.();
		}
		turnActionUi.show(pendingAction, {
			resetAmount: isNewTurn,
			enabled: !isSubmittingAction,
			onSubmit: submitActionRequest,
			onFold: () => submitActionRequest({ action: "fold" }),
		});
	}

	return {
		init,
		hide,
		render,
	};
}
