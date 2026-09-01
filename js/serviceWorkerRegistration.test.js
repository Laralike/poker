// The shared table is the only copy of a game with more than one person in it. A new version
// arriving must never take that away mid-hand, and must not be forgotten either.
import { initServiceWorker } from "./serviceWorkerRegistration.js";

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

// A stand-in browser: a service worker that already controls the page, and a location whose
// reload we can count instead of actually performing.
async function withFakeBrowser(run) {
	const listeners = new Map();
	const original = {
		navigator: globalThis.navigator,
		location: globalThis.location,
		addEventListener: globalThis.addEventListener,
	};
	let reloads = 0;

	const serviceWorker = {
		controller: {},
		addEventListener(type, handler) {
			listeners.set(type, handler);
		},
	};

	Object.defineProperty(globalThis, "navigator", {
		configurable: true,
		value: { serviceWorker },
	});
	Object.defineProperty(globalThis, "location", {
		configurable: true,
		value: { href: "http://localhost:5500/index.html", reload: () => reloads++ },
	});
	globalThis.addEventListener = () => {};

	try {
		return await run({
			fireUpdate: () => listeners.get("controllerchange")?.(),
			reloadCount: () => reloads,
		});
	} finally {
		Object.defineProperty(globalThis, "navigator", { configurable: true, value: original.navigator });
		Object.defineProperty(globalThis, "location", { configurable: true, value: original.location });
		globalThis.addEventListener = original.addEventListener;
	}
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

Deno.test("a new version reloads straight away when no game is running", async () => {
	await withFakeBrowser(({ fireUpdate, reloadCount }) => {
		initServiceWorker({
			useServiceWorker: false,
			serviceWorkerVersion: "test",
			autoReloadOnUpdate: true,
			canReloadNow: () => true,
		});
		fireUpdate();
		assert(reloadCount() === 1, `expected one reload, got ${reloadCount()}`);
	});
});

Deno.test("a new version never reloads out from under a game in progress", async () => {
	await withFakeBrowser(async ({ fireUpdate, reloadCount }) => {
		const cancel = initServiceWorker({
			useServiceWorker: false,
			serviceWorkerVersion: "test",
			autoReloadOnUpdate: true,
			canReloadNow: () => false,
		});
		fireUpdate();
		await wait(7000);
		assert(reloadCount() === 0, `a live game was reloaded away (${reloadCount()} reloads)`);
		cancel();
	});
});

Deno.test("a held-back reload still happens once the game ends", async () => {
	await withFakeBrowser(async ({ fireUpdate, reloadCount }) => {
		let gameRunning = true;
		initServiceWorker({
			useServiceWorker: false,
			serviceWorkerVersion: "test",
			autoReloadOnUpdate: true,
			canReloadNow: () => gameRunning === false,
		});
		fireUpdate();
		await wait(4000);
		assert(reloadCount() === 0, "reloaded while the game was still running");

		gameRunning = false;
		await wait(4500);
		assert(reloadCount() === 1, `expected the reload to land once, got ${reloadCount()}`);
	});
});

Deno.test("with auto reload off, an update never reloads at all", async () => {
	await withFakeBrowser(async ({ fireUpdate, reloadCount }) => {
		const cancel = initServiceWorker({
			useServiceWorker: false,
			serviceWorkerVersion: "test",
			autoReloadOnUpdate: false,
			canReloadNow: () => true,
		});
		fireUpdate();
		await wait(4000);
		assert(reloadCount() === 0, `expected no reload, got ${reloadCount()}`);
		cancel();
	});
});
