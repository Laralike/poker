/* ==================================================================================================
The table server
================================================================================================== */

// Runs on plain Node or on Deno, and keeps everything it needs in memory. There is deliberately no
// database: a table is a few kilobytes that matters for the length of one evening, and requiring a
// hosted database was the single fiddliest step in getting a copy of this game running.
//
// Losing the memory is survivable by design. The shared table re-sends the whole state after every
// action, so a restarted server refills within a second, and the seat views notice a table they can
// no longer match and ask for a full copy. A restart mid-game costs a few seconds, not the game.

const runtimeDeno = globalThis.Deno;

function readEnv(name) {
	if (runtimeDeno?.env?.get) {
		return runtimeDeno.env.get(name);
	}
	return globalThis.process?.env?.[name];
}

/* --------------------------------------------------------------------------------------------------
In-memory store with expiry
---------------------------------------------------------------------------------------------------*/

const store = new Map();

function storeGet(key) {
	const entry = store.get(key);
	if (!entry) {
		return null;
	}
	if (entry.expiresAt <= Date.now()) {
		store.delete(key);
		return null;
	}
	return entry.value;
}

function storeSet(key, value, ttlMs) {
	store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

function storeDelete(key) {
	store.delete(key);
}

// Nothing here is big, but a long-lived process should not accumulate finished tables for ever.
function sweepExpired() {
	const now = Date.now();
	for (const [key, entry] of store) {
		if (entry.expiresAt <= now) {
			store.delete(key);
		}
	}
}

setInterval(sweepExpired, 60_000);

const SYNC_VIEW_SCHEMA_VERSION = 7;
const devOrigin = "http://127.0.0.1:5500";
const STATE_TTL = 86_400_000;
const ACTION_TTL = 120_000;
// A seat counts as "on its own device" for this long after its last poll. Generous on purpose: a
// closed lid, a flat battery or a browser that needed reopening should not cost you your seat, and
// handing it back early is not free -- your options appear on the shared screen for everyone. It
// costs nothing to wait, because the moment the device checks in again the controls return to it,
// and anyone at the table can take the turn over by hand without waiting at all.
const PRESENCE_TTL = 60_000;
// Presence is refreshed at most this often, so a 750ms poll does not mean a write every 750ms.
const PRESENCE_WRITE_INTERVAL = 4_000;
const allowedActionNames = new Set(["fold", "check", "call", "raise", "allin"]);

// Which sites may talk to this server. Anything not listed is refused, and from the browser that
// looks like the game simply never syncing, so getting it wrong is worth making hard.
//
// Set it here, in the file, so a copy works as soon as it is deployed with nothing else to
// configure. The ALLOWED_ORIGINS environment variable overrides this if you would rather not commit
// the value, or need to add one temporarily.
const DEFAULT_ALLOWED_ORIGINS = "https://laralike.github.io";

function readAllowedOrigins() {
	const configured = readEnv("ALLOWED_ORIGINS") ?? DEFAULT_ALLOWED_ORIGINS;
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

function jsonResponse(body, origin, status = 200, extraHeaders = {}) {
	return new Response(JSON.stringify(body), {
		status,
		headers: withCors(origin, {
			"Content-Type": "application/json",
			"Cache-Control": "no-store",
			...extraHeaders,
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
	return `table:${tableId}`;
}

function getActionKey(tableId) {
	return `action:${tableId}`;
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
	return `presence:${tableId}`;
}

/* --------------------------------------------------------------------------------------------------
Seat Presence

The shared table cannot otherwise tell whether a human seat is being played from its own phone or
whether nobody ever opened the link. It used to assume the latter and show that seat's action buttons
on the shared screen, which is how private decisions ended up in front of the whole table. Every seat
poll refreshes a heartbeat here, and the host reads it back when it pushes state.
---------------------------------------------------------------------------------------------------*/

function getSeatPresence(tableId) {
	const seats = storeGet(getPresenceKey(tableId))?.seats;
	return (seats && typeof seats === "object") ? seats : {};
}

function touchSeatPresence(tableId, seatIndex) {
	const seats = getSeatPresence(tableId);
	const now = Date.now();
	const lastSeen = Number(seats[seatIndex]);

	// Skip the write when the previous heartbeat is still fresh; polls are frequent, writes are not
	// free, and a few seconds of resolution is all the host needs.
	if (Number.isFinite(lastSeen) && now - lastSeen < PRESENCE_WRITE_INTERVAL) {
		return seats;
	}

	const nextSeats = { ...seats, [seatIndex]: now };
	storeSet(getPresenceKey(tableId), { seats: nextSeats }, STATE_TTL);
	return nextSeats;
}

// How long ago each live seat was last heard from. The shared table uses this to tell "they are
// sitting there thinking" apart from "they have gone quiet and may have dropped out", which read
// identically before and made the waiting message quietly misleading.
function getSeatsLastSeen(seats, now = Date.now()) {
	const ages = {};
	for (const [seatIndex, lastSeen] of Object.entries(seats)) {
		const parsed = Number(lastSeen);
		if (Number.isFinite(parsed) && now - parsed <= PRESENCE_TTL) {
			ages[seatIndex] = now - parsed;
		}
	}
	return ages;
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

function getState(tableId) {
	return storeGet(getTableKey(tableId));
}

function saveState(tableId, payload) {
	const current = getState(tableId);
	const version = (current?.version ?? 0) + 1;
	const record = {
		// The backend persists the already-prepared view model.
		// The table is the canonical computation source; this endpoint only stores and projects it.
		view: payload.view,
		updatedAt: new Date().toISOString(),
		version,
		schemaVersion: SYNC_VIEW_SCHEMA_VERSION,
	};
	storeSet(getTableKey(tableId), record, STATE_TTL);
	return record;
}

function savePendingAction(tableId, actionRequest) {
	const record = {
		seatIndex: actionRequest.seatIndex,
		turnToken: actionRequest.turnToken,
		action: actionRequest.action,
		amount: actionRequest.amount ?? null,
		createdAt: new Date().toISOString(),
	};
	storeSet(getActionKey(tableId), record, ACTION_TTL);
	return record;
}

function consumePendingAction(tableId, turnToken) {
	const key = getActionKey(tableId);
	const record = storeGet(key);
	if (!record) {
		return null;
	}
	storeDelete(key);
	return record.turnToken === turnToken ? record : null;
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
	const record = saveState(tableId, { view });
	const seats = getSeatPresence(tableId);
	const presentSeats = getLiveSeatIndexes(seats);
	return jsonResponse({
		ok: true,
		version: record.version,
		updatedAt: record.updatedAt,
		schemaVersion: record.schemaVersion,
		// The host uses this to decide whether a seat's controls belong on the shared screen.
		presentSeats,
		seatsLastSeen: getSeatsLastSeen(seats),
	}, origin);
}

function handleGetState(url, origin) {
	const tableId = url.searchParams.get("tableId") || "default";
	const seatIndex = parseInteger(url.searchParams.get("seatIndex"));
	const sinceParam = url.searchParams.get("sinceVersion");
	const sinceVersion = sinceParam ? Number.parseInt(sinceParam, 10) : 0;

	if (seatIndex === null) {
		return textResponse("Missing seatIndex", 400, origin);
	}

	touchSeatPresence(tableId, seatIndex);

	const record = getState(tableId);
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

	savePendingAction(tableId, {
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
function handleGetAction(url, origin) {
	const tableId = url.searchParams.get("tableId") || "default";
	const turnToken = url.searchParams.get("turnToken")?.trim() || "";
	if (!turnToken) {
		return textResponse("Missing turnToken", 400, origin);
	}

	const record = consumePendingAction(tableId, turnToken);
	const seats = getSeatPresence(tableId);
	const presentSeats = getLiveSeatIndexes(seats);
	const seatsLastSeen = getSeatsLastSeen(seats);
	// The action's own fields stay at the top level, where they have always been, and presence is
	// added beside them. Wrapping them instead would silently break any page still running an older
	// copy of the script -- it would read no action, and the player's move would vanish with their
	// buttons stuck greyed out. Caches make that a certainty, not a risk.
	return jsonResponse({ ...(record ?? {}), presentSeats, seatsLastSeen }, origin);
}

// Joining from a laptop means typing a code, which means something has to answer "what seats does
// this table have?" without handing over anybody's cards. This returns names and seat numbers only:
// exactly what is already on the shared screen, and nothing that is not.
function handleGetTable(url, origin) {
	const tableId = url.searchParams.get("tableId")?.trim() || "";
	if (!tableId) {
		return textResponse("Missing tableId", 400, origin);
	}

	const record = getState(tableId);
	if (!record) {
		return textResponse("Not found", 404, origin);
	}

	const playersPublic = Array.isArray(record.view?.table?.playersPublic) ? record.view.table.playersPublic : [];
	const joinedSeats = new Set(getLiveSeatIndexes(getSeatPresence(tableId)));

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
	// Deliberately readable from anywhere. It carries no game data, and the case worth diagnosing is
	// "this site is not on the allow list" -- which, with normal CORS, would block the very answer
	// that explains the problem.
	return jsonResponse(
		{
			ok: true,
			runtime: runtimeDeno ? "deno" : "node",
			tablesInMemory: store.size,
			allowedOrigins: [...allowedOrigins],
			hint: "Server is running. If the game will not sync, check that the site you play on " +
				"appears in allowedOrigins above, exactly, including https:// and with no trailing slash.",
		},
		origin,
		200,
		{ "Access-Control-Allow-Origin": "*" },
	);
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

/* --------------------------------------------------------------------------------------------------
Bootstrap

Deno serves web-standard Requests directly. Node needs a small adapter, because its http module
predates them. Same handler either way, so there is only ever one implementation of the rules.
---------------------------------------------------------------------------------------------------*/

async function handleRequest(request) {
	try {
		return await routeRequest(request);
	} catch (error) {
		console.error("Unexpected error", error);
		return textResponse("Internal error", 500, request.headers.get("origin"));
	}
}

const port = Number.parseInt(readEnv("PORT") ?? "", 10) || 8000;

if (runtimeDeno?.serve) {
	runtimeDeno.serve({ port }, handleRequest);
} else {
	const { createServer } = await import("node:http");

	createServer(async (req, res) => {
		const url = `http://${req.headers.host ?? "localhost"}${req.url}`;
		const body = (req.method === "GET" || req.method === "HEAD") ? undefined : await new Promise((resolve) => {
			const chunks = [];
			req.on("data", (chunk) => chunks.push(chunk));
			req.on("end", () => resolve(Buffer.concat(chunks)));
		});

		const response = await handleRequest(
			new Request(url, { method: req.method, headers: req.headers, body }),
		);

		res.writeHead(response.status, Object.fromEntries(response.headers));
		const text = await response.arrayBuffer();
		res.end(Buffer.from(text));
	}).listen(port, () => {
		console.log(`Table server listening on port ${port}`);
	});
}
