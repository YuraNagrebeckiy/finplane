/**
 * Minimal in-memory mock of the Google Apps Script services used by Code.gs.
 * Purpose: run the REAL server code (Code.gs) in Node and exercise doGet/doPost
 * round trips without touching any real spreadsheet.
 * It is NOT a substitute for a test on a copy of the real Google Sheet.
 */
const fs = require("node:fs");
const vm = require("node:vm");
const crypto = require("node:crypto");

function a1(ref) {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return [Number(m[2]), col];
}
const blank = v => v === "" || v === null || v === undefined;

class Range {
  constructor(sh, r, c, nr, nc) { this.sh = sh; this.r = r; this.c = c; this.nr = nr; this.nc = nc; }
  getSheet() { return this.sh; }
  getRow() { return this.r; }
  getColumn() { return this.c; }
  getLastRow() { return this.r + this.nr - 1; }
  getLastColumn() { return this.c + this.nc - 1; }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = [];
      for (let j = 0; j < this.nc; j++) {
        const v = (this.sh.grid[this.r - 1 + i] || [])[this.c - 1 + j];
        row.push(v === undefined || v === null ? "" : v);
      }
      out.push(row);
    }
    return out;
  }
  getFormulas() { return this.getValues().map(r => r.map(() => "")); }
  getFormula() { return ""; }
  getValue() { return this.getValues()[0][0]; }
  setValue(v) { return this.setValues([[v]]); }
  setValues(vals) {
    if (vals.length !== this.nr || (vals[0] || []).length !== this.nc) {
      throw new Error("Mock: setValues size mismatch " + vals.length + "x" + (vals[0] || []).length + " vs " + this.nr + "x" + this.nc);
    }
    for (let i = 0; i < this.nr; i++) {
      const row = (this.sh.grid[this.r - 1 + i] = this.sh.grid[this.r - 1 + i] || []);
      for (let j = 0; j < this.nc; j++) row[this.c - 1 + j] = vals[i][j];
    }
    return this;
  }
  clearContent() {
    for (let i = 0; i < this.nr; i++) {
      const row = this.sh.grid[this.r - 1 + i];
      if (row) for (let j = 0; j < this.nc; j++) row[this.c - 1 + j] = "";
    }
    return this;
  }
  setNumberFormat() { return this; }
}

class Sheet {
  constructor(name, ss) { this.name = name; this.ss = ss; this.grid = []; this.hidden = false; this.maxCols = 26; }
  getName() { return this.name; }
  getParent() { return this.ss; }
  getLastRow() { let last = 0; this.grid.forEach((row, i) => { if (row.some(v => !blank(v))) last = i + 1; }); return last; }
  _width() { return this.grid.reduce((w, row) => Math.max(w, row.length), 0); }
  getMaxColumns() { return Math.max(this.maxCols, this._width()); }
  getRange(a, b, c, d) {
    if (typeof a === "string") { const [r, col] = a1(a); return new Range(this, r, col, 1, 1); }
    return new Range(this, a, b, c || 1, d || 1);
  }
  getDataRange() { return new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this._width())); }
  clearContents() { this.grid = []; return this; }
  setFrozenRows() {}
  hideSheet() { this.hidden = true; }
  isSheetHidden() { return this.hidden; }
  appendRow(arr) { this.grid[this.getLastRow()] = arr.slice(); }
  insertColumnsAfter(pos, n) { this.maxCols = Math.max(this.maxCols, pos + n); }
  hideColumns() {}
}

class Spreadsheet {
  constructor() { this.sheets = []; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  insertSheet(n) { const s = new Sheet(n, this); this.sheets.push(s); return s; }
  getSheets() { return this.sheets.slice(); }
  deleteSheet(s) { this.sheets = this.sheets.filter(x => x !== s); }
}

class Calendar {
  constructor() { this.events = []; this.seq = 0; }
  getEvents() { return this.events.slice(); }
  getEventById(id) { return this.events.find(e => e.id === id) || null; }
  createAllDayEvent(title, date, opts) {
    const ev = {
      id: "ev" + (++this.seq), title, date, desc: (opts && opts.description) || "",
      getId() { return this.id; }, getDescription() { return this.desc; },
      setTitle(t) { this.title = t; }, setDescription(d) { this.desc = d; },
      setAllDayDate(d) { this.date = d; },
      deleteEvent: () => { this.events = this.events.filter(e => e !== ev); }
    };
    this.events.push(ev);
    return ev;
  }
}

function createBackend(codePath, opts) {
  opts = opts || {};
  const ss = new Spreadsheet();
  const calendar = new Calendar();
  const props = new Map();
  let lockHeld = false;
  const stats = { logged: [] };
  const sandbox = {
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    CalendarApp: {
      getCalendarsByName: () => [calendar],
      createCalendar: () => calendar
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperties: () => Object.fromEntries(props),
        setProperties: o => Object.entries(o).forEach(([k, v]) => props.set(k, String(v))),
        getProperty: k => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => props.set(k, String(v)),
        deleteProperty: k => props.delete(k)
      })
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => { if (lockHeld) return false; lockHeld = true; return true; },
        waitLock: () => { lockHeld = true; },
        releaseLock: () => { lockHeld = false; }
      })
    },
    ContentService: {
      MimeType: { JSON: "json" },
      createTextOutput: s => ({ s, setMimeType() { return this; }, getContent() { return s; } })
    },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      DigestAlgorithm: { SHA_256: "sha256" },
      computeDigest: (alg, str) => Array.from(crypto.createHash("sha256").update(String(str)).digest()),
      base64EncodeWebSafe: bytes => Buffer.from(bytes).toString("base64url"),
      formatDate: d => new Date(d).toISOString()
    },
    Session: { getScriptTimeZone: () => "Europe/Kaliningrad" },
    ScriptApp: {
      getProjectTriggers: () => [],
      newTrigger: () => ({ timeBased() { return this; }, everyMinutes() { return this; }, everyHours() { return this; }, create() {} }),
      deleteTrigger() {}
    }
  };
  if (opts.now) {
    // virtual server clock (tests)
    sandbox.Date = class VDate extends Date {
      constructor(...a) { if (a.length) super(...a); else super(opts.now()); }
      static now() { return opts.now(); }
    };
  }
  const ctx = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(codePath, "utf8"), ctx, { filename: codePath });
  const json = out => JSON.parse(out.getContent());
  return {
    ctx, ss, calendar, props,
    post: obj => json(ctx.doPost({ postData: { contents: typeof obj === "string" ? obj : JSON.stringify(obj) } })),
    get: params => json(ctx.doGet({ parameter: params || {} })),
    /** Full stored state as plain JSON. */
    state() { const r = json(ctx.doGet({ parameter: {} })); return r; },
    sheetRows: name => { const s = ss.getSheetByName(name); return s ? s.getDataRange().getValues() : null; },
    fireOnEdit(sheetName, row, col) {
      const sh = ss.getSheetByName(sheetName);
      ctx.onEdit({ range: sh.getRange(row, col) });
    },
    stats
  };
}

// ---- tiny fixtures ----
const log = (id, date, income, extra) => Object.assign({
  id, date, user: "Юрий", mode: "income", income, items: [], totalExpenses: 0, investedRemainder: 0, cashAdded: 0
}, extra || {});
const goal = (id, title, extra) => Object.assign({
  id, year: 2026, month: "Ноябрь", day: 15, title, amount: 1000, currency: "RUB",
  category: "Другое", isMain: false, status: "Запланировано", addedBy: "Юрий"
}, extra || {});
const loan = (id, creditor, extra) => Object.assign({ id, creditor, currency: "RUB", initial: 1000, paid: 0, deadline: "—" }, extra || {});

module.exports = { createBackend, log, goal, loan };
