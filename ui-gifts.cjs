/**
 * UI test: runs the real index.html in jsdom and clicks through the start-up and the gift card.
 * Needs jsdom (not part of the app): npm install --no-save jsdom   Usage: node tests/ui-gifts.cjs [index.html]
 */
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const html = fs.readFileSync(process.argv[2] || path.join(__dirname, "..", "index.html"), "utf8");
const fetched = [];
const errors = [];
const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true, url: "https://example.test/finplane/",
  beforeParse(w) {
    w.addEventListener("error", e => errors.push("error: " + e.message));
    w.localStorage.setItem("fin_navigator_yuri_katarina_v4", JSON.stringify({ webhookUrl: "https://script.google.com/macros/s/TEST/exec" }));
    w.fetch = u => { fetched.push(String(u)); return Promise.reject(new TypeError("offline")); };
    w.alert = () => {}; w.confirm = () => true; w.scrollTo = () => {};
    w.matchMedia = w.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  } });
const w = dom.window, d = w.document;
let fails = 0; const check = (n, c, x) => { console.log((c ? "  ok   " : "  FAIL ") + n + (c ? "" : "  → " + x)); if (!c) fails++; };
const tick = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  d.dispatchEvent(new w.Event("DOMContentLoaded")); await tick(300);
  check("start-up runs to the end: the app asks the Table and the market data on open", fetched.some(u => /ts=1|exec\?t=/.test(u)) && fetched.some(u => /market=1/.test(u)), JSON.stringify(fetched));
  const panel = d.getElementById("giftPanel"), btn = d.getElementById("giftBtn");
  check("gift button and panel exist, panel closed", !!btn && !!panel && panel.classList.contains("hidden"), "");
  btn.click(); await tick(50);
  check("click opens the panel and creates the first list «Планы по подаркам»", !panel.classList.contains("hidden") && /Планы по подаркам/.test(panel.innerHTML) && d.querySelectorAll('[data-act="list-title"]').length === 1, panel.className);
  panel.querySelector('[data-act="add-item"]').click(); await tick(20);
  panel.querySelector('[data-act="add-item"]').click(); await tick(20);
  const rows = () => [...panel.querySelectorAll('[data-act="field"][data-field="name"]')];
  check("«＋ Добавить подарок» adds rows", rows().length === 2, String(rows().length));
  const type = (el, v) => { el.value = v; el.dispatchEvent(new w.Event("change", { bubbles: true })); };
  const r = n => ({ name: rows()[n], idea: panel.querySelectorAll('[data-field="idea"]')[n], amt: panel.querySelectorAll('[data-field="amount"]')[n] });
  type(r(0).name, "Мама"); type(r(0).idea, "плед"); type(r(0).amt, "3 000");
  type(r(1).name, "Папа"); type(r(1).idea, "<b>книга</b>"); type(r(1).amt, "1500,5");
  const tot = () => panel.querySelector("[data-totals]").textContent.replace(/\s|\u00a0/g, "");
  check("totals sum up under the list", /Всего:450[01]/.test(tot()) && /Осталось:450[01]/.test(tot()), tot());
  check("typed text stays in the fields after editing (no re-render that eats focus)", rows()[0].value === "Мама" && r(1).idea.value === "<b>книга</b>", "");
  panel.querySelector('[data-act="toggle"]').click(); await tick(20);
  const first = panel.querySelectorAll('[data-field="name"]')[0];
  check("tick «bought» strikes the row through and moves the sum to «Куплено»", /line-through/.test(first.className) && /Куплено:3000/.test(tot()) && /Осталось:150[01]/.test(tot()), first.className + " " + tot());
  check("text typed into fields is kept as text, never turned into HTML", !panel.querySelector("b") && panel.querySelectorAll('[data-field="idea"]')[1].value === "<b>книга</b>", "");
  const badge = d.getElementById("giftBtnBadge");
  check("badge on the button shows how many gifts are still to buy", badge.textContent === "1" && !badge.classList.contains("hidden"), badge.textContent);
  panel.querySelector('[data-act="new-list"]').click(); await tick(20);
  check("second list can be added and overall total appears", d.querySelectorAll('[data-act="list-title"]').length === 2 && !!d.getElementById("giftAllTotals"), "");
  const titles = d.querySelectorAll('[data-act="list-title"]'); type(titles[1], "День рождения");
  const saved = JSON.parse(w.localStorage.getItem("fin_navigator_yuri_katarina_v4"));
  check("everything is saved on the device (names, amounts, tick, titles)", saved.giftLists.length === 2 && saved.giftLists[1].title === "День рождения" && saved.giftItems.length === 2 && saved.giftItems[0].bought === true && saved.giftItems[1].amount === 1500.5, JSON.stringify(saved.giftItems));
  check("changes are queued for Google sync", saved.syncPending === true, String(saved.syncPending));
  panel.querySelector('[data-act="clear"]').click(); await tick(20);
  check("«Очистить» removes the rows but keeps the list", d.querySelectorAll('[data-act="field"]').length === 0 && d.querySelectorAll('[data-act="list-title"]').length === 2, "");
  panel.querySelector('[data-act="close"]').click(); await tick(10);
  check("✕ closes the panel", panel.classList.contains("hidden") && btn.getAttribute("aria-expanded") === "false", "");
  d.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape" }));
  check("no JavaScript errors during the whole session", errors.length === 0, errors.join(" | "));
  // reload from storage: data restored
  console.log(fails ? "\n" + fails + " FAILED" : "\nUI checks passed"); process.exit(fails ? 1 : 0);
})();
