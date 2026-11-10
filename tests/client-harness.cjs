/**
 * Runs the REAL client code from index.html (state/loadState/saveState + the sync section)
 * inside a fake browser (virtual clock, fake fetch, fake localStorage) connected to the
 * REAL Code.gs running on the in-memory Apps Script mock.
 * Several devices can share one backend, each with its own storage and clock skew.
 */
const fs = require("node:fs");
const { createBackend } = require("./gas-mock.cjs");

const settle = () => new Promise(r => setImmediate(r));

class Clock {
  constructor() { this.now = Date.UTC(2026, 10, 9, 10, 0, 0); this.timers = []; this.seq = 0; }
  setTimeout(fn, ms) { const id = ++this.seq; this.timers.push({ id, at: this.now + Math.max(0, ms || 0), fn, every: 0 }); return id; }
  setInterval(fn, ms) { const id = ++this.seq; this.timers.push({ id, at: this.now + ms, fn, every: ms }); return id; }
  clear(id) { this.timers = this.timers.filter(t => t.id !== id); }
  async advance(ms) {
    const target = this.now + ms;
    for (;;) {
      await settle();
      const due = this.timers.filter(t => t.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.now = Math.max(this.now, due.at);
      if (due.every) due.at += due.every; else this.timers = this.timers.filter(t => t !== due);
      try { due.fn(); } catch (e) { console.error("timer error", e); }
    }
    this.now = target;
    await settle();
  }
}

function slice(html, startMarker, endMarker) {
  const lines = html.split("\n");
  const s = lines.findIndex(l => l.includes(startMarker));
  const e = lines.findIndex((l, i) => i > s && l.includes(endMarker));
  if (s < 0 || e < 0) throw new Error("marker not found: " + startMarker + " / " + endMarker);
  return lines.slice(s, e).filter(l => !l.includes("const GAS_CODE =")).join("\n");
}

function createWorld(opts) {
  const html = fs.readFileSync(opts.htmlPath, "utf8");
  const stateSeg = slice(html, "const DEFAULT_WEBHOOK_URL", "function formatMoney(");
  const syncSeg = slice(html, "// ==================== СИНХРОНИЗАЦИЯ С GOOGLE ТАБЛИЦЕЙ", "function exportGoalsToCSV(");
  const clock = new Clock();
  const backend = createBackend(opts.serverPath, { now: () => clock.now });
  const lat = { get: opts.getMs || 700, post: opts.postMs || 2500 };
  const world = { clock, backend, lat, devices: {}, outage: false, postFailures: 0, getFailures: 0 };

  world.device = function (name, cfg) {
    cfg = cfg || {};
    const dev = { name, skew: cfg.skew || 0, offline: false, storage: new Map(), renders: 0, alerts: [], toasts: [], statuses: [], posts: 0, gets: 0, fullGets: 0 };
    if (cfg.saved) dev.storage.set("fin_navigator_yuri_katarina_v4", JSON.stringify(cfg.saved));
    const url = cfg.url === undefined ? "https://gas.test/exec" : cfg.url;

    dev.boot = function () {
      // fresh JS context = page (re)load: in-memory flags are lost, localStorage stays
      dev.ownTimers = [];
      const els = {};
      const element = id => (els[id] = els[id] || { id, value: "", textContent: "", className: "", classList: { add() {}, remove() {}, toggle() {} }, style: {}, addEventListener() {}, setAttribute() {} });
      const docListeners = {}, winListeners = {};
      const document = {
        visibilityState: "visible",
        getElementById: element, querySelector: () => null, querySelectorAll: () => [],
        addEventListener: (t, f) => { (docListeners[t] = docListeners[t] || []).push(f); }
      };
      dev.document = document;
      const window = { addEventListener: (t, f) => { (winListeners[t] = winListeners[t] || []).push(f); } };
      const localStorage = {
        getItem: k => (dev.storage.has(k) ? dev.storage.get(k) : null),
        setItem: (k, v) => dev.storage.set(k, String(v)),
        removeItem: k => dev.storage.delete(k)
      };
      const nowFn = () => clock.now + dev.skew;
      class VDate extends Date {
        constructor(...a) { if (a.length) super(...a); else super(nowFn()); }
        static now() { return nowFn(); }
      }
      const respond = async (urlStr, o) => {
        const u = new URL(urlStr);
        const post = o && o.method === "POST";
        await new Promise(r => clock.setTimeout(r, (post ? lat.post : lat.get) / 2));
        if (dev.offline || world.outage) throw new TypeError("Failed to fetch");
        let out;
        if (post) {
          dev.posts++;
          if (world.postFailures > 0) { world.postFailures--; throw new TypeError("Failed to fetch"); }
          out = backend.ctx.doPost({ postData: { contents: o.body } });
        } else {
          dev.gets++;
          if (world.getFailures > 0 && !Object.fromEntries(u.searchParams.entries()).ts) { world.getFailures--; throw new TypeError("Failed to fetch"); }
          const params = Object.fromEntries(u.searchParams.entries());
          if (!params.ts && !params.market) dev.fullGets++;
          out = backend.ctx.doGet({ parameter: params });
        }
        await new Promise(r => clock.setTimeout(r, (post ? lat.post : lat.get) / 2));
        const text = out.getContent();
        if (o && o.mode === "no-cors") return { type: "opaque", ok: false, status: 0, text: async () => "", json: async () => { throw new Error("opaque"); } };
        return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) };
      };
      const stubs = {
        document, window, localStorage, Date: VDate, console,
        fetch: respond,
        setTimeout: (f, ms) => { const id = clock.setTimeout(f, ms); dev.ownTimers.push(id); return id; },
        setInterval: (f, ms) => { const id = clock.setInterval(f, ms); dev.ownTimers.push(id); return id; },
        clearTimeout: id => clock.clear(id), clearInterval: id => clock.clear(id),
        alert: m => dev.alerts.push(String(m)), confirm: () => true,
        toast: m => dev.toasts.push(String(m)),
        renderAll: () => { dev.renders++; },
        enrichGoals: l => l, reconcileLoans: () => {},
        forecastForSync: () => [], summaryForSync: () => [], tripsForSync: () => [],
        pullMarketData: () => {}
      };
      const names = Object.keys(stubs);
      const body = `
        ${stateSeg}
        ${syncSeg}
        return {
          get state() { return state; },
          set state(v) { state = v; },
          loadState, saveState,
          autoSyncIfConfigured, pushToGoogleSheets, pullFromGoogleSheets, pollRemoteSync,
          saveWebhookUrl,
          startup: (typeof syncOnStartup === "function") ? syncOnStartup : function () { if (getWebhook()) return pullFromGoogleSheets(false); },
          flags: () => ({ syncDirty, syncInFlight, syncPullInFlight })
        };`;
      const api = new Function(...names, body)(...names.map(n => stubs[n]));
      api.loadState();
      if (url && !api.state.webhookUrl) api.state.webhookUrl = url;
      dev.api = api; dev.docListeners = docListeners; dev.winListeners = winListeners;
      return dev;
    };
    dev.start = async () => { dev.boot(); dev.startPromise = dev.api.startup(); await settle(); };
    dev.reload = async () => {
      // page reload: timers of the old page die, in-memory flags are lost, localStorage stays
      dev.ownTimers.forEach(id => clock.clear(id));
      return dev.start();
    };
    dev.edit = fn => { fn(dev.api.state); dev.api.autoSyncIfConfigured(); };
    dev.show = vis => {
      dev.document.visibilityState = vis;
      (dev.docListeners.visibilitychange || []).forEach(f => f());
    };
    dev.local = () => JSON.parse(JSON.stringify(dev.api.state));
    world.devices[name] = dev;
    return dev;
  };
  return world;
}

module.exports = { createWorld, settle };
