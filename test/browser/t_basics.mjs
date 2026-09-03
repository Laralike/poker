// The things she reported at the very beginning, re-checked after roughly ten versions of change:
// does the table fit on screen, does joining by code work, is money shown in pounds, and does
// "raise to" mean what it says?
import { rig, PORTS } from "./harness.mjs";
import { chromium } from "playwright";

const problems = [];
const r = await rig({ humans: 2, bots: 4, latencyMs: 0 });

// ---- 1. Does everything fit, at the sizes people actually have? ----------------------------
const sizes = [
  { name: "small laptop  1280x720 ", width: 1280, height: 720 },
  { name: "common laptop 1366x768 ", width: 1366, height: 768 },
  { name: "macbook       1440x900 ", width: 1440, height: 900 },
  { name: "big screen    1920x1080", width: 1920, height: 1080 },
  { name: "phone          390x844 ", width: 390, height: 844 },
];
console.log("=== does it fit on screen? ===");
for (const size of sizes) {
  for (const [label, page] of [["shared table", r.table], ["a player's view", r.seats[0].page]]) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.waitForTimeout(700);
    const fit = await page.evaluate(() => ({
      scrollH: document.documentElement.scrollHeight,
      clientH: document.documentElement.clientHeight,
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    }));
    const vOver = fit.scrollH - fit.clientH;
    const hOver = fit.scrollW - fit.clientW;
    const ok = vOver <= 2 && hOver <= 2;
    console.log(`  ${size.name} ${label.padEnd(16)} ${ok ? "fits" : `NEEDS SCROLLING (${vOver}px down, ${hOver}px across)`}`);
    // The phone is expected to scroll vertically; a laptop is not.
    if (!ok && size.width >= 1280) problems.push(`${label} needs scrolling at ${size.width}x${size.height}: ${vOver}px down, ${hOver}px across`);
    if (hOver > 2) problems.push(`${label} scrolls sideways at ${size.width}x${size.height}`);
  }
}
await r.table.setViewportSize({ width: 1366, height: 768 });
await r.seats[0].page.setViewportSize({ width: 1280, height: 800 });

// ---- 2. Is money shown in pounds? -----------------------------------------------------------
const money = await r.table.evaluate(() => {
  const text = document.body.innerText;
  return {
    pounds: (text.match(/£/g) ?? []).length,
    dollars: (text.match(/\$/g) ?? []).length,
  };
});
console.log(`\n=== currency ===\n  £ signs on the shared table: ${money.pounds}, $ signs: ${money.dollars}`);
if (money.dollars > 0) problems.push(`dollar signs still showing (${money.dollars})`);

// ---- 3. Does "Raise to" mean raise TO that amount? -------------------------------------------
console.log(`\n=== what the raise button promises vs what happens ===`);
let raiseChecked = false;
for (let t = 0; t < 200 && !raiseChecked; t++) {
  for (const s of r.seats) {
    const can = await s.page.evaluate(() => {
      const a = document.getElementById("action-button");
      return !!a && !a.classList.contains("hidden") && !a.disabled;
    });
    if (!can) continue;
    // Nudge the amount up until the button offers a raise.
    for (let i = 0; i < 4; i++) {
      await s.page.click("#amount-increment-button", { timeout: 1500 }).catch(() => {});
      await s.page.waitForTimeout(120);
    }
    const label = await s.page.evaluate(() => document.getElementById("action-button")?.textContent?.trim() ?? "");
    const promised = Number((label.match(/£([\d,]+)/)?.[1] ?? "").replace(/,/g, ""));
    if (!/raise/i.test(label) || !promised) continue;

    const seatIndex = s.i;
    await s.page.click("#action-button", { timeout: 2500 }).catch(() => {});
    // What did that seat actually end up having put in this round?
    let actual = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 12000) {
      actual = await r.table.evaluate((idx) => {
        const p = (globalThis.poker?.players ?? []).find((x) => x.seatIndex === idx);
        return p ? p.roundBet ?? null : null;
      }, seatIndex);
      if (actual === promised) break;
      await r.table.waitForTimeout(150);
    }
    console.log(`  button said "${label}" — that seat's total in this round became £${actual}`);
    if (actual !== promised) problems.push(`"${label}" but the seat's round total became ${actual}, not ${promised}`);
    raiseChecked = true;
    break;
  }
  await r.table.waitForTimeout(400);
}
if (!raiseChecked) console.log("  (no raise opportunity came up in the window — not a failure, but unverified)");

// ---- 4. Joining by code, from a laptop that has never seen the table ------------------------
console.log(`\n=== joining by typing the code ===`);
const browser2 = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const newcomer = await browser2.newPage({ viewport: { width: 1280, height: 800 } });
const joinErrors = [];
newcomer.on("pageerror", (e) => { if (!/ServiceWorker/.test(e.message)) joinErrors.push(e.message); });
await newcomer.goto(`http://127.0.0.1:${PORTS.site}/join.html`, { waitUntil: "domcontentloaded" });
await newcomer.waitForTimeout(600);
await newcomer.fill("#table-code", r.code);
await newcomer.click("#join-lookup-button");
await newcomer.waitForTimeout(2500);
const offered = await newcomer.evaluate(() => ({
  status: document.getElementById("join-status")?.textContent?.trim() ?? "",
  seats: [...document.querySelectorAll(".join-seat")].map((b) => b.textContent.trim()),
}));
console.log(`  typed the code: "${offered.status}"`);
console.log(`  seats offered: ${JSON.stringify(offered.seats)}`);
if (offered.seats.length === 0) problems.push("typing the code offered no seats to sit in");

// And a wrong code should say so rather than hang.
const bad = await browser2.newPage();
await bad.goto(`http://127.0.0.1:${PORTS.site}/join.html`, { waitUntil: "domcontentloaded" });
await bad.waitForTimeout(400);
await bad.fill("#table-code", "nosuchtable");
await bad.click("#join-lookup-button");
await bad.waitForTimeout(2500);
const badMsg = await bad.evaluate(() => document.getElementById("join-status")?.textContent?.trim() ?? "");
console.log(`  a wrong code says: "${badMsg}"`);
if (!badMsg || /^\s*$/.test(badMsg)) problems.push("a wrong code says nothing at all");
if (joinErrors.length) problems.push(`join page errors: ${joinErrors.slice(0, 2).join("; ")}`);

console.log(`\npage errors: ${r.errors.length ? [...new Set(r.errors)].slice(0, 3).join("; ") : "none"}`);
console.log(problems.length === 0 ? `\nRESULT: basics all still good` : `\nRESULT: ${problems.length} PROBLEMS\n  ${problems.join("\n  ")}`);
await browser2.close();
await r.close();
process.exit(problems.length === 0 && r.errors.length === 0 ? 0 : 1);
