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
  check("?ts=1 returns revision, client stamp, writer and the code version", t.updatedAt === R && t.clientUpdatedAt === 1000 && t.lastClientId === "A" && t.merged === false && /^\d{4}-\d{2}-\d{2}/.test(t.version), JSON.stringify(t));
  check("the code version is written to the state sheet (F1) so it can be read from the Table", /^\d{4}-\d{2}-\d{2}/.test(String(b.ss.getSheetByName("_Состояние").getRange("F1").getValue())), String(b.ss.getSheetByName("_Состояние").getRange("F1").getValue()));
}


// 15. gift lists: storage, sheet, merge between devices, validation, formula safety
{
  const lst = (id, title) => ({ id, title });
  const gi = (id, listId, name, amount, extra) => Object.assign({ id, listId, name, idea: "книга", amount, bought: false }, extra || {});
  const gnone = () => ({ goals: none(), loans: none(), budgetLogs: none(), giftLists: none(), giftItems: none(), fields: [] });
  const b = createBackend(code);
  const R = b.post({ ...base(), giftLists: [lst("gl1", "Новый год")], giftItems: [gi("gi1", "gl1", "Мама", 3000)], updatedAt: 1000, clientId: "A", baseRev: 0 });
  check("gift lists are stored and read back", R.status === "ok" && b.state().giftLists.length === 1 && b.state().giftItems[0].name === "Мама", JSON.stringify(R));
  const rows = b.sheetRows("Подарки");
  check("sheet «Подарки» shows the item and the list total", rows && rows.some(r => r[1] === "Мама" && r[3] === 3000) && rows.some(r => r[1] === "ИТОГО" && r[3] === 3000), JSON.stringify(rows));
  const rev = R.updatedAt;
  b.post({ ...base(), giftLists: [lst("gl1", "Новый год")], giftItems: [gi("gi1", "gl1", "Мама", 3000), gi("giA", "gl1", "Папа", 2000)], updatedAt: 2000, clientId: "A", baseRev: rev, changes: { ...gnone(), giftItems: { upsert: ["giA"], remove: [] } } });
  b.post({ ...base(), giftLists: [lst("gl1", "Новый год")], giftItems: [gi("gi1", "gl1", "Мама", 3000), gi("giB", "gl1", "Сестра", 1500)], updatedAt: 2100, clientId: "B", baseRev: rev, changes: { ...gnone(), giftItems: { upsert: ["giB"], remove: [] } } });
  check("two devices adding to the same list keep both gifts", b.state().giftItems.map(x => x.id).sort().join() === "gi1,giA,giB", b.state().giftItems.map(x => x.id).join());
  const rev2 = b.get({ ts: 1 }).updatedAt;
  b.post({ ...base(), giftLists: [lst("gl1", "Новый год")], giftItems: [gi("gi1", "gl1", "Мама", 3000, { bought: true }), gi("giA", "gl1", "Папа", 2000), gi("giB", "gl1", "Сестра", 1500)], updatedAt: 3000, clientId: "A", baseRev: rev2, changes: { ...gnone(), giftItems: { upsert: ["gi1"], remove: [] } } });
  b.post({ ...base(), giftLists: [lst("gl1", "Новый год")], giftItems: [gi("gi1", "gl1", "Мама", 3000), gi("giA", "gl1", "Папа", 2000)], updatedAt: 3100, clientId: "B", baseRev: rev2, changes: { ...gnone(), giftItems: { upsert: [], remove: ["giB"] } } });
  const it = b.state().giftItems;
  check("«bought» on one device and a deletion on another both survive", it.find(x => x.id === "gi1").bought === true && !it.find(x => x.id === "giB") && it.length === 2, JSON.stringify(it.map(x => [x.id, x.bought])));
  const bad = b.post({ ...base(), giftLists: [lst("gl1", "Новый год")], giftItems: [gi("x", "gl1", "Я", -5)], updatedAt: 4000, clientId: "A", baseRev: b.get({ ts: 1 }).updatedAt });
  check("negative amount is rejected at stage validate_gifts and nothing is overwritten", bad.status === "error" && bad.stage === "validate_gifts" && b.state().giftItems.length === 2, JSON.stringify(bad));
  const bad2 = b.post({ ...base(), giftLists: [lst("gl1", "A"), lst("gl1", "B")], updatedAt: 4100, clientId: "A", baseRev: b.get({ ts: 1 }).updatedAt });
  check("duplicate list id is rejected", bad2.status === "error" && bad2.stage === "validate_gifts", JSON.stringify(bad2));
  const inj = b.post({ ...base(), giftLists: [lst("gl1", "=HYPERLINK(\"http://x\")")], giftItems: [gi("gi9", "gl1", "+cmd|calc", 10)], updatedAt: 5000, clientId: "A", baseRev: b.get({ ts: 1 }).updatedAt });
  const r2 = b.sheetRows("Подарки");
  check("text starting with = or + is stored as text, not as a formula", inj.status === "ok" && r2.every(r => !/^[=+]/.test(String(r[0])) && !/^[=+]/.test(String(r[1]))), JSON.stringify(r2.slice(1, 3)));
  const rb = b.sheetRows("Подарки").length;
  const empty = b.post({ ...base(), giftLists: [], giftItems: [], updatedAt: 6000, clientId: "A", baseRev: b.get({ ts: 1 }).updatedAt });
  check("clearing all gifts on the last device empties the sheet to the header", empty.status === "ok" && b.sheetRows("Подарки").filter(r => r[0] !== "").length === 1, String(b.sheetRows("Подарки").length));
}


// 16. celebrations, «seen» marks and balance fixes
{
  const none3 = () => ({ goals: none(), loans: none(), budgetLogs: none(), giftLists: none(), giftItems: none(), celebEvents: none(), celebSeen: none(), balanceFixes: none(), fields: [] });
  const b = createBackend(code); const R = seed(b);
  const ev = { id: "ms_100000", kind: "milestone", title: "t", text: "x", at: "2026-11-16T10:00:00Z" };
  const rv = b.post({ ...base(), celebEvents: [ev], celebSeen: [], balanceFixes: [], updatedAt: 2000, clientId: "A", baseRev: R, changes: { ...none3(), celebEvents: { upsert: ["ms_100000"], remove: [] } } });
  const mk = (id, user) => ({ id, ev: "ms_100000", user, at: "2026-11-16T10:05:00Z" });
  b.post({ ...base(), celebEvents: [ev], celebSeen: [mk("ms_100000|Юрий", "Юрий")], updatedAt: 3000, clientId: "A", baseRev: rv.updatedAt, changes: { ...none3(), celebSeen: { upsert: ["ms_100000|Юрий"], remove: [] } } });
  b.post({ ...base(), celebEvents: [ev], celebSeen: [mk("ms_100000|Катарина", "Катарина")], updatedAt: 3100, clientId: "B", baseRev: rv.updatedAt, changes: { ...none3(), celebSeen: { upsert: ["ms_100000|Катарина"], remove: [] } } });
  check("«seen» marks of two different people from two devices are both kept", b.state().celebSeen.map(x => x.user).sort().join() === "Катарина,Юрий", JSON.stringify(b.state().celebSeen));
  const rev = b.get({ ts: 1 }).updatedAt;
  b.post({ ...base(), balanceFixes: [{ id: "fx1", kind: "invest", delta: -1, date: "2026-11-16" }], updatedAt: 4000, clientId: "A", baseRev: rev });
  check("a balance fix is stored", b.state().balanceFixes[0].delta === -1, JSON.stringify(b.state().balanceFixes));
  const bad = b.post({ ...base(), balanceFixes: [{ id: "fx2", kind: "other", delta: 5 }], updatedAt: 5000, clientId: "A", baseRev: b.get({ ts: 1 }).updatedAt });
  check("a balance fix of unknown kind is rejected at validate_misc", bad.status === "error" && bad.stage === "validate_misc", JSON.stringify(bad));
  const dup = b.post({ ...base(), celebEvents: [ev, ev], updatedAt: 5100, clientId: "A", baseRev: b.get({ ts: 1 }).updatedAt });
  check("duplicate event ids are rejected", dup.status === "error" && dup.stage === "validate_misc", JSON.stringify(dup));
}

console.log(failed ? "\n" + failed + " FAILED" : "\nAll server sync tests passed");
process.exit(failed ? 1 : 0);
