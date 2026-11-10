/** Server sync protocol v2 tests. Usage: node tests/sync-protocol.cjs [path/to/Code.gs] */
const path = require("node:path");
const { createBackend, log, goal, loan } = require("./gas-mock.cjs");
const code = process.argv[2] || path.join(__dirname, "..", "Code.gs");
let failed = 0;
function check(name, cond, detail) {
  console.log((cond ? "  ok   " : "  FAIL ") + name + (cond ? "" : "  → " + detail));
  if (!cond) failed++;
}
const ids = (b, k) => (b.state()[k] || []).map(x => x.id).sort().join(",");
const base = () => ({ goals: [goal("g1", "Шины"), goal("g2", "Телефон")], loans: [loan("l1", "Рома")], budgetLogs: [log("b_1", "2026-11-01", 1000)] });
const none = () => ({ upsert: [], remove: [] });
function seed(b, clock) {
  const r = b.post({ ...base(), updatedAt: 1000, clientId: "A", baseRev: 0 });
  return r.updatedAt;
}

console.log("Server:", code);

// 1. concurrent additions from a device that is behind
{
  const b = createBackend(code); const R = seed(b);
  const ra = b.post({ ...base(), budgetLogs: [log("b_2", "2026-11-02", 500), ...base().budgetLogs], updatedAt: 2000, clientId: "A", baseRev: R, changes: { goals: none(), loans: none(), budgetLogs: { upsert: ["b_2"], remove: [] }, fields: [] } });
  const rb = b.post({ ...base(), budgetLogs: [log("b_3", "2026-11-02", 700), ...base().budgetLogs], updatedAt: 2500, clientId: "B", baseRev: R, changes: { goals: none(), loans: none(), budgetLogs: { upsert: ["b_3"], remove: [] }, fields: [] } });
  check("both devices' new records survive", ids(b, "budgetLogs") === "b_1,b_2,b_3", ids(b, "budgetLogs"));
  check("behind write is reported as merged", ra.merged === false && rb.merged === true, JSON.stringify([ra.merged, rb.merged]));
  check("new records are newest-first", b.state().budgetLogs[0].id === "b_3", b.state().budgetLogs.map(x => x.id).join());
}

// 2. late-arriving older stamp is merged, not rejected
{
  const b = createBackend(code); const R = seed(b);
  b.post({ ...base(), budgetLogs: [log("b_2", "d", 5), ...base().budgetLogs], updatedAt: 2000, clientId: "A", baseRev: R, changes: { goals: none(), loans: none(), budgetLogs: { upsert: ["b_2"], remove: [] }, fields: [] } });
  const rb = b.post({ ...base(), budgetLogs: [log("b_3", "d", 7), ...base().budgetLogs], updatedAt: 1500, clientId: "B", baseRev: R, changes: { goals: none(), loans: none(), budgetLogs: { upsert: ["b_3"], remove: [] }, fields: [] } });
  check("older client stamp is accepted and merged", rb.status === "ok" && ids(b, "budgetLogs") === "b_1,b_2,b_3", rb.status + " " + ids(b, "budgetLogs"));
}

// 3. other device's edit of a record is not reverted by an unrelated edit
{
  const b = createBackend(code); const R = seed(b);
  b.post({ goals: [goal("g1", "Шины", { status: "Выполнено" }), goal("g2", "Телефон")], loans: base().loans, budgetLogs: base().budgetLogs, updatedAt: 2000, clientId: "A", baseRev: R, changes: { goals: { upsert: ["g1"], remove: [] }, loans: none(), budgetLogs: none(), fields: [] } });
  b.post({ goals: [goal("g1", "Шины"), goal("g2", "Телефон", { amount: 2000 })], loans: base().loans, budgetLogs: base().budgetLogs, updatedAt: 2600, clientId: "B", baseRev: R, changes: { goals: { upsert: ["g2"], remove: [] }, loans: none(), budgetLogs: none(), fields: [] } });
  const s = b.state();
  check("A's completed goal stays completed", s.goals.find(g => g.id === "g1").status === "Выполнено", s.goals.find(g => g.id === "g1").status);
  check("B's own edit is applied", s.goals.find(g => g.id === "g2").amount === 2000, "");
}

// 4. deletions
{
  const b = createBackend(code); const R = seed(b);
  // A deletes g2 (server now has g1 only), then B (behind) edits g1 only
  const r1 = b.post({ goals: [goal("g1", "Шины")], loans: base().loans, budgetLogs: base().budgetLogs, updatedAt: 2000, clientId: "A", baseRev: R, changes: { goals: { upsert: [], remove: ["g2"] }, loans: none(), budgetLogs: none(), fields: [] } });
  b.post({ goals: [goal("g1", "Шины", { amount: 5 }), goal("g2", "Телефон")], loans: base().loans, budgetLogs: base().budgetLogs, updatedAt: 2100, clientId: "B", baseRev: R, changes: { goals: { upsert: ["g1"], remove: [] }, loans: none(), budgetLogs: none(), fields: [] } });
  check("a record deleted on another device is not resurrected by a stale device", ids(b, "goals") === "g1", ids(b, "goals"));
  // B (behind) deletes g1 while A added g9 meanwhile
  const b2 = createBackend(code); const R2 = seed(b2);
  b2.post({ goals: [...base().goals, goal("g9", "Новая")], loans: base().loans, budgetLogs: base().budgetLogs, updatedAt: 2000, clientId: "A", baseRev: R2, changes: { goals: { upsert: ["g9"], remove: [] }, loans: none(), budgetLogs: none(), fields: [] } });
  b2.post({ goals: [goal("g2", "Телефон")], loans: base().loans, budgetLogs: base().budgetLogs, updatedAt: 2100, clientId: "B", baseRev: R2, changes: { goals: { upsert: [], remove: ["g1"] }, loans: none(), budgetLogs: none(), fields: [] } });
  check("deleting on a stale device removes only that record and keeps the other device's new one", ids(b2, "goals") === "g2,g9", ids(b2, "goals"));
}

// 5. same device chain: fast-forward honours deletions, duplicates are stale
{
  const b = createBackend(code); const R = seed(b);
  const r1 = b.post({ ...base(), budgetLogs: [log("b_2", "d", 5), ...base().budgetLogs], updatedAt: 2000, clientId: "A", baseRev: R, changes: { goals: none(), loans: none(), budgetLogs: { upsert: ["b_2"], remove: [] }, fields: [] } });
  // A has not learned the new revision yet (verification pending) and deletes b_2 again
  const r2 = b.post({ ...base(), updatedAt: 2100, clientId: "A", baseRev: R, changes: { goals: none(), loans: none(), budgetLogs: none(), fields: [] } });
  check("own consecutive snapshots are fast-forwarded (deletion kept)", r2.status === "ok" && r2.merged === false && ids(b, "budgetLogs") === "b_1", r2.status + " merged=" + r2.merged + " " + ids(b, "budgetLogs"));
  const r3 = b.post({ ...base(), budgetLogs: [log("b_2", "d", 5), ...base().budgetLogs], updatedAt: 2000, clientId: "A", baseRev: R });
  check("older duplicate retry from the same device is rejected as stale", r3.status === "stale" && ids(b, "budgetLogs") === "b_1", r3.status);
}

// 6. a merged write is not treated as the device's own chain afterwards
{
  const b = createBackend(code); const R = seed(b);
  b.post({ ...base(), budgetLogs: [log("b_2", "d", 5), ...base().budgetLogs], updatedAt: 2000, clientId: "A", baseRev: R, changes: { goals: none(), loans: none(), budgetLogs: { upsert: ["b_2"], remove: [] }, fields: [] } });
  const rb = b.post({ ...base(), budgetLogs: [log("b_3", "d", 7), ...base().budgetLogs], updatedAt: 2500, clientId: "B", baseRev: R, changes: { goals: none(), loans: none(), budgetLogs: { upsert: ["b_3"], remove: [] }, fields: [] } });
  // B has not pulled the merge result yet and pushes another edit with the same old base
  b.post({ ...base(), budgetLogs: [log("b_4", "d", 9), log("b_3", "d", 7), ...base().budgetLogs], updatedAt: 2600, clientId: "B", baseRev: R, changes: { goals: none(), loans: none(), budgetLogs: { upsert: ["b_3", "b_4"], remove: [] }, fields: [] } });
  check("after a merge, the writer's next stale snapshot cannot erase merged-in records", ids(b, "budgetLogs") === "b_1,b_2,b_3,b_4", ids(b, "budgetLogs"));
}

// 7. unaffected fields are kept; changed fields are taken
{
  const b = createBackend(code);
  const R = b.post({ ...base(), plan: { startMonth: 1 }, eurRate: 90, updatedAt: 1000, clientId: "A", baseRev: 0 }).updatedAt;
  b.post({ ...base(), plan: { startMonth: 5 }, eurRate: 90, updatedAt: 2000, clientId: "A", baseRev: R });
  const rb = b.post({ ...base(), plan: { startMonth: 1 }, eurRate: 95, updatedAt: 2100, clientId: "B", baseRev: R, changes: { goals: none(), loans: none(), budgetLogs: none(), fields: ["eurRate"] } });
  const s = b.state();
  check("field changed by B is taken, field not changed by B keeps the server value", s.eurRate === 95 && s.plan.startMonth === 5, JSON.stringify([s.eurRate, s.plan]));
}

// 8. no change info (legacy device upgrading): union, server wins on same IDs, nothing is lost
{
  const b = createBackend(code); const R = seed(b);
  b.post({ goals: [goal("g1", "Шины", { status: "Выполнено" }), goal("g2", "Телефон")], loans: base().loans, budgetLogs: base().budgetLogs, updatedAt: 2000, clientId: "A", baseRev: R });
  b.post({ goals: [goal("g1", "Шины"), goal("g2", "Телефон"), goal("g7", "Локальная")], loans: base().loans, budgetLogs: base().budgetLogs, updatedAt: 1900, clientId: "OLD", baseRev: 0, changes: null });
  const s = b.state();
  check("without change info: server copy wins on same ID, local-only record is kept", s.goals.find(g => g.id === "g1").status === "Выполнено" && ids(b, "goals") === "g1,g2,g7", ids(b, "goals"));
}

// 9. server was restored / empty while the client has a base revision: seed fully, do not merge into nothing
{
  const b = createBackend(code);
  const r = b.post({ ...base(), updatedAt: 3000, clientId: "A", baseRev: 99999, changes: { goals: { upsert: ["g1"], remove: [] }, loans: none(), budgetLogs: none(), fields: [] } });
  check("empty server is seeded with the full snapshot", r.status === "ok" && ids(b, "goals") === "g1,g2" && ids(b, "budgetLogs") === "b_1", ids(b, "goals"));
}

// 10. legacy clients keep working (no baseRev)
{
  const b = createBackend(code);
  b.post({ ...base(), updatedAt: 1000 });
  const r = b.post({ ...base(), budgetLogs: [log("b_9", "d", 1), ...base().budgetLogs], updatedAt: 1200 });
  const stale = b.post({ ...base(), updatedAt: 1100 });
  check("legacy request accepted, older legacy request is stale", r.status === "ok" && stale.status === "stale", r.status + "/" + stale.status);
}

// 11. manual sheet edit then slow-clock device
{
  const b = createBackend(code); const R = seed(b);
  b.ss.getSheetByName("Цели").getRange(2, 6).setValue(9999); b.fireOnEdit("Цели", 2, 6);
  const t = b.get({ ts: 1 });
  check("sheet edit changes revision and marks writer as sheet", t.updatedAt > R && t.lastClientId === "sheet", JSON.stringify(t));
  const r = b.post({ ...base(), goals: [goal("g1", "Шины", { amount: 9999 }), goal("g2", "Телефон")], budgetLogs: [log("b_2", "d", 5), ...base().budgetLogs], updatedAt: 1100, clientId: "A", baseRev: R, changes: { goals: none(), loans: none(), budgetLogs: { upsert: ["b_2"], remove: [] }, fields: [] } });
  check("device with older clock can save after a sheet edit (merged, sheet edit kept)", r.status === "ok" && b.state().goals[0].amount === 9999 && ids(b, "budgetLogs") === "b_1,b_2", r.status);
}

// 12. seed budget log b1 passes validation; real mismatches are still rejected
{
  const b = createBackend(code);
  const seedLog = { id: "b1", date: "2026-10-26", user: "Юрий", mode: "income", income: 31591, items: [{ type: "expense", categoryName: "Резерв", amount: 17000 }], totalExpenses: 17000, investedRemainder: 14591 };
  const r = b.post({ ...base(), budgetLogs: [seedLog], updatedAt: 1000, clientId: "A", baseRev: 0 });
  check("built-in log b1 (un-itemized investment) is accepted", r.status === "ok", JSON.stringify(r));
  const bad = b.post({ ...base(), budgetLogs: [{ ...seedLog, totalExpenses: 1 }], updatedAt: 1100, clientId: "A", baseRev: r.updatedAt });
  check("a wrong expense total is still rejected", bad.status === "error" && bad.stage === "validate_budget" && bad.stack === undefined, JSON.stringify(bad));
  const t = b.get({ ts: 1 });
  check("rejection is visible to the app through ?ts=1 (stage, id, no stack)", t.lastError && t.lastError.stage === "validate_budget" && t.lastError.clientId === "A" && t.lastError.clientUpdatedAt === 1100 && !t.lastError.stack, JSON.stringify(t));
  const ok = b.post({ ...base(), budgetLogs: [seedLog], updatedAt: 1200, clientId: "A", baseRev: r.updatedAt });
  check("a successful write clears the error", !b.get({ ts: 1 }).lastError && ok.status === "ok", JSON.stringify(b.get({ ts: 1 })));
  check("failed write kept the previously stored data", b.state().budgetLogs[0].totalExpenses === 17000, "");
}

// 13. sheet import keeps the un-itemized part of investedRemainder
{
  const b = createBackend(code);
  const seedLog = { id: "b1", date: "2026-10-26", user: "Юрий", mode: "income", income: 31591, items: [{ id: "i1", type: "expense", categoryName: "Резерв", amount: 17000 }], totalExpenses: 17000, investedRemainder: 14591 };
  b.post({ ...base(), budgetLogs: [seedLog], updatedAt: 1000, clientId: "A", baseRev: 0 });
  const sh = b.ss.getSheetByName("Статистика Бюджета");
  const rows = sh.getDataRange().getValues();
  const target = rows.findIndex((r, i) => i > 0 && Number(r[6]) === 17000);
  if (target > 0) { sh.getRange(target + 1, 7).setValue(18000); b.fireOnEdit("Статистика Бюджета", target + 1, 7); }
  const s = b.state().budgetLogs[0];
  check("manual budget edit keeps un-itemized investment (14591) and updates the expense", target > 0 && s.investedRemainder === 14591 && s.totalExpenses === 18000, JSON.stringify([s.investedRemainder, s.totalExpenses, target]));
}

// 14. polling endpoint is cheap and has the new meta
{
  const b = createBackend(code); const R = seed(b);
  const t = b.get({ ts: 1 });
  check("?ts=1 returns revision, client stamp, writer", t.updatedAt === R && t.clientUpdatedAt === 1000 && t.lastClientId === "A" && t.merged === false, JSON.stringify(t));
}

console.log(failed ? "\n" + failed + " FAILED" : "\nAll server sync tests passed");
process.exit(failed ? 1 : 0);
