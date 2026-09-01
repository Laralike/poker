// Does a whole game actually reach a champion? At real pace a six-handed tournament runs longer
// than a test can wait, so use the app's own speed mode, which zeroes every deliberate pause.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
const ROOT = "/home/user/poker";
const T = {
	".html": "text/html",
	".js": "text/javascript",
	".css": "text/css",
	".svg": "image/svg+xml",
	".png": "image/png",
	".json": "application/json",
};
const srv = http.createServer((q, r) => {
	const f = path.join(ROOT, decodeURIComponent(new URL(q.url, "http://x").pathname));
	if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
		r.writeHead(404);
		return r.end();
	}
	r.writeHead(200, { "Content-Type": T[path.extname(f)] ?? "text/plain" });
	fs.createReadStream(f).pipe(r);
});
await new Promise((r) => srv.listen(5500, "127.0.0.1", r));
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

let wins = 0, stalls = 0;
const allErrors = [];
for (let game = 0; game < 5; game++) {
	const p = await b.newPage({ viewport: { width: 1366, height: 768 } });
	p.on("pageerror", (e) => {
		if (!/ServiceWorker/.test(e.message)) allErrors.push(e.message);
	});
	await p.goto("http://127.0.0.1:5500/index.html?speedmode=1", { waitUntil: "domcontentloaded" });
	await p.waitForTimeout(700);
	for (let i = 0; i < 8; i++) {
		await p.click("#humans-decrement").catch(() => {});
		await p.waitForTimeout(40);
	}
	await p.click("#start-button");

	const t0 = Date.now();
	let done = false;
	while (Date.now() - t0 < 90000) {
		if (await p.evaluate(() => globalThis.poker?.gameFinished === true)) {
			done = true;
			break;
		}
		await p.waitForTimeout(150);
	}
	const secs = ((Date.now() - t0) / 1000).toFixed(1);
	if (done) {
		wins++;
		const champ = await p.evaluate(() =>
			(globalThis.poker?.players ?? []).filter((x) => x.chips > 0).map((x) => x.name)
		);
		console.log(`  game ${game + 1}: champion after ${secs}s — ${champ.join(", ")}`);
	} else {
		stalls++;
		console.log(`  game ${game + 1}: NO champion after ${secs}s`);
	}
	await p.close();
}
console.log(`\ngames that reached a champion: ${wins}/5`);
console.log(`games that stalled: ${stalls}`);
console.log(`page errors: ${allErrors.length ? [...new Set(allErrors)].slice(0, 3).join("; ") : "none"}`);
await b.close();
srv.close();
