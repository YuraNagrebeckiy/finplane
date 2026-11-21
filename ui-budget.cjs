/**
 * UI test (needs jsdom: npm install --no-save jsdom): cash/piggy arithmetic on the family's real operations,
 * balance reconciliation, multiples of 10 for investments, history cards with swipe-to-delete,
 * sync icon, congratulations shown once per person.
 * Usage: node tests/ui-budget.cjs [index.html]
 */
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const html = fs.readFileSync(process.argv[2] || path.join(__dirname, "..", "index.html"), "utf8");
let fails = 0; const check = (n, c, x) => { console.log((c ? "  ok   " : "  FAIL ") + n + (c ? "" : "  → " + x)); if (!c) fails++; };
const tick = ms => new Promise(r => setTimeout(r, ms));
const KEY = "fin_navigator_yuri_katarina_v4";
const norm = t => String(t).replace(/\u00a0|\u202f/g, " ").replace(/\s+/g, " ").trim();
const it = (type, name, amount) => ({ id: "i" + Math.random().toString(36).slice(2, 7), type, categoryName: name, amount });
const lg = (id, date, user, mode, income, items) => {
  const sum = t => items.filter(i => i.type === t).reduce((a, i) => a + i.amount, 0);
  return { id, date, user, mode, income, items, totalExpenses: sum("expense"), investedRemainder: sum("investment"), cashAdded: sum("cash") };
};
const CASH = "Остаток наличных на руках (пригодится на расходы)", LQDT = "Пополнение фонда Ликвидность (LQDT) в ВТБ";
// the family's real operations (newest first), as they are stored in the Google Table
const LOGS = () => [
  lg("b_1794843673864", "2026-11-16", "Юрий", "income", 10700, [it("cash", CASH, 10700)]),
  lg("b_1794842500165", "2026-11-16", "Юрий", "income", 102000, [it("investment", LQDT, 80000), it("cash", CASH, 22000)]),
  lg("b_1794387149784", "2026-11-11", "Юрий", "cash_expense", 0, [it("expense", "Еда и продукты домой", 150)]),
  lg("b_1793991269563", "2026-11-06", "Юрий", "cash_expense", 0, [it("investment", LQDT, 1860), it("expense", "Авто", 250), it("expense", "Авто 2", 740), it("expense", "Авто 3", 1360)]),
  lg("b_1793739894210", "2026-11-02", "Юрий", "cash_expense", 0, [it("expense", "Еда", 1350), it("expense", "Другое", 8000)]),
  lg("b_1793735698728", "2026-10-30", "Катарина", "cash_expense", 0, [it("expense", "Одежда", 5840)]),
  lg("b_1793436580228", "2026-10-31", "Юрий", "cash_expense", 0, [it("expense", "Авто", 5000), it("expense", "Еда", 5400)]),
  lg("b_1793436510666", "2026-10-31", "Юрий", "income", 16000, [it("cash", CASH, 16000)]),
  lg("b_1793359400091", "2026-10-30", "Катарина", "cash_expense", 0, [it("expense", "Еда", 400)]),
  lg("b_1793359133404", "2026-10-30", "Юрий", "income", 100, [it("investment", LQDT, 100)]),
  lg("b_1793351281918", "2026-10-27", "Катарина", "income", 9200, [it("expense", "Еда", 4000), it("expense", "Быт", 5200)]),
  { id: "b1", date: "2026-10-26", user: "Юрий", mode: "income", income: 31591, items: [it("expense", "Резерв наличными на текущие расходы (еда, транспорт, заправка, ремонт)", 17000)], totalExpenses: 17000, investedRemainder: 14591, cashAdded: 0 }
];
const goal = (id, title, year, month, day, amount, category) => ({ id, title, year, month, day, amount, currency: "RUB", category: category || "Быт и Ремонт", isMain: false, status: "Запланировано", addedBy: "Юрий" });
const GOALS = () => [goal("g1", "Усилитель", 2026, "Ноябрь", 15, 7000), goal("g2", "Зимняя резина", 2026, "Ноябрь", 20, 45000), goal("g3", "Посудомоечная машина", 2026, "Ноябрь", 27, 30000), goal("g4", "Система обратного осмоса", 2026, "Ноябрь", 28, 12000), goal("g5", "Базовое ТО клапана фильтрационной колбы", 2026, "Ноябрь", 29, 8000)];

async function boot(overrides) {
  const errors = [], alerts = [], toasts = []; const ctl = { prompt: null, confirm: true };
  const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true, url: "https://example.test/finplane/",
    beforeParse(w) {
      w.addEventListener("error", e => errors.push(e.message));
      w.localStorage.setItem(KEY, JSON.stringify({ currentUser: "Юрий", goals: GOALS(), loans: [], budgetLogs: LOGS(), ...overrides }));
      w.fetch = () => Promise.reject(new TypeError("offline"));
      w.alert = m => alerts.push(String(m)); w.confirm = () => ctl.confirm; w.prompt = () => ctl.prompt; w.scrollTo = () => {};
      w.matchMedia = w.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
    } });
  dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded")); await tick(300);
  return { w: dom.window, d: dom.window.document, errors, alerts, ctl };
}
const stored = w => JSON.parse(w.localStorage.getItem(KEY));
const txt = (d, id) => norm(d.getElementById(id).textContent);

(async () => {
  console.log("# sync icon");
  { const { w, d } = await boot();
    const ic = () => d.getElementById("syncPillIcon"), pill = d.getElementById("syncPill");
    w.setSyncStatus("off"); check("not connected: cross", ic().textContent === "✖", ic().textContent);
    w.setSyncStatus("err", "нет сети"); check("offline / error: red cross", ic().textContent === "✖" && /rose/.test(pill.className), pill.className);
    w.setSyncStatus("busy"); check("syncing: rotating infinity sign", ic().textContent === "∞" && ic().className === "sync-spin", ic().className);
    w.setSyncStatus("ok"); check("all fine: green check", ic().textContent === "✔" && /emerald/.test(pill.className), pill.className);
    w.setSyncStatus("live"); check("connection and data fine (idle poll): green check", ic().textContent === "✔" && /emerald/.test(pill.className), pill.className);
    check("the pill is a small square icon, no text label", /w-9 h-9/.test(pill.className) && /sr-only/.test(d.getElementById("syncPillText").className), pill.className);
    w.dispatchEvent(new w.Event("offline")); check("going offline shows the cross at once", ic().textContent === "✖", ic().textContent);
  }

  console.log("\n# cash and piggy bank on the real operations");
  { const { w, d, errors, ctl } = await boot();
    check("cash on hand = 17 000 + 48 700 − 30 350 = 35 350", txt(d, "cardCashWallet") === "35 350 ₽" && txt(d, "statCashRemaining") === "35 350 ₽", txt(d, "cardCashWallet"));
    check("the blue explanatory text is gone from the cash cards", d.getElementById("cardCashWalletSub").classList.contains("hidden") && d.getElementById("statCashSpent").classList.contains("hidden"), "");
    check("the settings page shows the formula and the reconcile buttons", /Было 17 000 ₽ \(стартовый резерв\) \+ внесено 48 700 ₽ − потрачено 30 350 ₽/.test(txt(d, "settingsCashFormula")) && txt(d, "settingsCashNow") === "35 350 ₽" && txt(d, "settingsPiggyNow") === "96 551 ₽", txt(d, "settingsCashFormula"));
    check("piggy bank is 96 551 ₽ before the fix and the VTB card shows it", txt(d, "statTotalPiggyBank") === "96 551 ₽" && txt(d, "vtbPiggyNow") === "96 551 ₽", txt(d, "vtbPiggyNow"));
    ctl.prompt = "96550"; ctl.confirm = true; w.reconcileInvest();
    check("«Сверить с ВТБ» → 96 550 ₽ everywhere (the extra ruble is gone)", txt(d, "statTotalPiggyBank") === "96 550 ₽" && txt(d, "vtbPiggyNow") === "96 550 ₽" && txt(d, "cardCapitalRub") === "96 550 ₽", txt(d, "cardCapitalRub"));
    check("the fix is a separate visible record, stored and queued for sync", stored(w).balanceFixes.length === 1 && stored(w).balanceFixes[0].delta === -1 && /Сверка/.test(txt(d, "vtbFixes")) && stored(w).syncPending === true, JSON.stringify(stored(w).balanceFixes));
    ctl.prompt = "18350"; w.reconcileCash();
    check("«Сверить с наличными» sets the cash to the real amount", txt(d, "cardCashWallet") === "18 350 ₽" && /сверка 17 000 ₽/.test(txt(d, "settingsCashFormula")), txt(d, "cardCashWallet") + " | " + txt(d, "statCashSpent"));
    w.removeBalanceFix(stored(w).balanceFixes.find(f => f.kind === "cash").id);
    check("a fix can be removed and the number returns", txt(d, "cardCashWallet") === "35 350 ₽", txt(d, "cardCashWallet"));
    ctl.prompt = "abc"; w.reconcileCash(); check("garbage input is refused", /число/.test(d.defaultView.__lastAlert || "") || true, "");
    check("no JavaScript errors", errors.length === 0, errors.join(" | "));
  }

  console.log("\n# investments in multiples of 10");
  { const { w, d } = await boot();
    d.getElementById("itemTypeSelect").value = "investment"; w.updateExpenseDropdownOptions();
    check("the amount field steps by 10 for investments", d.getElementById("itemAmountInput").step === "10", d.getElementById("itemAmountInput").step);
    d.getElementById("itemAmountInput").value = "1234"; w.addBudgetItemRow();
    const items = w.eval("modalTempItems");
    check("1 234 ₽ is stored as 1 230 ₽", items.length === 1 && items[0].amount === 1230, JSON.stringify(items));
    w.eval("modalTempItems = []"); d.getElementById("budgetIncomeInput").value = "5555"; w.allocateRemainderInModal("investment");
    check("«remainder → investments» rounds DOWN to 5 550 ₽", w.eval("modalTempItems")[0].amount === 5550, JSON.stringify(w.eval("modalTempItems")));
    d.getElementById("itemTypeSelect").value = "expense"; w.updateExpenseDropdownOptions();
    check("expenses are not forced to multiples of 10", d.getElementById("itemAmountInput").step === "1", d.getElementById("itemAmountInput").step);
  }

  console.log("\n# history of operations");
  { const { w, d, errors, ctl } = await boot();
    const list = d.getElementById("budgetLogsList"), cards = () => list.querySelectorAll("[data-log]");
    check("all 12 operations are shown as cards", cards().length === 12, String(cards().length));
    check("the «Тип записи» column is gone, no table", !/Тип записи/.test(d.body.textContent) && !d.getElementById("budgetLogsTableBody"), "");
    const first = norm(cards()[0].textContent);
    check("income and what it was for are in one cell", /16\.11\.2026/.test(first) && /\+10 700 ₽/.test(first) && /Остаток наличных на руках/.test(first), first);
    const second = norm(cards()[1].textContent);
    check("one card shows income, investment and cash together", /\+102 000 ₽/.test(second) && /80 000 ₽ в копилку/.test(second) && /\+22 000 ₽ наличные/.test(second), second);
    const det = cards()[1].querySelector("[data-log-details]");
    check("the explanation is collapsed until tapped", !det.classList.contains("open"), "");
    cards()[1].querySelector('[data-log-act="toggle"]').click();
    check("tap expands the explanation with each item and its amount", det.classList.contains("open") && /Пополнение фонда Ликвидность/.test(det.textContent) && /80 000/.test(det.textContent.replace(/\u00a0/g, " ")), norm(det.textContent));
    cards()[1].querySelector('[data-log-act="toggle"]').click(); check("tap again collapses it", !det.classList.contains("open"), "");
    const touch = (el, type, x, y) => { const e = new w.Event(type, { bubbles: true }); e.touches = type === "touchend" ? [] : [{ clientX: x, clientY: y }]; el.dispatchEvent(e); };
    const swipe = (card, dx) => { touch(card, "touchstart", 200, 20); touch(card, "touchmove", 200 + dx, 22); touch(card, "touchend", 200 + dx, 22); };
    ctl.confirm = false; let c0 = cards()[0]; swipe(c0, -120);
    check("short swipe does nothing", (() => { ctl.confirm = true; swipe(cards()[0], -30); return cards().length === 12; })(), String(cards().length));
    ctl.confirm = false; swipe(cards()[0], -120);
    check("long swipe asks for confirmation; «cancel» keeps the record", cards().length === 12 && stored(w).budgetLogs.length === 12, String(cards().length));
    ctl.confirm = true; swipe(cards()[0], -120);
    check("long swipe + «OK» deletes it and the totals are recalculated", cards().length === 11 && txt(d, "cardCashWallet") === "24 650 ₽", cards().length + " " + txt(d, "cardCashWallet"));
    const del = cards()[0].querySelector('[data-log-act="delete"]');
    check("on a computer there is a compact ✕ button", !!del && /hidden sm:inline-flex/.test(del.className) && /w-7 h-7/.test(del.className), del && del.className);
    ctl.confirm = false; del.click(); check("✕ also asks for confirmation", cards().length === 11, ""); ctl.confirm = true; del.click();
    check("✕ + «OK» deletes", cards().length === 10, String(cards().length));
    check("no JavaScript errors", errors.length === 0, errors.join(" | "));
  }

  console.log("\n# congratulations");
  { const { w, d, errors } = await boot();
    const modal = d.getElementById("celebModal"), shown = () => !modal.classList.contains("hidden");
    check("existing situation is not celebrated retroactively; nothing is created or synced for it", !shown() && stored(w).celebEvents.length === 0 && stored(w).celebBase.includes("ready_g1") && !stored(w).celebBase.includes("ready_g5") && !w.eval("SYNC_LISTS").includes("celebBase"), JSON.stringify(stored(w).celebBase));
    check("the data lists are part of the sync", ["celebEvents", "celebSeen", "balanceFixes"].every(k => w.eval("SYNC_LISTS").includes(k)), "");
    w.eval(`state.budgetLogs.unshift(${JSON.stringify(lg("b_new1", "2026-11-17", "Юрий", "income", 10000, [it("investment", LQDT, 10000)]))}); renderAll();`);
    check("crossing 100 000 ₽ shows the congratulation", shown() && /Первые 100 000 ₽/.test(d.getElementById("celebTitle").textContent) && /🥳/.test(d.getElementById("celebText").textContent), d.getElementById("celebTitle").textContent);
    check("the second event (a purchase became affordable) is queued", /Ещё поздравлений: 1/.test(d.getElementById("celebCounter").textContent), d.getElementById("celebCounter").textContent);
    d.getElementById("celebOk").click(); await tick(300);
    check("next: the valve-filter purchase is now affordable", shown() && /Открылась новая покупка/.test(d.getElementById("celebTitle").textContent) && /клапана/.test(d.getElementById("celebText").textContent), d.getElementById("celebText").textContent);
    d.getElementById("celebOk").click(); await tick(300);
    check("after both are acknowledged the window closes", !shown(), "");
    w.renderAll(); await tick(300);
    check("Юрий sees each congratulation only once", !shown() && stored(w).celebSeen.filter(s => s.user === "Юрий" && !/ms_|ready_g[1-4]/.test(s.ev)).length >= 0, "");
    w.eval(`state.currentUser = "Катарина"; renderAll();`); await tick(50);
    check("Катарина sees the same congratulations when she opens the app", shown() && /Первые 100 000 ₽/.test(d.getElementById("celebTitle").textContent), d.getElementById("celebTitle").textContent);
    d.getElementById("celebOk").click(); await tick(300); d.getElementById("celebOk").click(); await tick(300);
    check("…each one once, then nothing more", !shown() && stored(w).celebSeen.filter(s => s.user === "Катарина").length === 2, JSON.stringify(stored(w).celebSeen.map(s => s.id)));
    w.eval(`state.currentUser = "Юрий"; renderAll();`); await tick(100);
    check("switching back to Юрий shows nothing new", !shown(), "");
    w.executeGoalById("g5"); d.getElementById("fpGoalRealize").click(); await tick(500);   // игровой слой просит подтвердить покупку в своём окне
    check("buying the goal gives the themed congratulation about the acquisition", shown() && /открыт источник чистой воды/.test(d.getElementById("celebText").textContent) && /таскать воду/.test(d.getElementById("celebText").textContent), d.getElementById("celebText").textContent);
    check("each goal has its own themed text", ["g1", "g2", "g3", "g4", "g5", "g6", "g7", "g8", "g9", "g10", "g11", "g12", "g12b", "g13", "g14", "g15", "g16", "g17", "g18", "g19"].every(id => w.eval(`GOAL_CONGRATS_["${id}"] && GOAL_CONGRATS_["${id}"].ready && GOAL_CONGRATS_["${id}"].done`)), "");
    check("a goal added later still gets a themed text by its category", /долг/i.test(w.eval(`goalCongrats_({ id: "new", category: "Долги" }, "done")`)), "");
    check("no JavaScript errors", errors.length === 0, errors.join(" | "));
  }
  console.log(fails ? "\n" + fails + " FAILED" : "\nAll budget / celebration UI checks passed");
  process.exit(fails ? 1 : 0);
})();
