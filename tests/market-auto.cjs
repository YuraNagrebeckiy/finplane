/** Automatic market data: self-installing hourly trigger, refresh on demand, no data loss when the source is unreachable. */
const path = require("node:path");
const { createBackend } = require("./gas-mock.cjs");
const code = process.argv[2] || path.join(__dirname, "..", "Code.gs");
let failed = 0;
const check = (n, c, d) => { console.log((c ? "  ok   " : "  FAIL ") + n + (c ? "" : "  → " + d)); if (!c) failed++; };
const hourly = b => b.triggers.filter(t => t.getHandlerFunction() === "finplaneRefreshMarketDaily").length;
console.log("Server:", code);

{ const b = createBackend(code);
  const r1 = b.get({ market: 1 });
  check("first request installs the DAILY trigger by itself", r1.status === "ok" && r1.trigger === "created" && hourly(b) === 1, JSON.stringify([r1.trigger, hourly(b)]));
  const r2 = b.get({ market: 1 });
  check("repeated requests do not duplicate it", r2.trigger === "present" && hourly(b) === 1, JSON.stringify([r2.trigger, hourly(b)]));
  check("response carries data age (null = never updated)", "ageMinutes" in r2 && r2.ageMinutes === null && typeof r2.metrics === "object", JSON.stringify(r2).slice(0, 120)); }

{ const b = createBackend(code);                                    // old hourly trigger from the previous version is replaced
  b.triggers.push({ getHandlerFunction: () => "finplaneRefreshMarketHourly" }, { getHandlerFunction: () => "refreshMarketData_" });
  const r = b.get({ market: 1 });
  check("old hourly triggers are removed and one daily trigger is created", r.trigger === "created" && hourly(b) === 1 && b.triggers.length === 1, JSON.stringify([r.trigger, b.triggers.map(t => t.getHandlerFunction())]));
  b.triggers.push({ getHandlerFunction: () => "finplaneRefreshMarketDaily" });
  b.get({ market: 1 });
  check("duplicate daily triggers are reduced to one", hourly(b) === 1, String(hourly(b))); }

{ const b = createBackend(code); b.ctx.setupMarketData();            // creates the sheet (source offline)
  const sh = b.ss.getSheetByName("Рыночные данные"); const rows = sh.getDataRange().getValues();
  const r = rows.findIndex(x => x[0] === "eur_rub") + 1;
  sh.getRange(r, 3).setValue(91.5); sh.getRange(r, 5, 1, 2).setValues([["09.11.2026", "2026-11-09 10:00:00"]]);
  const resp = b.get({ market: "refresh" });
  check("refresh with unreachable source reports failure but answers", resp.status === "ok" && resp.refreshed && resp.refreshed.status !== "ok", JSON.stringify(resp.refreshed));
  check("…and keeps the previously stored value", resp.metrics.eur_rub.value === 91.5, JSON.stringify(resp.metrics.eur_rub)); }

{ let fetched = 0; const b = createBackend(code, { fetch: () => { fetched++; throw new Error("offline"); } });
  b.ctx.setupMarketData(); const sh = b.ss.getSheetByName("Рыночные данные"); const rows = sh.getDataRange().getValues();
  const stamp = new Date(Date.now() - 5 * 60000).toISOString().slice(0, 19).replace("T", " ");     // updated 5 minutes ago
  rows.forEach((x, i) => { if (i > 0 && x[7] === "auto") { sh.getRange(i + 1, 3).setValue(1); sh.getRange(i + 1, 6).setValue(stamp); } });
  const before = fetched; const fresh = b.get({ market: "refresh" });
  check("fresh data (5 min old) is not re-fetched on a normal refresh request", fetched === before && fresh.refreshed === null && fresh.ageMinutes <= 10, "fetched +" + (fetched - before) + " age=" + fresh.ageMinutes);
  const forced = b.get({ market: "refresh", force: 1 });
  check("manual refresh (force) always asks the source", fetched > before && forced.refreshed !== null, "fetched +" + (fetched - before)); }

{ const b = createBackend(code); b.triggers.length = 0;
  b.ctx.ScriptApp.getProjectTriggers = () => { throw new Error("no permission"); };
  const r = b.get({ market: 1 });
  check("if triggers cannot be managed the data is still served", r.status === "ok" && r.trigger === "unavailable", JSON.stringify(r.trigger)); }

console.log(failed ? "\n" + failed + " FAILED" : "\nAll market automation tests passed");
process.exit(failed ? 1 : 0);
