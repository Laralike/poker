/* ==================================================================================================
MODULE BOUNDARY: Join By Code
================================================================================================== */

// CURRENT STATE: Turns a short table code into a seat, without needing a QR reader.
// TARGET STATE: Stay the only place that handles code entry and seat selection; the seat views
// themselves stay responsible for playing.
// PUT HERE: Code lookup, seat listing, and handing off to the right seat view.
// DO NOT PUT HERE: Poker rules, sync polling, or rendering of the table itself.

// The QR codes only help someone holding a phone with a camera app that reads them. On a laptop the
// natural thing is to type a short code, which is what the table already has -- it just never showed
// it or offered anywhere to type it.

import { TABLE_ENDPOINT } from "./shared/syncConfig.js";

const form = document.getElementById("join-form");
const codeInput = document.getElementById("table-code");
const lookupButton = document.getElementById("join-lookup-button");
const statusEl = document.getElementById("join-status");
const seatsEl = document.getElementById("join-seats");
const seatListEl = document.getElementById("join-seat-list");
const viewChoiceEl = document.getElementById("join-view-choice");

function setStatus(message, tone = "") {
	statusEl.textContent = message;
	statusEl.classList.toggle("join-error", tone === "error");
}

function showSeats(isVisible) {
	seatsEl.classList.toggle("hidden", !isVisible);
	viewChoiceEl.classList.toggle("hidden", !isVisible);
}

function getChosenView() {
	const chosen = document.querySelector('input[name="join-view"]:checked');
	return chosen?.value === "cards" ? "hole-cards.html" : "remoteTable.html";
}

function buildSeatUrl(tableId, seatIndex) {
	const base = globalThis.location.origin +
		globalThis.location.pathname.replace(/[^/]*$/, "");
	const url = new URL(`${base}${getChosenView()}`);
	url.searchParams.set("tableId", tableId);
	url.searchParams.set("seatIndex", `${seatIndex}`);
	return url.toString();
}

function renderSeats(tableId, seats) {
	seatListEl.replaceChildren();

	// Bots have no device to join from, so they are not offered.
	const humanSeats = seats.filter((seat) => seat.isBot !== true);
	if (humanSeats.length === 0) {
		showSeats(false);
		setStatus(
			"That table has no seats for people -- every seat is a bot. Check the code, or ask " +
				"whoever set the table up to add a person.",
			"error",
		);
		return;
	}

	humanSeats.forEach((seat) => {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "join-seat";
		button.textContent = seat.name || `Seat ${seat.seatIndex + 1}`;
		if (seat.joined) {
			// Not blocked: the same person may be moving between a laptop and a phone, or coming
			// back after a browser was closed. Just say so.
			const note = document.createElement("span");
			note.className = "join-seat-note";
			note.textContent = "already open on a device — tap to move here";
			button.appendChild(note);
		}
		button.addEventListener("click", () => {
			globalThis.location.href = buildSeatUrl(tableId, seat.seatIndex);
		});
		seatListEl.appendChild(button);
	});

	showSeats(true);
	setStatus(`Found the table. ${humanSeats.length} seats for people.`);
}

async function lookUpTable(event) {
	event?.preventDefault();

	const tableId = codeInput.value.trim();
	if (!tableId) {
		setStatus("Type the code from the shared screen first.", "error");
		codeInput.focus();
		return;
	}

	showSeats(false);
	lookupButton.disabled = true;
	setStatus("Looking for that table…");

	try {
		const url = `${TABLE_ENDPOINT}?tableId=${encodeURIComponent(tableId)}`;
		const res = await fetch(url, { cache: "no-store" });
		if (res.status === 404) {
			setStatus(
				"No table with that code. Check it against the shared screen -- and note the game " +
					"has to have been started before anyone can join.",
				"error",
			);
			return;
		}
		if (!res.ok) {
			throw new Error(`lookup failed with status ${res.status}`);
		}
		const payload = await res.json();
		renderSeats(tableId, Array.isArray(payload?.seats) ? payload.seats : []);
	} catch (error) {
		console.warn("table lookup failed", error);
		setStatus(
			"Could not reach the table server. Either it has not been set up for this copy yet, " +
				"or you are offline.",
			"error",
		);
	} finally {
		lookupButton.disabled = false;
	}
}

function init() {
	form.addEventListener("submit", lookUpTable);

	// A shared link can carry the code, so clicking through skips the typing entirely.
	const preset = new URLSearchParams(globalThis.location.search).get("tableId");
	if (preset) {
		codeInput.value = preset;
		lookUpTable();
	}
}

init();
