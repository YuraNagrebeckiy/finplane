/**
 * UI test (needs jsdom: npm install --no-save jsdom): overdue goals, automatic euro rate,
 * monthly forecast table layout, weekend places catalog and random choice.
 * Usage: node tests/ui-improvements.cjs [index.html]
 */
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const html = fs.readFileSync(process.argv[2] || path.join(__dirname, "..", "index.html"), "utf8");
let fails = 0; const check = (n, c, x) => { console.log((c ? "  ok   " : "  FAIL ") + n + (c ? "" : "  → " + x)); if (!c) fails++; };
const tick = ms => new Promise(r => setTimeout(r, ms));
const KEY = "fin_navigator_yuri_katarina_v4";
const goal = (id, title, year, month, day, amount) => ({ id, title, year, month, day, amount, currency: "RUB", category: "Другое", isMain: false, status: "Запланировано", addedBy: "Юрий" });

async function boot(saved, market) {
  const errors = [], alerts = [], fetched = [];
  const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true, url: "https://example.test/finplane/",
    beforeParse(w) {
      w.addEventListener("error", e => errors.push(e.message));
      if (saved) w.localStorage.setItem(KEY, JSON.stringify(saved));
      w.fetch = u => { u = String(u); fetched.push(u);
        if (market && /market=/.test(u)) return Promise.resolve({ ok: true, json: async () => market });
        return Promise.reject(new TypeError("offline")); };
      w.alert = m => alerts.push(String(m)); w.confirm = () => true; w.prompt = () => null; w.scrollTo = () => {};
      w.matchMedia = w.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
    } });
  dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded")); await tick(300);
  return { w: dom.window, d: dom.window.document, errors, alerts, fetched };
}
const stored = w => JSON.parse(w.localStorage.getItem(KEY));

(async () => {
  console.log("# overdue goals");
  { const saved = { currentUser: "Юрий", goals: [goal("gOld", "Старая цель", 2025, "Январь", 10, 5000), goal("gNew", "Будущая цель", 2099, "Март", 5, 3000)], loans: [], budgetLogs: [] };
    const { w, d, errors, alerts } = await boot(saved);
    const box = d.getElementById("overdueGoals");
    const cards = () => box.querySelectorAll("[data-og]");
    check("only the goal whose deadline has passed is offered", cards().length === 1 && /Старая цель/.test(box.textContent) && !/Будущая цель/.test(box.textContent), box.textContent.slice(0, 120));
    check("the card offers «confirm» and «move to» with a date field", !!box.querySelector('[data-og-act="done"]') && !!box.querySelector('[data-og-act="move"]') && !!box.querySelector("[data-og-date]"), "");
    check("it says how much is allocated and that money is not enough yet", /Выделено/.test(box.textContent) && /не хватает/.test(box.textContent), box.textContent);
    box.querySelector('[data-og-act="done"]').click(); await tick(20);
    check("«confirm» without enough money is refused with an explanation, nothing is written off", alerts.some(a => /не выделена полная сумма/.test(a)) && stored(w).goals.find(g => g.id === "gOld").status === "Запланировано", alerts.join(" | "));
    const input = box.querySelector("[data-og-date]");
    input.value = "2020-01-01"; box.querySelector('[data-og-act="move"]').click(); await tick(10);
    check("a date in the past is refused", alerts.some(a => /позже сегодняшнего/.test(a)) && cards().length === 1, alerts.join(" | "));
    box.querySelector('[data-og-act="plus30"]').click();
    const want = input.value;
    check("«+1 мес.» fills the date field with a date 30 days ahead", /^\d{4}-\d{2}-\d{2}$/.test(want) && new Date(want) > new Date(), want);
    input.value = "2027-02-20"; box.querySelector('[data-og-act="move"]').click(); await tick(20);
    const g = stored(w).goals.find(x => x.id === "gOld");
    check("«move» sets the goal to the chosen date", g.year === 2027 && g.month === "Февраль" && g.day === 20, JSON.stringify([g.year, g.month, g.day]));
    check("the card disappears after the move and the change is queued for Google sync", cards().length === 0 && stored(w).syncPending === true, String(cards().length));
    check("no JavaScript errors", errors.length === 0, errors.join(" | "));
  }

  console.log("\n# euro rate");
  { const market = { status: "ok", ageMinutes: 5, metrics: { eur_rub: { value: 101.25, date: "16.11.2026", mode: "auto" } } };
    const saved = { currentUser: "Юрий", eurRate: 93.72, webhookUrl: "https://script.google.com/macros/s/TEST/exec", goals: [goal("g", "Цель", 2099, "Март", 5, 1000)], loans: [], budgetLogs: [] };
    const { w, d, errors } = await boot(saved, market); await tick(200);
    const inp = d.getElementById("eurRateInput");
    check("the rate in the header cannot be typed in", inp.hasAttribute("readonly") && !inp.getAttribute("onchange"), inp.outerHTML.slice(0, 120));
    check("the rate comes from the market data table automatically", inp.value === "101.25" && stored(w).eurRate === 101.25, inp.value + " / " + stored(w).eurRate);
    check("the tooltip names the source and the date", /16\.11\.2026/.test(d.getElementById("eurRateBox").getAttribute("data-tooltip")) && /автоматически/.test(d.getElementById("eurRateBox").getAttribute("data-tooltip")), d.getElementById("eurRateBox").getAttribute("data-tooltip"));
    check("the rate is not synced as a manual edit", !w.eval("SYNC_FIELDS").includes("eurRate"), "");
    check("no JavaScript errors", errors.length === 0, errors.join(" | "));
  }

  console.log("\n# monthly forecast table");
  { const saved = { currentUser: "Юрий", goals: [goal("g1", "Очень длинное название цели для проверки переноса текста", 2027, "Март", 5, 150000)], loans: [], budgetLogs: [] };
    const { w, d, errors } = await boot(saved);
    w.switchTab("plan"); await tick(50);
    const table = d.getElementById("planMonthsBody").closest("table"), rows = d.querySelectorAll("#planMonthsBody tr");
    check("table has rows and a wide enough minimum width", rows.length > 0 && /min-w-\[1000px\]/.test(table.className), String(rows.length));
    const cells = rows[0].querySelectorAll("td");
    check("money and status cells never wrap (no stacked digits)", [0, 1, 2, 3, 5, 6].every(i => /whitespace-nowrap/.test(cells[i].className)), [...cells].map(c => /whitespace-nowrap/.test(c.className)).join());
    check("«what we buy» column has a minimum width and wraps whole words", /min-w-\[260px\]/.test(cells[4].className) && /break-words/.test(cells[4].className), cells[4].className);
    check("headers do not wrap", /whitespace-nowrap/.test(table.querySelector("thead").className), "");
    check("no JavaScript errors", errors.length === 0, errors.join(" | "));
  }

  console.log("\n# weekend places and random choice");
  { const { w, d, errors } = await boot({ currentUser: "Юрий", goals: [goal("g", "Цель", 2099, "Март", 5, 1000)], loans: [], budgetLogs: [] });
    const places = w.eval("PLACES"), ids = places.map(p => p[0]);
    check("catalog is larger (was 48)", places.length >= 70, String(places.length));
    check("all ids unique", new Set(ids).size === ids.length, "");
    const towns = ["Калининград", "Светлогорск", "Зеленоградск", "Балтийск", "Советск", "Черняховск", "Гусев", "Гвардейск", "Багратионовск", "Ладушкин", "Мамоново", "Правдинск", "Полесск", "Нестеров", "Неман", "Озёрск", "Славск", "Светлый", "Приморск", "Краснознаменск", "Гурьевск", "Пионерский"];
    const missing = towns.filter(t => !places.some(p => (p[1] + " " + p[2]).includes(t)));
    check("every town of the region is in the catalog (22 towns)", missing.length === 0, "missing: " + missing.join(", "));
    check("each new entry has valid duration, cost and type", places.every(p => ["f", "l"].includes(p[3]) && ["c", "p"].includes(p[4]) && ["hist", "food", "nature", "museum", "fun", "show", "active", "sea"].includes(p[5])), "");
    // random choice
    const unvisited0 = w.eval("allPlaces().length");
    w.eval(`state.visits = { c1: [{ date: "2026-01-01", note: "", by: "Юрий" }], k1: [{ date: "2026-01-01", note: "", by: "Юрий" }] }`);
    d.getElementById("tpTitle").value = "Мой каток"; d.getElementById("tpLoc").value = "Калининград"; d.getElementById("tpEnv").value = "in"; d.getElementById("tpSeason").value = "winter";
    w.addCustomPlace();
    const cp = w.eval("state.customPlaces[0]");
    check("conditions chosen in the form are stored with the new place", cp.env === "in" && JSON.stringify(cp.months) === "[11,12,1,2,3]", JSON.stringify(cp));
    const summer = { t: 22, wet: false, snow: false, wind: 5, month: 7 }, winter = { t: -2, wet: false, snow: true, wind: 5, month: 1 };
    check("a winter-only place is «not now» in summer and fine in winter", w.eval(`weatherScore(placeById("${cp.id}"), ${JSON.stringify(summer)})`) <= -3 && w.eval(`weatherScore(placeById("${cp.id}"), ${JSON.stringify(winter)})`) >= 1, "");
    const total = w.eval("allPlaces().length");
    check("the added place is part of the catalog", total === unvisited0 + 1, total + " vs " + unvisited0);
    const unvisited = total - 2, picked = [];
    for (let i = 0; i < unvisited; i++) { w.pickRandomTour(); picked.push(w.eval("state.suggestedPlaceIds[state.suggestedPlaceIds.length-1]")); }
    check("visited places never come up", !picked.includes("c1") && !picked.includes("k1"), picked.filter(x => x === "c1" || x === "k1").join());
    check("random choice walks through every unvisited place exactly once per round (new and old)", new Set(picked).size === unvisited && picked.includes(cp.id), new Set(picked).size + " of " + unvisited);
    w.eval(`state.visits["${cp.id}"] = [{ date: "2026-01-02", note: "", by: "Юрий" }]`);
    const after = []; for (let i = 0; i < 30; i++) { w.pickRandomTour(); after.push(w.eval("state.suggestedPlaceIds[state.suggestedPlaceIds.length-1]")); }
    check("a place marked as visited drops out of the draw", !after.includes(cp.id), "");
    const pool = w.eval("allPlaces().filter(p => !placeVisits(p.id).length)"), seen = new Set();
    for (let k = 0; k <= 200; k++) seen.add(w.pickWeightedPlace_(pool, summer, () => k / 200).id);
    check("the draw reaches many different places, not a fixed top-12", seen.size >= 25, String(seen.size));
    w.pickRandomTour();
    check("the list below shows all remaining places, not only twelve", d.querySelectorAll("#toursListContainer button").length > 12, String(d.querySelectorAll("#toursListContainer button").length));
    check("no JavaScript errors", errors.length === 0, errors.join(" | "));
  }
  console.log(fails ? "\n" + fails + " FAILED" : "\nAll UI improvement checks passed");
  process.exit(fails ? 1 : 0);
})();
