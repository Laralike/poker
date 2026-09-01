// Shared rig: static server, API server, browser, and a table with N humans and M bots.
// Every device can be given a latency, because everything measured on localhost is a lie about
// what happens over a real connection to Render.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const ROOT = "/home/user/poker";
const TYPES = {
	".html": "text/html",
	".js": "text/javascript",
	".css": "text/css",
	".svg": "image/svg+xml",
	".png": "image/png",
	".json": "application/json",
};

export async function rig({ humans = 2, bots = 4, latencyMs = 0, viewport = { width: 1366, height: 768 } } = {}) {
	const srv = http.createServer((q, r) => {
		const f = path.join(ROOT, decodeURIComponent(new URL(q.url, "http://x").pathname));
		if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
			r.writeHead(404);
			return r.end();
		}
		r.writeHead(200, { "Content-Type": TYPES[path.extname(f)] ?? "text/plain" });
		fs.createReadStream(f).pipe(r);
	});
	await new Promise((r) => srv.listen(5500, "127.0.0.1", r));
	const api = spawn("node", ["api/main.js"], { cwd: ROOT, env: { ...process.env, PORT: "8010" }, stdio: "ignore" });
	await new Promise((r) => setTimeout(r, 3000));
	const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
	const errors = [];

	// Delay only the calls that cross to the table's server, the way a real connection would.
	async function addLatency(page) {
		if (latencyMs <= 0) return;
		await page.route("**/127.0.0.1:8010/**", async (route) => {
			await new Promise((r) => setTimeout(r, latencyMs));
			await route.continue();
		});
	}

	const table = await browser.newPage({ viewport });
	table.on("pageerror", (e) => {
		if (!/ServiceWorker/.test(e.message)) errors.push("table: " + e.message);
	});
	await addLatency(table);
	await table.goto("http://127.0.0.1:5500/index.html", { waitUntil: "domcontentloaded" });
	await table.waitForTimeout(900);

	// Dial the counters to the table we want. Humans and bots share the six seats: nudging the
	// humans counter converts a bot seat rather than adding one, so set the humans first and then
	// take the total down to size with the bots counter.
	const counts = () =>
		table.evaluate(() => ({
			humans: Number(document.getElementById("humans-count")?.textContent ?? 0),
			bots: Number(document.getElementById("bots-count")?.textContent ?? 0),
			seats: [...document.querySelectorAll(".seat")].filter((s) => !s.classList.contains("hidden")).length,
		}));
	for (let guard = 0; guard < 12; guard++) {
		const c = await counts();
		if (c.humans === humans) break;
		await table.click(c.humans > humans ? "#humans-decrement" : "#humans-increment").catch(() => {});
		await table.waitForTimeout(90);
	}
	for (let guard = 0; guard < 12; guard++) {
		const c = await counts();
		if (c.bots === bots) break;
		await table.click(c.bots > bots ? "#bots-decrement" : "#bots-increment").catch(() => {});
		await table.waitForTimeout(90);
	}
	const finalCounts = await counts();
	if (finalCounts.humans !== humans || finalCounts.bots !== bots) {
		throw new Error(`wanted ${humans} humans and ${bots} bots, got ${JSON.stringify(finalCounts)}`);
	}
	const seatCount = finalCounts.seats;

	await table.click("#start-button");
	await table.waitForTimeout(2500 + latencyMs * 4);

	let code = null;
	const seats = [];
	if (humans > 0) {
		code = await table.evaluate(() => document.getElementById("join-banner-code")?.textContent ?? null);
		if (!code) throw new Error("the table never showed a join code");
		// The table's first state push can be slow on a laggy link, so wait for it rather than
		// asking for the seat list before it exists.
		let listed = null;
		for (let attempt = 0; attempt < 40 && !listed; attempt++) {
			const res = await fetch(`http://127.0.0.1:8010/table?tableId=${code}`);
			if (res.ok) {
				listed = await res.json();
				break;
			}
			await new Promise((r) => setTimeout(r, 500));
		}
		if (!listed) throw new Error(`the table never published its seats (code ${code})`);
		const humanSeats = listed.seats.filter((s) => !s.isBot).map((s) => s.seatIndex);
		for (const i of humanSeats) {
			const p = await browser.newPage({ viewport: { width: 1280, height: 800 } });
			p.on("pageerror", (e) => {
				if (!/ServiceWorker/.test(e.message)) errors.push(`seat${i}: ` + e.message);
			});
			await addLatency(p);
			await p.goto(`http://127.0.0.1:5500/remoteTable.html?tableId=${code}&seatIndex=${i}`, {
				waitUntil: "domcontentloaded",
			});
			seats.push({ i, page: p });
		}
		await table.waitForTimeout(9000 + latencyMs * 10);
	}

	return {
		browser,
		table,
		seats,
		code,
		errors,
		seatCount,
		canAct: (s) =>
			s.page.evaluate(() => {
				const e = document.getElementById("action-button");
				return !!e && !e.classList.contains("hidden") && !e.disabled;
			}),
		canFold: (s) =>
			s.page.evaluate(() => {
				const e = document.getElementById("fold-button");
				return !!e && !e.classList.contains("hidden") && !e.disabled;
			}),
		ownNote: (s) => s.page.evaluate(() => document.getElementById("notification")?.textContent?.trim() ?? ""),
		close: async () => {
			await browser.close();
			srv.close();
			api.kill("SIGKILL");
		},
	};
}
