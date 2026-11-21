/**
 * UI test (needs jsdom): round 1 — euro goal follows the real debt, compact header, current-goal card
 * (diamond), goals by year as expandable rows, windows close on outside click / Esc, glass button styles.
 * Usage: node tests/ui-round1.cjs [index.html]
 */
const { JSDOM } = require("jsdom");
const fs = require("fs"); const path = require("path");
const html = fs.readFileSync(process.argv[2] || path.join(__dirname, "..", "index.html"), "utf8");
let fails = 0; const check = (n, c, x) => { console.log((c ? "  ok   " : "  FAIL ") + n + (c ? "" : "  → " + x)); if (!c) fails++; };
const tick = ms => new Promise(r => setTimeout(r, ms));
const KEY = "fin_navigator_yuri_katarina_v4";
const norm = t => String(t).replace(/\u00a0|\u202f/g, " ").replace(/\s+/g, " ").trim();
const goal = (id, title, year, month, day, amount, extra) => ({ id, title, year, month, day, amount, currency: "RUB", category: "Быт и Ремонт", isMain: false, status: "Запланировано", addedBy: "Юрий", ...(extra || {}) });
const it = (type, name, amount) => ({ id: "i" + Math.random().toString(36).slice(2, 7), type, categoryName: name, amount });
async function boot(saved) {
  const errors = [], alerts = [];
  const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true, url: "https://example.test/finplane/",
    beforeParse(w) {
      w.addEventListener("error", e => errors.push(e.message));
      w.localStorage.setItem(KEY, JSON.stringify({ currentUser: "Юрий", ...saved }));
      w.fetch = () => Promise.reject(new TypeError("offline")); w.alert = m => alerts.push(String(m)); w.confirm = () => true; w.prompt = () => null; w.scrollTo = () => {};
      w.matchMedia = w.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
    } });
  dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded")); await tick(300);
  return { w: dom.window, d: dom.window.document, errors, alerts };
}
const stored = w => JSON.parse(w.localStorage.getItem(KEY));

(async () => {
  console.log("# euro debt goal follows the real debt");
  { const loans = [{ id: "l4", creditor: "Мама — Евро", currency: "EUR", initial: 1300, paid: 180, manual: 250, deadline: "" }, { id: "l3", creditor: "Мама — Рубли", currency: "RUB", initial: 230000, paid: 0, manual: 0, deadline: "" }];
    const goals = [goal("g12", "Закрытие валютного долга перед мамой (1 120 €)", 2027, "Ноябрь", 15, 1120, { currency: "EUR", category: "Долги", loanId: "l4" }),
      goal("g6", "Возврат 1-й части долга (100 000 ₽)", 2027, "Март", 15, 100000, { category: "Долги", loanId: "l3" }), goal("g11", "Полное закрытие рублёвого долга (130 000 ₽)", 2027, "Октябрь", 20, 130000, { category: "Долги", loanId: "l3" })];
    const { w, d, errors } = await boot({ goals, loans, budgetLogs: [{ id: "b1", date: "2026-10-26", user: "Юрий", mode: "income", income: 1000, items: [it("investment", "x", 1000)], totalExpenses: 0, investedRemainder: 1000, cashAdded: 0 }] });
    const g12 = stored(w).goals.find(g => g.id === "g12");
    check("the goal now asks for the real remaining debt: 870 €, not 1 120 €", g12.amount === 870 && g12.planAmount === 1120, JSON.stringify([g12.amount, g12.planAmount]));
    check("the amount in the goal title follows it", /\(870 €\)/.test(g12.title), g12.title);
    check("the loan card and the goal agree (1 300 − 430 = 870)", w.eval(`state.loans.find(l => l.id === "l4").initial - state.loans.find(l => l.id === "l4").paid`) === 870, "");
    check("goals of a debt without payments are untouched", stored(w).goals.find(g => g.id === "g6").amount === 100000 && stored(w).goals.find(g => g.id === "g11").amount === 130000, "");
    check("the change is queued for sync", stored(w).syncPending === true, "");
    w.eval(`state.loans.find(l => l.id === "l3").manual = 120000; renderAll();`);
    const a6 = w.eval(`state.goals.find(g => g.id === "g6").amount`), a11 = w.eval(`state.goals.find(g => g.id === "g11").amount`);
    check("a payment on a ruble debt reduces the EARLIEST goal first (120 000 → 0 + 110 000 left)", a6 === 0 && a11 === 110000, a6 + " / " + a11);
    w.eval(`state.loans.find(l => l.id === "l3").manual = 0; renderAll();`);
    check("undoing the payment restores the planned amounts", w.eval(`state.goals.find(g => g.id === "g6").amount`) === 100000 && w.eval(`state.goals.find(g => g.id === "g11").amount`) === 130000, "");
    check("no JavaScript errors", errors.length === 0, errors.join(" | "));
  }

  console.log("\n# header, glass, animations");
  { const { w, d, errors } = await boot({ goals: [goal("g1", "Цель", 2099, "Март", 5, 1000)], loans: [], budgetLogs: [] });
    const hdr = d.getElementById("appHeader");
    check("the header is a compact bar (id, reduced padding, title block marked for collapsing)", !!hdr && /py-1\.5/.test(hdr.className) && !!hdr.querySelector(".hdr-title"), hdr && hdr.className);
    w.scrollY = 120; w.dispatchEvent(new w.Event("scroll"));
    check("on scroll the title block is hidden (header shrinks)", hdr.classList.contains("hdr-scrolled"), "");
    w.scrollY = 0; w.dispatchEvent(new w.Event("scroll")); check("back at the top it returns", !hdr.classList.contains("hdr-scrolled"), "");
    check("the Google Table tab is hidden; a gear button opens the settings", d.getElementById("tabBtn-sync").style.display === "none" && !!d.getElementById("settingsBtn"), "");
    d.getElementById("settingsBtn").click(); await tick(30);
    check("the settings page opens", !d.getElementById("tab-sync").classList.contains("hidden") && /Сверка остатков/.test(d.getElementById("tab-sync").textContent), "");
    const css = [...d.querySelectorAll("style")].map(s => s.textContent).join("\n");
    check("glass buttons, press animation, page and window transitions are defined", /backdrop-filter: blur\(14px\)/.test(css) && /button:not\(:disabled\):active \{ transform: scale\(\.95\)/.test(css) && /@keyframes tabIn/.test(css) && /@keyframes popIn/.test(css) && /\.expand-wrap/.test(css), "");
    check("window panels are opaque (readable text)", /#budgetModal > div, #goalModal > div, #celebModal > div, #fpGoalModal > div \{ background-color: #ffffff !important/.test(css), "");
    check("no JavaScript errors", errors.length === 0, errors.join(" | "));
  }

  console.log("\n# current goal card");
  { const goals = [goal("g1", "Усилитель 4-канальный и медные провода OFC в Mercedes W124", 2026, "Ноябрь", 15, 7000, { category: "Авто и Участок" })];
    const mkLog = amt => ({ id: "b_a", date: "2026-11-16", user: "Юрий", mode: "income", income: amt, items: [it("investment", "LQDT", amt)], totalExpenses: 0, investedRemainder: amt, cashAdded: 0 });
    let { w, d } = await boot({ goals, loans: [], budgetLogs: [mkLog(10000)] });
    const card = d.getElementById("nextGoalCard");
    check("the goal is funded: the card shines like a diamond with a 💎 badge", card.classList.contains("goal-diamond") && /💎/.test(d.getElementById("nextGoalPercentBadge").textContent), card.className);
    check("the select and its label are one compact row (no vertical wrapping label)", !!d.getElementById("nextGoalSelector") && /Ближайшая цель/.test(card.textContent) && !/Выб\s*рать цель\s*:/.test(card.textContent), "");
    check("the purchase button is full-width and short", /Купили/.test(d.getElementById("markGoalDoneBtn").textContent) && /w-full/.test(d.getElementById("markGoalDoneBtn").className), d.getElementById("markGoalDoneBtn").textContent);
    ({ w, d } = await boot({ goals, loans: [], budgetLogs: [mkLog(3000)] }));
    check("not enough money: no diamond, shortfall shown", !d.getElementById("nextGoalCard").classList.contains("goal-diamond") && /Не хватает 4 000/.test(norm(d.getElementById("markGoalDoneBtn").textContent)), norm(d.getElementById("markGoalDoneBtn").textContent));
  }

  console.log("\n# goals by year: compact rows that expand");
  { const goals = [goal("g1", "Строительство сарайчика-техблока (освобождение 2-го этажа и ванной)", 2027, "Май", 15, 150000, { category: "Авто и Участок" }), goal("g2", "Авиабилеты в Германию", 2027, "Август", 10, 80000, { isMain: true, category: "Путешествия и Семья" })];
    const { w, d, errors } = await boot({ goals, loans: [], budgetLogs: [] });
    w.setYearFilter(2027); await tick(30);
    const rows = d.querySelectorAll("[data-goal-row]");
    check("each goal is one compact row", rows.length === 2, String(rows.length));
    const first = rows[0], wrap = first.querySelector(".expand-wrap");
    check("a row shows only the title and the fill bar; details are collapsed", !wrap.classList.contains("open") && /Строительство сарайчика/.test(first.querySelector("button").textContent) && /\d+%/.test(first.querySelector("button").textContent), "");
    first.querySelector("[data-goal-act=\"toggle\"]").click();
    check("tap expands with date, category, amount and actions", wrap.classList.contains("open") && /150 000/.test(norm(wrap.textContent)) && /Авто и Участок/.test(wrap.textContent) && /Копим/.test(wrap.textContent) && /Удалить/.test(wrap.textContent), norm(wrap.textContent));
    w.renderAll(); await tick(20);
    check("an opened row stays open after a re-render", d.querySelector("[data-goal-row] .expand-wrap").classList.contains("open"), "");
    check("no JavaScript errors", errors.length === 0, errors.join(" | "));
  }

  console.log("\n# windows close by outside click and Esc");
  { const { w, d, errors } = await boot({ goals: [goal("g1", "Цель", 2099, "Март", 5, 1000)], loans: [], budgetLogs: [] });
    const gm = d.getElementById("goalModal"), bm = d.getElementById("budgetModal");
    w.eval("openGoalModal ? openGoalModal(2099, 'Март') : null");
    const open = m => !m.classList.contains("hidden");
    check("the goal window opens", open(gm), gm.className);
    gm.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); await tick(20);
    check("click on the dark area outside closes it", !open(gm), gm.className);
    w.eval("openGoalModal(2099, 'Март')"); check("it opens again", open(gm), "");
    d.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await tick(20);
    check("Esc closes it", !open(gm), gm.className);
    w.eval("openBudgetModal('income')"); check("the budget window opens", open(bm), bm.className);
    const inner = bm.querySelector("div"); inner.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); await tick(10);
    check("a click INSIDE the window does not close it", open(bm), bm.className);
    d.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await tick(20);
    check("Esc closes the budget window", !open(bm), bm.className);
    check("no JavaScript errors", errors.length === 0, errors.join(" | "));
  }
  console.log(fails ? "\n" + fails + " FAILED" : "\nAll round-1 UI checks passed");
  process.exit(fails ? 1 : 0);
})();
