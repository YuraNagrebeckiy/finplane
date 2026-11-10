/**
 * End-to-end multi-device sync tests.
 * Runs the real client code from index.html on several fake browsers (virtual clock, own storage,
 * own clock skew) against the real Code.gs running on the in-memory Apps Script mock.
 * Usage: node tests/sync-e2e.cjs [index.html] [Code.gs]
 */
const path = require("node:path");
const { createWorld } = require("./client-harness.cjs");
const { log, goal, loan } = require("./gas-mock.cjs");
const html = process.argv[2] || path.join(__dirname, "..", "index.html");
const srv = process.argv[3] || path.join(__dirname, "..", "Code.gs");
let failed = 0;
const check = (name, cond, detail) => { console.log((cond ? "  ok   " : "  FAIL ") + name + (cond ? "" : "  → " + detail)); if (!cond) failed++; };
const S = 1000;
const REAL = () => ({ goals: [goal("gA", "Реальная цель A"), goal("gB", "Реальная цель B")], loans: [loan("lR", "Реальный заём")], budgetLogs: [log("b_real1", "2026-11-01", 100000)] });
const mk = () => { const w = createWorld({ htmlPath: html, serverPath: srv }); w.backend.post({ ...REAL(), updatedAt: w.clock.now - 3600000 }); return w; };
const ids = (w, k) => (w.backend.state()[k] || []).map(x => x.id).sort().join(",");
const localIds = (d, k) => d.local()[k].map(x => x.id).sort().join(",");
const addLog = (id, amt) => s => s.budgetLogs.unshift(log(id, "2026-11-09", amt || 1));
const statusText = d => d.document.getElementById("syncStatusMessage").textContent;

(async () => {
  console.log("client:", html, "\nserver:", srv);

  { console.log("\n# basics");
    const w = mk(); const A = w.device("A"); await A.start(); await w.clock.advance(5 * S);
    check("new device loads family data from the Table", localIds(A, "goals") === "gA,gB" && localIds(A, "budgetLogs") === "b_real1", localIds(A, "goals"));
    const g0 = A.fullGets, p0 = A.posts, t0 = A.gets;
    await w.clock.advance(10 * 60 * S);
    check("idle device: no uploads, no re-downloads, ~1 cheap poll per 25 s", A.posts === p0 && A.fullGets === g0 && (A.gets - t0) >= 22 && (A.gets - t0) <= 26, "posts+" + (A.posts - p0) + " full+" + (A.fullGets - g0) + " polls+" + (A.gets - t0));
    A.edit(addLog("b_a1", 500)); const r0 = A.renders, f0 = A.fullGets;
    await w.clock.advance(120 * S);
    check("own edit saved, confirmed, and NOT re-downloaded/re-rendered", ids(w, "budgetLogs").includes("b_a1") && A.fullGets === f0 && A.renders === r0 && /подтвердила/.test(statusText(A)), "full+" + (A.fullGets - f0) + " renders+" + (A.renders - r0) + " " + statusText(A));
    check("no pending changes left on the device", A.local().syncPending === false, String(A.local().syncPending));
  }

  { console.log("\n# propagation time (worst case over start phases)");
    let worst = 0;
    for (const phase of [0, 3, 6, 9, 12, 15, 18, 21, 24]) {
      const w = mk(); const A = w.device("A"), B = w.device("B");
      await A.start(); await B.start(); await w.clock.advance((7 + phase) * S);
      const t0 = w.clock.now; A.edit(addLog("b_a" + phase, 5));
      let seen = -1; for (let i = 0; i < 100 && seen < 0; i++) { await w.clock.advance(S / 2); if (localIds(B, "budgetLogs").includes("b_a" + phase)) seen = (w.clock.now - t0) / S; }
      worst = Math.max(worst, seen < 0 ? 999 : seen);
    }
    check("A → B within 30 s in every phase (worst measured " + worst + " s, latencies 0.7 s GET / 2.5 s POST)", worst <= 30, "worst=" + worst);
  }

  { console.log("\n# two devices editing at the same time");
    const w = mk(); const A = w.device("A"), B = w.device("B"); await A.start(); await B.start(); await w.clock.advance(5 * S);
    A.edit(addLog("b_a1", 111)); await w.clock.advance(4 * S); B.edit(addLog("b_b1", 222)); await w.clock.advance(90 * S);
    check("both records kept on the server", ids(w, "budgetLogs") === "b_a1,b_b1,b_real1", ids(w, "budgetLogs"));
    check("both devices end up identical", localIds(A, "budgetLogs") === localIds(B, "budgetLogs") && localIds(A, "budgetLogs") === "b_a1,b_b1,b_real1", localIds(A, "budgetLogs") + " | " + localIds(B, "budgetLogs"));
    check("nothing left pending, no endless re-sending", !A.local().syncPending && !B.local().syncPending && A.posts + B.posts <= 6, "posts " + A.posts + "+" + B.posts);

    const w2 = mk(); const A2 = w2.device("A"), B2 = w2.device("B"); await A2.start(); await B2.start(); await w2.clock.advance(5 * S);
    A2.edit(s => { s.goals.find(g => g.id === "gA").status = "Выполнено"; }); await w2.clock.advance(3 * S);
    B2.edit(s => { s.goals.find(g => g.id === "gB").amount = 777; }); await w2.clock.advance(90 * S);
    const sg = w2.backend.state().goals;
    check("A's edit of one goal and B's edit of another both survive", sg.find(g => g.id === "gA").status === "Выполнено" && sg.find(g => g.id === "gB").amount === 777, JSON.stringify(sg.map(g => [g.id, g.status, g.amount])));
    check("devices identical after goal edits", JSON.stringify(A2.local().goals) === JSON.stringify(B2.local().goals), "");
  }

  { console.log("\n# deletions");
    const w = mk(); const A = w.device("A"), B = w.device("B"); await A.start(); await B.start(); await w.clock.advance(5 * S);
    A.edit(s => { s.goals = s.goals.filter(g => g.id !== "gA"); }); await w.clock.advance(60 * S);
    check("deletion on A reaches server and B", ids(w, "goals") === "gB" && localIds(B, "goals") === "gB", ids(w, "goals") + " | " + localIds(B, "goals"));
    // B is offline, A deletes gB, B adds a goal offline, B returns
    const w2 = mk(); const A2 = w2.device("A"), B2 = w2.device("B"); await A2.start(); await B2.start(); await w2.clock.advance(5 * S);
    B2.offline = true; B2.edit(s => s.goals.push(goal("gNew", "Новая с B")));
    A2.edit(s => { s.goals = s.goals.filter(g => g.id !== "gB"); }); await w2.clock.advance(40 * S);
    B2.offline = false; await w2.clock.advance(120 * S);
    check("offline add on B + online delete on A: add kept, delete not undone", ids(w2, "goals") === "gA,gNew" && localIds(B2, "goals") === "gA,gNew" && localIds(A2, "goals") === "gA,gNew", ids(w2, "goals") + " | B=" + localIds(B2, "goals") + " | A=" + localIds(A2, "goals"));
    // quick add → delete → add on the same device
    const w3 = mk(); const A3 = w3.device("A"); await A3.start(); await w3.clock.advance(5 * S);
    A3.edit(addLog("b_x", 1)); await w3.clock.advance(1 * S);
    A3.edit(s => { s.budgetLogs = s.budgetLogs.filter(x => x.id !== "b_x"); }); await w3.clock.advance(1 * S);
    A3.edit(addLog("b_y", 2)); await w3.clock.advance(90 * S);
    check("rapid add / delete / add on one device ends exactly right", ids(w3, "budgetLogs") === "b_real1,b_y", ids(w3, "budgetLogs"));
  }

  { console.log("\n# network trouble");
    const w = mk(); const A = w.device("A"); await A.start(); await w.clock.advance(5 * S);
    w.postFailures = 2; A.edit(addLog("b_a1", 1)); await w.clock.advance(120 * S);
    check("saved after two failed uploads", ids(w, "budgetLogs").includes("b_a1") && !A.local().syncPending, ids(w, "budgetLogs") + " pending=" + A.local().syncPending);
    const w2 = mk(); const A2 = w2.device("A"); await A2.start(); await w2.clock.advance(5 * S);
    A2.offline = true; A2.edit(addLog("b_off", 1)); await w2.clock.advance(20 * S);
    await A2.reload(); A2.offline = true; await w2.clock.advance(20 * S); A2.offline = false; await w2.clock.advance(90 * S);
    check("edit made offline survives reload and is sent when online", ids(w2, "budgetLogs").includes("b_off") && !A2.local().syncPending, ids(w2, "budgetLogs"));
    const w3 = mk(); const A3 = w3.device("A"); await A3.start(); await w3.clock.advance(5 * S);
    w3.outage = true; A3.edit(addLog("b_o2", 1)); await w3.clock.advance(60 * S);
    check("during outage: error shown, data kept locally", /Ошибка/.test(statusText(A3)) && localIds(A3, "budgetLogs").includes("b_o2"), statusText(A3));
    w3.outage = false; await w3.clock.advance(90 * S);
    check("after outage ends the change arrives by itself", ids(w3, "budgetLogs").includes("b_o2"), ids(w3, "budgetLogs"));
  }

  { console.log("\n# server refuses a write");
    const w = mk(); const A = w.device("A"); await A.start(); await w.clock.advance(5 * S);
    A.edit(s => s.budgetLogs.unshift(log("b_bad", "2026-11-09", 100, { totalExpenses: 5 })));
    await w.clock.advance(60 * S); const p1 = A.posts;
    check("the app shows stage and reason", /validate_budget/.test(statusText(A)) && /ID запроса fp_/.test(statusText(A)), statusText(A));
    await w.clock.advance(5 * 60 * S);
    check("no blind retry loop after an explicit refusal", A.posts === p1, "posts grew " + p1 + " → " + A.posts);
    check("refused data never reached the server; the pending edit stays on the device", !ids(w, "budgetLogs").includes("b_bad") && A.local().syncPending === true, ids(w, "budgetLogs"));
    A.edit(s => { s.budgetLogs = s.budgetLogs.filter(x => x.id !== "b_bad"); s.budgetLogs.unshift(log("b_ok", "2026-11-09", 7)); }); await w.clock.advance(60 * S);
    check("after fixing the data the next edit goes through", ids(w, "budgetLogs") === "b_ok,b_real1" && !A.local().syncPending, ids(w, "budgetLogs"));
  }

  { console.log("\n# new and old devices");
    const w = mk(); const B = w.device("B", { url: "" }); B.boot(); w.getFailures = 1;
    B.api.saveWebhookUrl("https://gas.test/exec"); await w.clock.advance(60 * S);
    check("new device, first download fails once: family data NOT replaced by sample data", ids(w, "goals") === "gA,gB", ids(w, "goals"));
    check("…and the device later loads the family data", localIds(B, "goals") === "gA,gB", localIds(B, "goals"));

    const w2 = mk(); const C = w2.device("C"); C.boot(); C.edit(s => s.goals.push(goal("gX", "Сделано до загрузки")));
    C.api.startup(); await w2.clock.advance(60 * S);
    check("new device editing before its first download does not pollute the Table with sample data", ids(w2, "goals") === "gA,gB" && localIds(C, "goals") === "gA,gB", ids(w2, "goals") + " | " + localIds(C, "goals"));

    const w3 = createWorld({ htmlPath: html, serverPath: srv });   // empty server, brand-new device seeds it
    const D = w3.device("D"); await D.start(); await w3.clock.advance(60 * S);
    check("empty Table is seeded by the first device", w3.backend.state().goals && w3.backend.state().goals.length > 5, JSON.stringify(w3.backend.state()).slice(0, 80));

    const w4 = mk(); const legacy = { currentUser: "Юрий", eurRate: 93.72, initialCashWallet: 17000, monthlyMandatoryExpenses: 0, trackedGoalId: "gA", selectedYearFilter: "ALL", webhookUrl: "https://gas.test/exec", updatedAt: w4.clock.now - 5000, plan: { base: 70000, extra: 0, extraFrom: "2027-01", yieldPct: 0 }, visits: {}, customPlaces: [], loans: REAL().loans, goals: [...REAL().goals, goal("gLoc", "Только на старом устройстве")], budgetLogs: REAL().budgetLogs };
    const O = w4.device("O", { saved: legacy }); await O.start(); await w4.clock.advance(90 * S);
    check("device from the old app version: its unsent local record is uploaded, family data intact", ids(w4, "goals") === "gA,gB,gLoc" && localIds(O, "goals") === "gA,gB,gLoc" && !O.local().syncPending, ids(w4, "goals") + " | " + localIds(O, "goals"));
  }

  { console.log("\n# clocks, hidden tabs, manual edits in the Table");
    const w = mk(); const A = w.device("A"), B = w.device("B", { skew: 5 * 60 * S }); await A.start(); await B.start(); await w.clock.advance(5 * S);
    B.edit(addLog("b_b1", 10)); await w.clock.advance(60 * S); A.edit(addLog("b_a1", 20)); await w.clock.advance(60 * S);
    check("device 5 min fast + accurate device: both edits kept and both see everything", ids(w, "budgetLogs") === "b_a1,b_b1,b_real1" && localIds(A, "budgetLogs") === localIds(B, "budgetLogs"), ids(w, "budgetLogs") + " | " + localIds(A, "budgetLogs") + " | " + localIds(B, "budgetLogs"));
    const w2 = mk(); const A2 = w2.device("A"), B2 = w2.device("B"); await A2.start(); await B2.start(); await w2.clock.advance(5 * S);
    B2.show("hidden"); const g0 = B2.gets; A2.edit(addLog("b_a1", 1)); await w2.clock.advance(120 * S);
    check("hidden tab does not poll", B2.gets === g0, "gets +" + (B2.gets - g0));
    B2.show("visible"); await w2.clock.advance(3 * S);
    check("returning to the tab shows the change within seconds", localIds(B2, "budgetLogs").includes("b_a1"), localIds(B2, "budgetLogs"));
    const w3 = mk(); const A3 = w3.device("A"); await A3.start(); await w3.clock.advance(5 * S);
    w3.backend.ss.getSheetByName("Цели").getRange(2, 6).setValue(4242); w3.backend.fireOnEdit("Цели", 2, 6);
    await w3.clock.advance(40 * S);
    check("manual edit in the Google Sheet reaches the device", A3.local().goals[0].amount === 4242, String(A3.local().goals[0].amount));
    A3.edit(addLog("b_a1", 1)); await w3.clock.advance(60 * S);
    check("device saves normally after a manual sheet edit and the sheet edit survives", ids(w3, "budgetLogs").includes("b_a1") && w3.backend.state().goals[0].amount === 4242, "");
  }

  console.log(failed ? "\n" + failed + " FAILED" : "\nAll multi-device sync tests passed");
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error("HARNESS ERROR", e); process.exit(2); });
