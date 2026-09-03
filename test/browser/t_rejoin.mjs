// Somebody's browser hiccups and they refresh, or they close the tab and open the link again.
// Their seat must come back to them -- their own cards, their own turn -- and the table must not
// be left waiting on a player who no longer exists.
import { rig, PORTS } from "./harness.mjs";

const r = await rig({ humans: 2, bots: 4, latencyMs: 0 });

// Keep the other seat playing so the game does not simply wait for everyone.
let running = true;
const other = r.seats[1];
(async () => {
  while (running) {
    try {
      const can = await other.page.evaluate(() => {
        const a = document.getElementById("action-button");
        return !!a && !a.classList.contains("hidden") && !a.disabled;
      });
      if (can) await other.page.click("#action-button", { timeout: 2000 }).catch(() => {});
    } catch { /* busy */ }
    await new Promise((res) => setTimeout(res, 300));
  }
})();

const target = r.seats[0];
const cardsOf = (page) => page.evaluate(() => {
  const own = Number(new URLSearchParams(location.search).get("seatIndex"));
  const seats = [...document.querySelectorAll(".seat")].filter((s) => !s.classList.contains("hidden"));
  const mine = seats.find((s) => [...s.querySelectorAll(".hole-cards img.card")]
    .some((i) => !/^[12]B\.svg$/.test((i.getAttribute("src") || "").split("/").pop())));
  return {
    own,
    cards: mine ? [...mine.querySelectorAll(".hole-cards img.card")].map((i) => (i.getAttribute("src") || "").split("/").pop()).join(",") : null,
    faceUpCount: seats.filter((s) => [...s.querySelectorAll(".hole-cards img.card")]
      .some((i) => !/^[12]B\.svg$/.test((i.getAttribute("src") || "").split("/").pop()))).length,
  };
});

await r.table.waitForTimeout(9000);
const before = await cardsOf(target.page);
console.log(`before reload: seat ${before.own} holds ${before.cards}, sees ${before.faceUpCount} hand(s)`);

// The refresh.
const reloadedAt = Date.now();
await target.page.reload({ waitUntil: "domcontentloaded" });
console.log("their laptop has been refreshed");

let after = null;
while (Date.now() - reloadedAt < 30000) {
  const now = await cardsOf(target.page).catch(() => null);
  if (now?.cards) { after = { ...now, afterMs: Date.now() - reloadedAt }; break; }
  await target.page.waitForTimeout(200);
}

// And can they still act when it is their turn?
let couldAct = false;
const actWait = Date.now();
while (Date.now() - actWait < 90000) {
  couldAct = await target.page.evaluate(() => {
    const a = document.getElementById("action-button");
    return !!a && !a.classList.contains("hidden") && !a.disabled;
  }).catch(() => false);
  if (couldAct) break;
  await target.page.waitForTimeout(300);
}
running = false;

console.log(`\ntheir seat came back: ${after ? `yes after ${after.afterMs}ms, holding ${after.cards}` : "NO"}`);
console.log(`same cards as before: ${after ? after.cards === before.cards : "n/a"}`);
console.log(`still only their own hand visible: ${after ? after.faceUpCount === 1 : "n/a"}`);
console.log(`they could act again on their turn: ${couldAct}`);
console.log(`page errors: ${r.errors.length ? [...new Set(r.errors)].slice(0, 2).join("; ") : "none"}`);

const ok = !!after && after.cards === before.cards && after.faceUpCount === 1 && couldAct;
console.log(ok ? "\nRESULT: a refresh costs them nothing" : "\nRESULT: FAILED");
await r.close();
process.exit(ok ? 0 : 1);
