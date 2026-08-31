// On Deno Deploy a KV database has to be provisioned and linked to the app before Deno.openKv()
// works. Crashing at start-up when it is not gives a bare 500 with nothing to go on, so hold the
// failure and report it properly through /health instead.
let kv = null;
let kvError = null;
try {
	kv = await Deno.openKv();
} catch (error) {
	kvError = error instanceof Error ? error.message : String(error);
	console.error("Could not open Deno KV", error);
}

const SYNC_VIEW_SCHEMA_VERSION = 7;
const devOrigin = "http://127.0.0.1:5500";
const STATE_TTL = 86_400_000;
const ACTION_TTL = 120_000;
// A seat counts as "on its own device" for this long after its last poll. Long enough to ride out a
// dropped request or a phone that briefly slept, short enough that the shared table takes the seat
// back quickly when someone actually walks away.
const PRESENCE_TTL = 15_000;
// Presence is refreshed at most this often, so a 750ms poll does not mean a write every 750ms.
const PRESENCE_WRITE_INTERVAL = 4_000;
const allowedActionNames = new Set(["fold", "check", "call", "raise", "allin"]);

// Set ALLOWED_ORIGINS (comma separated) to wherever this copy of the table is hosted. Without it a
// fork served from a different domain gets a CORS rejection on every sync call, and multiplayer
// silently stops working with no visible error.
function readAllowedOrigins() {
	const configured = Deno.env.get("ALLOWED_ORIGINS") ?? "";
	const origins = configured
		.split(",")
		.map((origin) => origin.trim())
		.filter((origin) => origin.length > 0);
	origins.push(devOrigin);
	return new Set(origins);
}

const allowedOrigins = readAllowedOrigins();
const baseCorsHeaders = {
	"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
	"Vary": "Origin",
};

// This file is the Deno Deploy entry point.
// Keep the small seat-projection helpers local here instead of importing browser modules, so
// the backend remains deployable as a standalone Deno entry and does not depend on GitHub Pages.
function withCors(origin, headers = {}) {
	const corsHeaders = { ...baseCorsHeaders };
	if (origin && allowedOrigins.has(origin)) {
		corsHeaders["Access-Control-Allow-Origin"] = origin;
	}
	return { ...corsHeaders, ...headers };
}

function jsonResponse(body, origin, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: withCors(origin, {
			"Content-Type": "application/json",
			"Cache-Control": "no-store",
		}),
	});
}

function textResponse(body, status, origin) {
	return new Response(body, {
		status,
		headers: withCors(origin, { "Cache-Control": "no-store" }),
	});
}

function emptyResponse(origin, status = 204) {
	return new Response(null, {
		status,
		headers: withCors(origin, { "Cache-Control": "no-store" }),
	});
}

function parseInteger(value) {
	if (value === null || value === undefined || value === "") {
		return null;
	}
	const parsed = Number.parseInt(value, 10);
	return Number.isNaN(parsed) ? null : parsed;
}

function getTableKey(tableId) {
	return ["table", tableId];
}

function getActionKey(tableId) {
	return ["action", tableId];
}

function findSeatView(view, seatIndex) {
	if (!view || !Array.isArray(view.seatViews)) {
		return null;
	}
	return view.seatViews.find((seat) => seat.seatIndex === seatIndex) ?? null;
}

function createSeatSyncPayload(record, seatIndex) {
	const seat = findSeatView(record?.view, seatIndex);
	if (!seat || !record?.view?.table) {
		return null;
	}

	return {
		table: record.view.table,
		seat,
		version: record.version,
		updatedAt: record.updatedAt,
		schemaVersion: record.schemaVersion ?? SYNC_VIEW_SCHEMA_VERSION,
	};
}

function getPresenceKey(tableId) {
	return ["presence", tableId];
}

/* --------------------------------------------------------------------------------------------------
Seat Presence

The shared table cannot otherwise tell whether a human seat is being played from its own phone or
whether nobody ever opened the link. It used to assume the latter and show that seat's action buttons
on the shared screen, which is how private decisions ended up in front of the whole table. Every seat
poll refreshes a heartbeat here, and the host reads it back when it pushes state.
---------------------------------------------------------------------------------------------------*/

async function getSeatPresence(tableId) {
	const entry = await kv.get(getPresenceKey(tableId));
	const seats = entry.value?.seats;
	return (seats && typeof seats === "object") ? seats : {};
}

async function touchSeatPresence(tableId, seatIndex) {
	const seats = await getSeatPresence(tableId);
	const now = Date.now();
	const lastSeen = Number(seats[seatIndex]);

	// Skip the write when the previous heartbeat is still fresh; polls are frequent, writes are not
	// free, and a few seconds of resolution is all the host needs.
	if (Number.isFinite(lastSeen) && now - lastSeen < PRESENCE_WRITE_INTERVAL) {
		return seats;
	}

	const nextSeats = { ...seats, [seatIndex]: now };
	await kv.set(getPresenceKey(tableId), { seats: nextSeats }, { expireIn: STATE_TTL });
	return nextSeats;
}

// Seat indexes whose device has checked in recently enough to be trusted with its own turn.
function getLiveSeatIndexes(seats, now = Date.now()) {
	return Object.entries(seats)
		.filter(([, lastSeen]) => {
			const parsed = Number(lastSeen);
			return Number.isFinite(parsed) && now - parsed <= PRESENCE_TTL;
		})
		.map(([seatIndex]) => Number.parseInt(seatIndex, 10))
		.filter((seatIndex) => Number.isInteger(seatIndex));
}

async function getState(tableId) {
	const entry = await kv.get(getTableKey(tableId));
	return entry.value ?? null;
}

async function saveState(tableId, payload) {
	const current = await getState(tableId);
	const version = (current?.version ?? 0) + 1;
	const record = {
		// The backend persists the already-prepared view model.
		// The table is the canonical computation source; this endpoint only stores and projects it.
		view: payload.view,
		updatedAt: new Date().toISOString(),
		version,
		schemaVersion: SYNC_VIEW_SCHEMA_VERSION,
	};
	await kv.set(getTableKey(tableId), record, { expireIn: STATE_TTL });
	return record;
}

async function savePendingAction(tableId, actionRequest) {
	const record = {
		seatIndex: actionRequest.seatIndex,
		turnToken: actionRequest.turnToken,
		action: actionRequest.action,
		amount: actionRequest.amount ?? null,
		createdAt: new Date().toISOString(),
	};
	await kv.set(getActionKey(tableId), record, { expireIn: ACTION_TTL });
	return record;
}

async function consumePendingAction(tableId, turnToken) {
	const key = getActionKey(tableId);
	const entry = await kv.get(key);
	const record = entry.value ?? null;
	if (!record) {
		return null;
	}
	if (record.turnToken !== turnToken) {
		await kv.delete(key);
		return null;
	}
	await kv.delete(key);
	return record;
}

async function handlePostState(request, origin) {
	let data;
	try {
		data = await request.json();
	} catch {
		return textResponse("Invalid JSON", 400, origin);
	}

	const view = data?.view;
	if (!view || !view.table || !Array.isArray(view.seatViews)) {
		return textResponse("Missing view", 400, origin);
	}

	const tableId = data.tableId || "default";
	const record = await saveState(tableId, { view });
	const presentSeats = getLiveSeatIndexes(await getSeatPresence(tableId));
	return jsonResponse({
		ok: true,
		version: record.version,
		updatedAt: record.updatedAt,
		schemaVersion: record.schemaVersion,
		// The host uses this to decide whether a seat's controls belong on the shared screen.
		presentSeats,
	}, origin);
}

async function handleGetState(url, origin) {
	const tableId = url.searchParams.get("tableId") || "default";
	const seatIndex = parseInteger(url.searchParams.get("seatIndex"));
	const sinceParam = url.searchParams.get("sinceVersion");
	const sinceVersion = sinceParam ? Number.parseInt(sinceParam, 10) : 0;

	if (seatIndex === null) {
		return textResponse("Missing seatIndex", 400, origin);
	}

	await touchSeatPresence(tableId, seatIndex);

	const record = await getState(tableId);
	if (!record) {
		return textResponse("Not found", 404, origin);
	}

	// The single view never receives the full synchronized table state.
	// It only gets its own seat projection plus the public table projection.
	const payload = createSeatSyncPayload(record, seatIndex);
	if (!payload) {
		return textResponse("Seat not found", 404, origin);
	}
	if (!Number.isNaN(sinceVersion) && record.version <= sinceVersion) {
		return emptyResponse(origin);
	}
	return jsonResponse(payload, origin);
}

async function handlePostAction(request, origin) {
	let data;
	try {
		data = await request.json();
	} catch {
		return textResponse("Invalid JSON", 400, origin);
	}

	const tableId = data?.tableId || "default";
	const seatIndex = parseInteger(data?.seatIndex);
	const turnToken = typeof data?.turnToken === "string" ? data.turnToken.trim() : "";
	const action = typeof data?.action === "string" ? data.action.trim().toLowerCase() : "";
	const amount = parseInteger(data?.amount);

	if (seatIndex === null) {
		return textResponse("Missing seatIndex", 400, origin);
	}
	if (!turnToken) {
		return textResponse("Missing turnToken", 400, origin);
	}
	if (!allowedActionNames.has(action)) {
		return textResponse("Invalid action", 400, origin);
	}
	if (action === "raise" && amount === null) {
		return textResponse("Missing amount", 400, origin);
	}

	await savePendingAction(tableId, {
		seatIndex,
		turnToken,
		action,
		amount,
	});
	return jsonResponse({ ok: true }, origin);
}

// The host polls this once a second for the whole of a human turn, which is exactly the window in
// which it needs to know whether that seat is being played from its own device. Answering with
// presence here costs nothing extra; the host is not pushing state while it waits, so this is its
// only chance to find out.
async function handleGetAction(url, origin) {
	const tableId = url.searchParams.get("tableId") || "default";
	const turnToken = url.searchParams.get("turnToken")?.trim() || "";
	if (!turnToken) {
		return textResponse("Missing turnToken", 400, origin);
	}

	const record = await consumePendingAction(tableId, turnToken);
	const presentSeats = getLiveSeatIndexes(await getSeatPresence(tableId));
	return jsonResponse({ action: record, presentSeats }, origin);
}

// Joining from a laptop means typing a code, which means something has to answer "what seats does
// this table have?" without handing over anybody's cards. This returns names and seat numbers only:
// exactly what is already on the shared screen, and nothing that is not.
async function handleGetTable(url, origin) {
	const tableId = url.searchParams.get("tableId")?.trim() || "";
	if (!tableId) {
		return textResponse("Missing tableId", 400, origin);
	}

	const record = await getState(tableId);
	if (!record) {
		return textResponse("Not found", 404, origin);
	}

	const playersPublic = Array.isArray(record.view?.table?.playersPublic)
		? record.view.table.playersPublic
		: [];
	const joinedSeats = new Set(getLiveSeatIndexes(await getSeatPresence(tableId)));

	return jsonResponse({
		tableId,
		seats: playersPublic.map((seat) => ({
			seatIndex: seat.seatIndex,
			name: seat.name,
			isBot: seat.isBot === true,
			joined: joinedSeats.has(seat.seatIndex),
		})),
		updatedAt: record.updatedAt,
	}, origin);
}

// Something to open in a browser to check the server is actually working, before wondering why the
// game will not sync. Reports the two things that are easy to get wrong: whether the database is
// attached, and which sites are allowed to talk to this server.
function handleHealth(origin) {
	const ok = kv !== null;
	return jsonResponse({
		ok,
		database: ok ? "connected" : "not connected",
		databaseError: kvError,
		allowedOrigins: [...allowedOrigins],
		hint: ok
			? "Server is ready. If the game still will not sync, check that the site you play on is " +
				"listed in allowedOrigins above, exactly, including https:// and no trailing slash."
			: "Provision a Deno KV database and link it to this app, then redeploy.",
	}, origin, ok ? 200 : 503);
}

function handleOptions(origin) {
	return emptyResponse(origin);
}

function routeRequest(request) {
	const url = new URL(request.url);
	if (url.pathname === "/health") {
		return handleHealth(request.headers.get("origin"));
	}

	if (url.pathname !== "/state" && url.pathname !== "/action" && url.pathname !== "/table") {
		return textResponse("Not found", 404, request.headers.get("origin"));
	}

	const origin = request.headers.get("origin");
	if (origin !== null && !allowedOrigins.has(origin)) {
		return textResponse("Forbidden", 403, origin);
	}

	if (request.method === "OPTIONS") {
		return handleOptions(origin);
	}

	if (kv === null) {
		return textResponse(
			"No database attached to this server. Open /health for details.",
			503,
			origin,
		);
	}

	if (url.pathname === "/table") {
		if (request.method === "GET") {
			return handleGetTable(url, origin);
		}
		return textResponse("Method not allowed", 405, origin);
	}

	if (url.pathname === "/state") {
		if (request.method === "GET") {
			return handleGetState(url, origin);
		}
		if (request.method === "POST") {
			return handlePostState(request, origin);
		}
		return textResponse("Method not allowed", 405, origin);
	}

	if (request.method === "GET") {
		return handleGetAction(url, origin);
	}
	if (request.method === "POST") {
		return handlePostAction(request, origin);
	}
	return textResponse("Method not allowed", 405, origin);
}

Deno.serve(async (request) => {
	try {
		return await routeRequest(request);
	} catch (error) {
		console.error("Unexpected error", error);
		return textResponse("Internal error", 500, request.headers.get("origin"));
	}
});
