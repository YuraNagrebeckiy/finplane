/*
 * FINPLANE — COMPLETE GOOGLE APPS SCRIPT BUNDLE
 * Generated from repository main on 2026-11-05.
 * Paste this whole file into ONE Apps Script file named Code.gs.
 * Before doing so, remove the old duplicate files:
 * BudgetIdentity.gs, BudgetSheet.gs, FinplaneSafety.gs, MarketData.gs.
 * Keep only this Code.gs to avoid duplicate global declarations.
 *
 * IMPORTANT: this bundle is not yet production-secure. Web app endpoints
 * currently have no request authentication, and cross-device writes still
 * use timestamp-based conflict detection rather than a base-revision protocol.
 * Test on a copy of the spreadsheet before deployment.
 */


/***************************************************************
 * MODULE: Code.gs
 * Original repository file; keep this section intact.
 ***************************************************************/

/**
 * Семейный Финансовый Навигатор — бэкенд (Google Apps Script)
 * Развёртывание: Начать → Развернуть → Новое развёртывание → Веб-приложение
 *   Доступ: не расширять без проверки аутентификации; doGet/doPost не защищены токеном.
 * После ЛЮБОГО изменения кода: Развернуть → Управление → ✏️ → Новая версия.
 * Первый запуск: выберите функцию authorize() и нажмите «Выполнить» — выдайте доступ к Таблице и Календарю.
 *
 * Доступ второму аккаунту к календарю: calendar.google.com → слева у «Финансы и Цели» ⋮ →
 * «Настройки и общий доступ» → «Доступ для отдельных пользователей» → Добавить → e-mail → «Вносить изменения и управлять доступом» или «Просмотр всех сведений».
 */
var CALENDAR_NAME = "Финансы и Цели";
var STATE_SHEET = "_Состояние";
var MONTHS = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];

function authorize() { getCalendar_(); SpreadsheetApp.getActiveSpreadsheet(); setupMarketData(); finplaneSetupCalendarTrigger_(); }

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function doGet(e) {
  if (e && e.parameter && e.parameter.market) return json_({ status: "ok", metrics: readMarketData_() });
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(STATE_SHEET);
  if (e && e.parameter && e.parameter.ts) {
    var raw = "";
    if (sh && sh.getLastRow() > 0) raw = sh.getRange(1, 1, sh.getLastRow(), 1).getValues().map(function (r) { return r[0]; }).join("");
    var saved = {};
    try { saved = raw ? JSON.parse(raw) : {}; } catch (err) {}
    return json_({
      updatedAt: Number(sh ? sh.getRange("B1").getValue() : 0) || 0,
      clientUpdatedAt: Number(saved.clientUpdatedAt) || 0
    });
  }
  if (!sh || sh.getLastRow() < 1) return json_({ status: "empty", updatedAt: 0 });
  var rows = sh.getRange(1, 1, sh.getLastRow(), 1).getValues();
  try { return json_(JSON.parse(rows.map(function (r) { return r[0]; }).join(""))); }
  catch (err) { return json_({ status: "error", message: String(err), updatedAt: 0 }); }
}

/** Проверяет все поддерживаемые разделы снимка, чтобы не терять изменения только в плане/поездках. */
function finplaneHasSyncPayload_(p) {
  if (!p || typeof p !== "object" || Array.isArray(p)) return false;
  function hasItems(v) { return Array.isArray(v) && v.length > 0; }
  function hasKeys(v) { return v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length > 0; }
  return hasItems(p.goals) || hasItems(p.loans) || hasItems(p.budgetLogs) ||
    hasItems(p.gameAchievements) || hasItems(p.trips) || hasItems(p.forecast) ||
    hasKeys(p.visits) || hasItems(p.customPlaces) || hasItems(p.summary) ||
    hasKeys(p.plan) || Number(p.monthlyMandatoryExpenses) > 0 || Number(p.eurRate) > 0;
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  var stage = "lock";
  var ss = null;
  var incomingUpdatedAt = 0;
  if (!lock.tryLock(25000)) return json_({ status: "busy" });
  try {
    stage = "parse_request";
    if (!e || !e.postData || typeof e.postData.contents !== "string") throw new Error("Отсутствует тело POST-запроса");
    var p = JSON.parse(e.postData.contents);
    if (!p || typeof p !== "object" || Array.isArray(p)) throw new Error("Некорректный формат состояния");
    ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!finplaneHasSyncPayload_(p)) return json_({ status: "ignored", message: "пустое состояние не сохраняется" });

    stage = "validate_shapes";
    ["goals", "loans", "budgetLogs", "gameAchievements", "trips", "forecast", "summary", "customPlaces"].forEach(function (key) {
      if (p[key] != null && !Array.isArray(p[key])) throw new Error(key + " должен быть массивом");
    });
    if (p.plan != null && (typeof p.plan !== "object" || Array.isArray(p.plan))) throw new Error("plan должен быть объектом");

    stage = "read_current_state";
    var stateSh = ss.getSheetByName(STATE_SHEET);
    var serverUpdatedAt = Number(stateSh ? stateSh.getRange("B1").getValue() : 0) || 0;
    var currentState = {};
    if (stateSh && stateSh.getLastRow() > 0) {
      var raw = stateSh.getRange(1, 1, stateSh.getLastRow(), 1).getValues()
        .map(function (r) { return r[0] || ""; }).join("");
      try { currentState = raw ? JSON.parse(raw) : {}; }
      catch (readErr) { throw new Error("Не удалось прочитать сохранённое состояние: " + readErr); }
    }
    var currentClientUpdatedAt = Number(currentState.clientUpdatedAt) || 0;
    incomingUpdatedAt = Number(p.updatedAt) || 0;
    if (!incomingUpdatedAt) return json_({ status: "error", stage: stage, message: "missing client updatedAt" });
    if (currentClientUpdatedAt > 0 && incomingUpdatedAt < currentClientUpdatedAt) {
      return json_({ status: "stale", serverUpdatedAt: serverUpdatedAt,
        currentClientUpdatedAt: currentClientUpdatedAt, incomingUpdatedAt: incomingUpdatedAt });
    }

    stage = "merge_family_wins";
    p.gameAchievements = finplaneMergeFamilyWins_(ss,
      currentState.gameAchievements || [], p.gameAchievements || []);

    stage = "validate_payload";
    p.budgetLogs = finplanePrepareBudgetIds(p.budgetLogs == null ? [] : p.budgetLogs, function () {
      return Utilities.getUuid();
    });
    finplaneValidateGoals_(p.goals || []);
    finplaneValidateBudgetLogs_(p.budgetLogs || []);
    finplaneCheckBudgetSheet_(ss);
    finplaneBudgetRows_(p.budgetLogs || []);
    p.clientUpdatedAt = incomingUpdatedAt;
    p.updatedAt = Math.max(Date.now(), serverUpdatedAt + 1);

    stage = "write_transaction";
    finplaneTransaction_(ss, p, function () {
      writeBudget_(ss, p.budgetLogs || []);
      writeGoals_(ss, p.goals || []);
      writePlan_(ss, p.plan || {}, p.forecast || []);
      put_(ss, "Сводка (приложение)", [["Показатель", "Значение"]].concat(p.summary || []));
      put_(ss, "Где были", [["Дата", "Место", "Локация", "Тип", "Заметка", "Кто отметил"]].concat(p.trips || []));
      writeFamilyWins_(ss, p.gameAchievements || []);
      saveState_(ss, p);
    });

    stage = "sync_goals_calendar";
    var cal = { error: null };
    try { cal = syncCalendar_(p.goals || []); } catch (calendarErr) { cal = { error: String(calendarErr) }; }

    stage = "sync_family_wins_calendar";
    var winsCal = { error: null };
    try { winsCal = syncFamilyWinsCalendar_(p.gameAchievements || []); } catch (winsErr) { winsCal = { error: String(winsErr) }; }

    stage = "complete";
    return json_({ status: "ok", updatedAt: p.updatedAt, clientUpdatedAt: p.clientUpdatedAt,
      calendar: cal, familyWinsCalendar: winsCal });
  } catch (err) {
    finplaneLogSyncError_(ss, stage, err, incomingUpdatedAt);
    return json_({ status: "error", stage: stage, message: String(err),
      stack: err && err.stack ? String(err.stack) : "" });
  } finally {
    lock.releaseLock();
  }
}
function onEdit(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
    if (!e || !e.range) return;
    var sh = e.range.getSheet(), name = sh.getName();
    if(name === MARKET_SHEET){finplaneStampMarketEdit_(e);return;}
    if (name !== "Цели" && name !== "Статистика Бюджета") return;
    if (e.range.getRow() < 2) return;
    var ss = sh.getParent(), stateSh = ss.getSheetByName(STATE_SHEET);
    if (!stateSh || stateSh.getLastRow() < 1) return;
    var raw = stateSh.getRange(1, 1, stateSh.getLastRow(), 1).getValues().map(function(r) { return r[0]; }).join("");
    var p = JSON.parse(raw);
    if (name === "Цели") {
      var values = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 11).getValues() : [];
      var old = {}; (p.goals || []).forEach(function(g) { old[String(g.id)] = g; });
      p.goals = values.filter(function(r) { return r[0] !== "" && r[0] != null && r[4] !== ""; }).map(function(r) {
        var id = String(r[0]), prev = old[id] || {};
        return Object.assign({}, prev, { id: id, year: Number(r[1]) || prev.year, month: String(r[2] || prev.month || "Январь"), day: Number(r[3]) || 15, title: String(r[4]), amount: Number(r[5]) || 0, currency: String(r[6] || "RUB"), category: String(r[7] || "Другое"), isMain: String(r[8]).toUpperCase() === "ДА", status: String(r[9] || "Запланировано"), addedBy: String(r[10] || "Семья") });
      });
      if(p.goals.length!==Object.keys(old).length)throw new Error('Добавляйте и удаляйте цели через приложение');
    } else {
      p.budgetLogs=finplaneReadBudgetSheet_(sh,p.budgetLogs||[]);
    }
    p.updatedAt = Math.max(Date.now(),(Number(p.updatedAt)||0)+1);
    finplanePersistEdit_(ss,p,name);
  } catch (err) { console.error("onEdit sync error: " + err); }
  finally { try { lock.releaseLock(); } catch (e) {} }
}
function sheet_(ss, name) { return ss.getSheetByName(name) || ss.insertSheet(name); }

function put_(ss, name, rows) {
  var sh = sheet_(ss, name);
  var w = 1; rows.forEach(function (r) { if (r.length > w) w = r.length; });
  var clearRows = Math.max(sh.getLastRow(), rows.length);
  if (clearRows > 0) sh.getRange(1, 1, clearRows, w).clearContent();
  rows = rows.map(function (r) { while (r.length < w) r.push(""); return r; });
  sh.getRange(1, 1, rows.length, w).setValues(rows);
  sh.setFrozenRows(1);
}

function saveState_(ss, p) {
  var sh = sheet_(ss, STATE_SHEET), s = JSON.stringify(p), rows = [];
  for (var i = 0; i < s.length; i += 40000) rows.push([s.substr(i, 40000)]);
  sh.clearContents(); sh.getRange(1, 1, rows.length, 1).setValues(rows);
  sh.getRange("B1").setValue(Number(p.updatedAt) || Date.now());
  if (!sh.isSheetHidden()) sh.hideSheet();
}

function writeBudget_(ss, logs) {
  return finplaneWriteBudgetSheet_(ss,logs);
}

function writeGoals_(ss, goals) {
  var all = [["ID","Год","Месяц","День","Цель","Сумма","Валюта","Категория","Главная","Статус","Кто добавил"]], byYear = {};
  goals.forEach(function (g) {
    all.push([g.id, g.year, g.month, g.day || 15, g.title, g.amount, g.currency, g.category, g.isMain ? "ДА" : "НЕТ", g.status, g.addedBy || "Семья"]);
    (byYear[g.year] = byYear[g.year] || []).push(g);
  });
  put_(ss, "Цели", all);
  Object.keys(byYear).sort().forEach(function (y) {
    var rows = [["Месяц (" + y + ")","День","Цель / Покупка","Сумма","Валюта","Категория","Статус"]];
    MONTHS.forEach(function (m) {
      byYear[y].filter(function (g) { return g.month === m; })
        .sort(function (a, b) { return (a.day || 15) - (b.day || 15); })
        .forEach(function (g) { rows.push([m, g.day || 15, g.title, g.amount, g.currency, g.category, g.status]); });
    });
    put_(ss, "Цели " + y, rows);
  });
}

function writePlan_(ss, plan, fc) {
  plan = plan || {};
  var rows = [["Параметры плана","Взнос Юрия (₽/мес)","Допдоход (₽/мес)","Допдоход с","Доходность (% год.)"],
              ["", plan.base || 0, plan.extra || 0, plan.extraFrom || "", plan.yieldPct || 0], [],
              ["Месяц","Баланс на начало","Взнос","Проценты","Расходы по целям","Что покупаем / выплачиваем","Баланс на конец","Статус"]];
  fc.forEach(function (r) { rows.push(r); });
  put_(ss, "План-Прогноз", rows);
}

function getCalendar_() {
  var l = CalendarApp.getCalendarsByName(CALENDAR_NAME);
  if (l.length) return l[0];
  return CalendarApp.createCalendar(CALENDAR_NAME, { summary: "Цели, покупки и возврат долгов семьи", timeZone: Session.getScriptTimeZone() });
}

function goalDate_(g) {
  var m = Math.max(0, MONTHS.indexOf(g.month)), y = Number(g.year);
  var dim = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(Number(g.day) || 15, dim));
}

function money_(g) {
  return String(Math.round(Number(g.amount) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + (g.currency === "EUR" ? " €" : " ₽");
}

// Защита от дублей: связь «ID цели → событие» хранится в свойствах скрипта; запасной поиск — по «ID_ЦЕЛИ» в описании.
function syncCalendar_(goals) {
  var cal = getCalendar_(), props = PropertiesService.getScriptProperties();
  var known = props.getProperties(), upd = {}, seen = {}, st = { created: 0, updated: 0, deleted: 0 }, index = null;

  function findByDesc_(id) {
    if (!index) {
      index = {};
      cal.getEvents(new Date(2024, 0, 1), new Date(2045, 0, 1)).forEach(function (ev) {
        var m = /ID_ЦЕЛИ: (\S+)/.exec(ev.getDescription() || ""); if (m) index[m[1]] = ev;
      });
    }
    return index[id] || null;
  }

  goals.forEach(function (g) {
    var key = "ev_" + g.id, done = g.status === "Выполнено"; seen[key] = true;
    var title = (done ? "✅ " : (g.isMain ? "🚨 " : "🎯 ")) + g.title + " — " + money_(g);
    var desc = "ID_ЦЕЛИ: " + g.id + "\nКатегория: " + g.category + "\nСтатус: " + g.status + "\nДобавил: " + (g.addedBy || "Семья");
    var date = goalDate_(g), sig = [title, date.getTime(), desc].join("|");
    var rec = known[key] ? JSON.parse(known[key]) : null, ev = null;
    if (rec) { try { ev = cal.getEventById(rec.eid); } catch (e) { ev = null; } }
    if (!ev) ev = findByDesc_(g.id);
    if (ev) {
      if (!rec || rec.sig !== sig) { ev.setTitle(title); ev.setDescription(desc); ev.setAllDayDate(date); st.updated++; }
    } else { ev = cal.createAllDayEvent(title, date, { description: desc }); st.created++; }
    upd[key] = JSON.stringify({ eid: ev.getId(), sig: sig });
  });

  Object.keys(known).forEach(function (k) {   // цель удалена в приложении → удаляем событие
    if (k.indexOf("ev_") !== 0 || seen[k]) return;
    try { var ev = cal.getEventById(JSON.parse(known[k]).eid); if (ev) ev.deleteEvent(); } catch (e) {}
    props.deleteProperty(k); st.deleted++;
  });
  props.setProperties(upd);
  return st;
}


// ================================================
// FINPLANE — ЖУРНАЛ И КАЛЕНДАРЬ СЕМЕЙНЫХ ПОБЕД
// Источник данных: state.gameAchievements из index.html.
// Синхронизация не удаляет старые события из календаря.
// ================================================

function normalizeFamilyWins_(items) {
  if (!Array.isArray(items)) throw new Error("gameAchievements должен быть массивом");
  var seen = Object.create(null);
  return items.map(function(item) {
    if (!item || typeof item !== "object") throw new Error("Некорректная запись достижения");
    var title = String(item.title || item.name || "").trim();
    if (!title) throw new Error("У достижения отсутствует название");
    var rawDate = item.at || item.date || item.closedAt;
    if (!rawDate) throw new Error("У достижения отсутствует дата: " + title);
    var d = new Date(rawDate);
    if (isNaN(d.getTime())) throw new Error("Некорректная дата достижения: " + title);
    var id = String(item.key || item.id || "").trim();
    if (!id) {
      var seed = [d.toISOString(), title, item.by || "Семья", item.kind || "achievement"].join("|");
      id = Utilities.base64EncodeWebSafe(
        Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, seed)
      ).replace(/=+$/g, "").slice(0, 32);
    }
    if (seen[id]) throw new Error("Повторяющийся ID достижения: " + id);
    seen[id] = true;
    return {
      id: id,
      date: d,
      title: title,
      kind: String(item.kind || "achievement"),
      by: String(item.by || "Семья"),
      amount: Number(item.amount) || 0,
      currency: String(item.currency || "RUB"),
      note: String(item.note || item.description || "")
    };
  });
}

function finplaneReadFamilyWinsSheet_(ss) {
  var sh = ss.getSheetByName("Семейные победы");
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 8).getValues().filter(function (r) {
    return r[0] && r[2];
  }).map(function (r) {
    var date = r[1] instanceof Date ? r[1].toISOString() : String(r[1] || "");
    return {
      key: String(r[0]),
      at: date,
      title: String(r[2]),
      kind: String(r[3] || "achievement"),
      by: String(r[4] || "Семья"),
      amount: Number(r[5]) || 0,
      currency: String(r[6] || "RUB"),
      note: String(r[7] || "")
    };
  });
}

function finplaneMergeFamilyWins_(ss, savedItems, incomingItems) {
  var saved = Array.isArray(savedItems) ? savedItems : [];
  var incoming = Array.isArray(incomingItems) ? incomingItems : [];
  // Всегда читаем лист: в нём могут быть записи, отсутствующие в JSON-состоянии.
  // При совпадении ID приоритет остаётся у saved, затем у листа, затем у входящего массива.
  var sheetItems = finplaneReadFamilyWinsSheet_(ss);
  var merged = [], seen = Object.create(null);

  function add(item) {
    if (!item || typeof item !== "object") return;
    var id = String(item.key || item.id || "").trim();
    if (!id) {
      var title = String(item.title || item.name || "").trim();
      var date = item.at || item.date || item.closedAt || "";
      id = [date, title, item.by || "Семья", item.kind || "achievement"].join("|");
    }
    if (!id || seen[id]) return;
    seen[id] = true;
    merged.push(item);
  }

  saved.concat(sheetItems, incoming).forEach(add);
  return merged;
}

function finplaneLogSyncError_(ss, stage, err, clientUpdatedAt) {
  try {
    if (!ss) return;
    var sh = ss.getSheetByName("_Журнал ошибок синхронизации") || ss.insertSheet("_Журнал ошибок синхронизации");
    if (sh.getLastRow() === 0) {
      sh.appendRow(["Время", "Этап", "Ошибка", "Stack trace", "clientUpdatedAt"]);
      sh.setFrozenRows(1);
    }
    sh.appendRow([new Date(), String(stage || ""), String(err), err && err.stack ? String(err.stack) : "", Number(clientUpdatedAt) || 0]);
  } catch (logErr) {
    console.error("Не удалось записать журнал ошибки синхронизации: " + logErr);
  }
}

function writeFamilyWins_(ss, items) {
  var wins = normalizeFamilyWins_(items);
  var rows = [["ID достижения","Дата и время","Название победы","Тип","Кто","Сумма","Валюта","Описание"]];
  wins.forEach(function(w) {
    rows.push([w.id, w.date, w.title, w.kind, w.by, w.amount, w.currency, w.note]);
  });
  put_(ss, "Семейные победы", rows);
  var sh = ss.getSheetByName("Семейные победы");
  if (sh && sh.getLastRow() > 1) sh.getRange(2, 2, sh.getLastRow() - 1, 1).setNumberFormat("dd.mm.yyyy hh:mm");
  return { total: wins.length };
}

function syncFamilyWinsCalendar_(items) {
  var wins = normalizeFamilyWins_(items);
  var cal = getCalendar_();
  var props = PropertiesService.getScriptProperties();
  var created = 0, updated = 0, unchanged = 0;

  wins.forEach(function(w) {
    var key = "finplane_family_win_" + w.id;
    var title = "🏆 " + w.title;
    var desc = [
      "ID_СЕМЕЙНОЙ_ПОБЕДЫ: " + w.id,
      "Тип: " + w.kind,
      "Кто: " + w.by,
      "Сумма: " + w.amount + " " + w.currency,
      "Описание: " + w.note
    ].join("\n");
    var eventDate = new Date(w.date.getFullYear(), w.date.getMonth(), w.date.getDate());
    var signature = [title, eventDate.getTime(), desc].join("|");
    var record = null, event = null;
    try {
      var saved = props.getProperty(key);
      if (saved) {
        record = JSON.parse(saved);
        if (record.eventId) event = cal.getEventById(record.eventId);
      }
    } catch (err) { event = null; }

    if (!event) {
      var from = new Date(eventDate.getTime() - 86400000);
      var to = new Date(eventDate.getTime() + 2 * 86400000);
      var candidates = cal.getEvents(from, to);
      for (var i = 0; i < candidates.length; i++) {
        if ((candidates[i].getDescription() || "").indexOf("ID_СЕМЕЙНОЙ_ПОБЕДЫ: " + w.id) !== -1) {
          event = candidates[i];
          break;
        }
      }
    }

    if (event) {
      if (!record || record.signature !== signature) {
        event.setTitle(title);
        event.setDescription(desc);
        event.setAllDayDate(eventDate);
        updated++;
      } else {
        unchanged++;
      }
    } else {
      event = cal.createAllDayEvent(title, eventDate, { description: desc });
      created++;
    }

    props.setProperty(key, JSON.stringify({
      eventId: event.getId(),
      signature: signature
    }));
  });

  return { total: wins.length, created: created, updated: updated, unchanged: unchanged };
}

// Market functions are defined in MarketData.gs.


/***************************************************************
 * MODULE: BudgetIdentity.gs
 * Original repository file; keep this section intact.
 ***************************************************************/

/** Stable identity preparation. Pure: never mutates the input snapshot. */
function finplanePrepareBudgetIds(logs, makeId) {
  if (!Array.isArray(logs)) throw new Error("budgetLogs must be an array");
  if (typeof makeId !== "function") throw new Error("ID factory required");
  var copy = JSON.parse(JSON.stringify(logs));
  var operations = Object.create(null);
  function key(value) { return value == null ? "" : String(value).trim(); }
  copy.forEach(function(log) {
    if (!log || typeof log !== "object" || Array.isArray(log)) throw new Error("Invalid operation");
    var id = key(log.id);
    if (id) {
      if (operations[id]) throw new Error("Duplicate operation ID: " + id);
      operations[id] = true;
    }
    if (log.items != null && !Array.isArray(log.items)) throw new Error("Invalid items");
  });
  function fresh(used) {
    for (var n = 0; n < 100; n++) {
      var id = key(makeId());
      if (id && !used[id]) { used[id] = true; return id; }
    }
    throw new Error("Cannot generate unique ID");
  }
  copy.forEach(function(log) {
    if (!key(log.id)) log.id = fresh(operations);
    var items = log.items || [], used = Object.create(null);
    items.forEach(function(item) {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid item");
      var id = key(item.id);
      if (id) {
        if (used[id]) throw new Error("Duplicate item ID: " + id);
        used[id] = true;
      }
    });
    items.forEach(function(item) { if (!key(item.id)) item.id = fresh(used); });
  });
  return copy;
}
if (typeof module !== "undefined" && module.exports) module.exports = finplanePrepareBudgetIds;


/***************************************************************
 * MODULE: BudgetSheet.gs
 * Original repository file; keep this section intact.
 ***************************************************************/

/** Budget sheet identity format: A:J data, K operation ID, L item ID. */
function finplaneCheckBudgetSheet_(ss) {
  var sh = ss.getSheetByName("Статистика Бюджета");
  if (!sh) return;
  var allowed = ["_ID операции", "_ID статьи"];
  for (var col = 11; col <= Math.min(12, sh.getMaxColumns()); col++) {
    var cells = sh.getRange(1, col, Math.max(1, sh.getLastRow()), 1).getValues();
    if (cells.some(function(r) { return r[0] !== ""; }) && String(cells[0][0]) !== allowed[col - 11]) {
      throw new Error("Колонка " + col + " занята: бюджет не перезаписан");
    }
  }
}
function finplaneBudgetRows_(logs) {
  finplaneValidateBudgetLogs_(logs);
  var rows = [["Дата","Пользователь","Режим","Получено (₽)","Тип","Статья","Сумма статьи (₽)","В инвестиции (₽)","В наличные на руках (₽)","Не распределено (₽)","_ID операции","_ID статьи"]];
  var labels = {expense:"Расход", investment:"Инвестиции", cash:"Наличные на руках"};
  logs.forEach(function(log) {
    if (log.id == null || String(log.id).trim() === "") throw new Error("Нет ID операции");
    var cash = log.mode === "cash_expense";
    var un = cash ? "" : Math.max(0,(Number(log.income)||0)-(Number(log.totalExpenses)||0)-(Number(log.investedRemainder)||0)-(Number(log.cashAdded)||0));
    (log.items && log.items.length ? log.items : [null]).forEach(function(item,i) {
      if (item && (item.id == null || String(item.id).trim() === "")) throw new Error("Нет ID статьи");
      rows.push([log.date||"",log.user||"",cash?"Расход из наличных (17к)":"Поступление бюджета",i===0?(Number(log.income)||0):"",item?(labels[item.type]||"Расход"):"—",item?(item.categoryName||""):"Без статей",item?(Number(item.amount)||0):0,i===0?(Number(log.investedRemainder)||0):"",i===0?(Number(log.cashAdded)||0):"",i===0?un:"",String(log.id),item?String(item.id):""]);
    });
  });
  return rows;
}
function finplaneWriteBudgetSheet_(ss,logs) {
  finplaneCheckBudgetSheet_(ss);
  var rows = finplaneBudgetRows_(logs);
  var sh = ss.getSheetByName("Статистика Бюджета");
  if (sh && sh.getMaxColumns() < 12) sh.insertColumnsAfter(sh.getMaxColumns(),12-sh.getMaxColumns());
  put_(ss,"Статистика Бюджета",rows);
  ss.getSheetByName("Статистика Бюджета").hideColumns(11,2);
}
function finplaneImportBudgetRows_(rows,previous) {
  finplaneValidateBudgetLogs_(previous);
  var old = Object.create(null), groups = Object.create(null), ordered = [], seen = Object.create(null);
  previous.forEach(function(log) {
    var id = String(log.id);
    if (old[id]) throw new Error("Повторный ID в исходном состоянии");
    old[id] = log;
  });
  function number(value) {
    if (value === "" || value == null) throw new Error("Пустая сумма: укажите 0 явно");
    var n = Number(value);
    if (!isFinite(n) || n < 0) throw new Error("Некорректная сумма");
    return n;
  }
  rows.forEach(function(r) {
    if (!r.some(function(v) { return v !== "" && v != null; })) return;
    var id = r[10] == null ? "" : String(r[10]);
    if (!id.trim() || !old[id]) throw new Error("Неизвестный ID операции: сначала создайте операцию в приложении");
    var prior = old[id], cash = String(r[2]||"").indexOf("Расход из наличных") === 0;
    var mode = cash ? "cash_expense" : "income";
    var log = groups[id];
    if (!log) {
      log = Object.assign({},prior,{date:String(r[0]||""),user:String(r[1]||"Семья"),mode:mode,items:[],totalExpenses:0});
      groups[id] = log; ordered.push(log);
    } else if (log.date !== String(r[0]||"") || log.user !== String(r[1]||"Семья") || log.mode !== mode) {
      throw new Error("Строки одной операции имеют разные дату, пользователя или режим");
    }
    [[3,"income"]].forEach(function(pair) {
      if (r[pair[0]] === "" || r[pair[0]] == null) return;
      var key = JSON.stringify([id,pair[1]]);
      if (seen[key]) throw new Error("Повторный итог операции");
      seen[key] = true; log[pair[1]] = number(r[pair[0]]);
    });
    var itemId = r[11] == null ? "" : String(r[11]);
    if (!itemId.trim()) {
      if ((prior.items||[]).length || String(r[5]||"") !== "Без статей") throw new Error("Нет ID статьи");
      var emptyKey = JSON.stringify([id,"empty"]);
      if (seen[emptyKey]) throw new Error("Повторная пустая операция");
      seen[emptyKey] = true; return;
    }
    var itemKey = JSON.stringify([id,"item",itemId]);
    if (seen[itemKey]) throw new Error("Повторный ID статьи");
    seen[itemKey] = true;
    var priorItem = (prior.items||[]).filter(function(it) { return String(it.id) === itemId; })[0];
    if (!priorItem) throw new Error("Неизвестный ID статьи");
    var types = {"Расход":"expense","Инвестиции":"investment","Наличные на руках":"cash"};
    var type = types[String(r[4])];
    if (!type || !String(r[5]||"").trim()) throw new Error("Укажите тип и статью");
    var item = Object.assign({},priorItem,{type:type,categoryName:String(r[5]),amount:number(r[6])});
    log.items.push(item);
    if (type === "expense") log.totalExpenses += item.amount;
  });
  if (!ordered.length && previous.length) throw new Error("Пустой лист не может стереть историю бюджета");
  ordered.forEach(function(log) {
    var id=String(log.id);
    if(log.mode==="income" && !seen[JSON.stringify([id,"income"])]) throw new Error("Пустой доход: укажите 0 явно");
    log.investedRemainder=0;log.cashAdded=0;
    log.items.forEach(function(item){if(item.type==="investment")log.investedRemainder+=item.amount;if(item.type==="cash")log.cashAdded+=item.amount;});
    if(log.mode==="cash_expense" && log.cashAdded)throw new Error("Нельзя повторно переводить наличные в наличные");
  });
  if(ordered.length!==previous.length)throw new Error("Удаляйте операции через приложение; импорт остановлен");
  finplaneValidateBudgetLogs_(ordered);
  return ordered;
}
function finplaneReadBudgetSheet_(sh,previous) {
  if (sh.getMaxColumns() < 12 || sh.getRange(1,11).getValue() !== "_ID операции" || sh.getRange(1,12).getValue() !== "_ID статьи") {
    throw new Error("Старая структура бюджета: требуется проверенная миграция из JSON");
  }
  var rows = sh.getLastRow()>1 ? sh.getRange(2,1,sh.getLastRow()-1,12).getValues() : [];
  rows.forEach(function(r) {
    if (r[0] instanceof Date) r[0] = Utilities.formatDate(r[0],Session.getScriptTimeZone(),"yyyy-MM-dd");
  });
  return finplaneImportBudgetRows_(rows,previous);
}


/***************************************************************
 * MODULE: FinplaneSafety.gs
 * Original repository file; keep this section intact.
 ***************************************************************/

function finplaneMoney_(value, label) {
  if (value === "" || value == null) throw new Error("Пустая сумма: " + label);
  var n = Number(value);
  if (!isFinite(n) || n < 0) throw new Error("Некорректная сумма: " + label);
  return n;
}
function finplaneValidateBudgetLogs_(logs) {
  if (!Array.isArray(logs)) throw new Error("budgetLogs должен быть массивом");
  logs.forEach(function(log) {
    if (!log || !Array.isArray(log.items)) throw new Error("Некорректная операция бюджета");
    ["income","totalExpenses","investedRemainder","cashAdded"].forEach(function(k) { finplaneMoney_(log[k] == null ? 0 : log[k], k); });
    var sums={expense:0,investment:0,cash:0};
    log.items.forEach(function(item) {
      if (!item || ["expense","investment","cash"].indexOf(item.type) < 0) throw new Error("Некорректный тип статьи");
      sums[item.type]+=finplaneMoney_(item.amount,"amount");
    });
    [["expense","totalExpenses"],["investment","investedRemainder"],["cash","cashAdded"]].forEach(function(pair) {
      if (Math.abs(sums[pair[0]]-Number(log[pair[1]]||0))>0.005) throw new Error("Итог не совпадает со статьями: "+pair[1]+"; требуется сверка исходной операции");
    });
  });
}
function finplaneValidateGoals_(goals) {
  if (!Array.isArray(goals)) throw new Error("goals должен быть массивом");
  var seen = Object.create(null);
  goals.forEach(function(g) {
    if (!g || g.id == null || !String(g.id).trim() || !String(g.title || "").trim()) throw new Error("Нужны ID и название цели");
    if (seen[String(g.id)]) throw new Error("Повторный ID цели");
    seen[String(g.id)] = true;
    finplaneMoney_(g.amount,"goal amount");
    var y=Number(g.year), d=g.day == null ? 15 : Number(g.day);
    if (y < 1900 || y > 2200 || Math.floor(y)!==y || MONTHS.indexOf(g.month)<0 || d<1 || d>31 || Math.floor(d)!==d) throw new Error("Некорректная дата цели");
  });
}
function finplaneTransaction_(ss,p,write) {
  var names=[STATE_SHEET,"Статистика Бюджета","Цели","План-Прогноз","Сводка (приложение)","Где были","Семейные победы"];
  (p.goals||[]).forEach(function(g) { names.push("Цели "+g.year); });
  ss.getSheets().forEach(function(sh) { if (/^Цели \d{4}$/.test(sh.getName())) names.push(sh.getName()); });
  var snapshots=Object.create(null);
  names.forEach(function(name) {
    if (Object.prototype.hasOwnProperty.call(snapshots,name)) return;
    var sh=ss.getSheetByName(name);
    if (!sh) { snapshots[name]=null; return; }
    var range=sh.getDataRange(), values=range.getValues(), formulas=range.getFormulas();
    values.forEach(function(row,i) { row.forEach(function(value,j) { if(formulas[i][j]) row[j]=formulas[i][j]; }); });
    snapshots[name]={values:values,hidden:sh.isSheetHidden()};
  });
  try { return write(); }
  catch (err) {
    var failures=[];
    Object.keys(snapshots).forEach(function(name) {
      try {
        var snap=snapshots[name],sh=ss.getSheetByName(name);
        if (!snap) { if(sh)ss.deleteSheet(sh); return; }
        if (!sh) throw new Error("Лист исчез: "+name);
        sh.getDataRange().clearContent();
        sh.getRange(1,1,snap.values.length,snap.values[0].length).setValues(snap.values);
        if (snap.hidden && !sh.isSheetHidden()) sh.hideSheet();
      } catch (restoreError) { failures.push(name+": "+restoreError); }
    });
    if (failures.length) throw new Error("Ошибка записи; восстановление неполное: "+failures.join("; ")+"; исходная ошибка: "+err);
    throw err;
  }
}
function finplanePersistEdit_(ss,p,name) {
  finplaneValidateGoals_(p.goals||[]);
  finplaneValidateBudgetLogs_(p.budgetLogs||[]);
  finplaneCheckBudgetSheet_(ss);
  finplaneTransaction_(ss,p,function() {
    if (name === "Статистика Бюджета") finplaneWriteBudgetSheet_(ss,p.budgetLogs||[]);
    else writeGoals_(ss,p.goals||[]);
    if (name === "Цели") PropertiesService.getScriptProperties().setProperty("FINPLANE_CALENDAR_PENDING","1");
    saveState_(ss,p);
  });
}
function finplaneSetupCalendarTrigger_() {
  var exists=ScriptApp.getProjectTriggers().some(function(t) { return t.getHandlerFunction()==="finplaneSyncPendingCalendar"; });
  if (!exists) ScriptApp.newTrigger("finplaneSyncPendingCalendar").timeBased().everyMinutes(5).create();
}
function finplaneSyncPendingCalendar() {
  var lock=LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    var props=PropertiesService.getScriptProperties();
    if (props.getProperty("FINPLANE_CALENDAR_PENDING")!=="1") return;
    var ss=SpreadsheetApp.getActiveSpreadsheet(),sh=ss.getSheetByName(STATE_SHEET);
    if (!sh || !sh.getRange("A1").getValue()) return;
    var p=JSON.parse(sh.getRange(1,1,sh.getLastRow(),1).getValues().map(function(r){return r[0]||"";}).join(""));
    finplaneValidateGoals_(p.goals||[]);
    syncCalendar_(p.goals||[]);
    props.deleteProperty("FINPLANE_CALENDAR_PENDING");
  } finally { lock.releaseLock(); }
}


/***************************************************************
 * MODULE: MarketData.gs
 * Original repository file; keep this section intact.
 ***************************************************************/

/** Market data: script-owned auto rows, protected manual/formula rows. */
var MARKET_SHEET="Рыночные данные";
var MARKET_HEADERS=["metric_id","Показатель","Значение","Единица","Дата данных","Обновлено","Источник","Режим"];
var FINPLANE_OFZ_TERMS=[0.25,0.5,0.75,1,2,3,5,7,10,15,20,30];
var FINPLANE_OFZ_IDS=["ofz_0_25","ofz_0_5","ofz_0_75","ofz_1","ofz_2","ofz_3","ofz_5","ofz_7","ofz_10","ofz_15","ofz_20","ofz_30"];
function marketDefinitions_(){
  var base="https://www.cbr.ru/",defs=[
    ["eur_rub","Курс евро ЦБ","₽ за 1 EUR",base+"scripts/XML_daily.asp","auto"],
    ["key_rate","Ключевая ставка ЦБ","% годовых",base+"hd_base/KeyRate/","auto"]];
  FINPLANE_OFZ_IDS.forEach(function(id,i){defs.push([id,"ОФЗ "+String(FINPLANE_OFZ_TERMS[i]).replace(".",",")+" года","% годовых",base+"hd_base/zcyc_params/zcyc/","auto"]);});
  return defs.concat([
    ["inflation_yoy","Инфляция год к году","% годовых",base+"hd_base/infl/","auto"],
    ["liquidity_base","Средняя базовая ставка накопительных счетов","% годовых","https://finuslugi.ru/","manual"],
    ["liquidity_max","Средняя максимальная ставка с условиями","% годовых","https://finuslugi.ru/","manual"]]);
}
function marketNumber_(v){
  if(typeof v==="number")return isFinite(v)?v:null;
  var s=String(v==null?"":v).replace(/[\s\u00a0\u202f]/g,"").replace(/[−–]/g,"-").replace(",",".");
  return /^-?\d+(\.\d+)?$/.test(s)&&isFinite(Number(s))?Number(s):null;
}
function finplaneMarketText_(html){return String(html).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi," ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi," ").replace(/<[^>]*>/g," ").replace(/&nbsp;|&#160;|&#xA0;/gi," ").replace(/&minus;/gi,"-").replace(/&amp;/gi,"&").replace(/\s+/g," ").trim();}
function cbrTableRows_(html){
  var rows=[];
  (String(html).match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)||[]).forEach(function(row){
    var cells=[],re=/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi,m;
    while((m=re.exec(row)))cells.push(finplaneMarketText_(m[1]));
    if(cells.length)rows.push(cells);
  });
  return rows;
}
function finplaneMarketDateScore_(s,monthly){
  var m=(monthly?/^(\d{2})\.(\d{4})$/:/^(\d{2})\.(\d{2})\.(\d{4})$/).exec(String(s).trim());
  if(!m)return 0;
  var y=Number(m[monthly?2:3]),month=Number(m[monthly?1:2]),day=monthly?1:Number(m[1]);
  var d=new Date(y,month-1,day);
  return y>=1900&&y<=2200&&d.getFullYear()===y&&d.getMonth()===month-1&&d.getDate()===day?y*10000+month*100+day:0;
}
function finplaneMarketLatest_(rows,column,monthly){
  var found=null,score=0;
  rows.forEach(function(r){var s=finplaneMarketDateScore_(r[0],monthly),v=marketNumber_(r[column]);if(s>score&&v!==null&&v>=-100&&v<=100){score=s;found={value:v,date:r[0]};}});
  if(!found)throw new Error("Не найдены числовые данные с датой");
  return found;
}
function finplaneParseCbrOfz_(html){
  var found=null,best=0;
  (String(html).match(/<table\b[^>]*>[\s\S]*?<\/table>/gi)||[]).forEach(function(table){
    var rows=cbrTableRows_(table),terms=null;
    rows.some(function(row){
      var nums=row.map(marketNumber_).filter(function(n){return n!==null;});
      if(nums.length===12&&FINPLANE_OFZ_TERMS.every(function(t){return nums.indexOf(t)>=0;})){terms=nums;return true;}
      return false;
    });
    if(!terms)return;
    rows.forEach(function(row){
      var date=row[0],values=null,score=finplaneMarketDateScore_(date,false);
      if(score&&row.length===13)values=row.slice(1).map(marketNumber_);
      else if(/доходност/i.test(row[0]||"")&&row.length===13){
        values=row.slice(1).map(marketNumber_);
        var plain=finplaneMarketText_(html),title="Кривая бескупонной доходности государственных облигаций",pos=plain.lastIndexOf(title);
        var m=pos>=0?/\b\d{2}\.\d{2}\.\d{4}\b/.exec(plain.slice(pos+title.length,pos+title.length+1200)):null;
        date=m?m[0]:"";score=finplaneMarketDateScore_(date,false);
      }
      if(!score||!values||values.length!==12||values.some(function(n){return n===null||n<-100||n>100;}))return;
      if(score>best){var data={};FINPLANE_OFZ_TERMS.forEach(function(t,i){data[FINPLANE_OFZ_IDS[i]]=values[terms.indexOf(t)];});found={values:data,date:date};best=score;}
    });
  });
  if(!found)throw new Error("Кривая ОФЗ не распознана: нужны 12 сроков, 12 доходностей и дата источника");
  return found;
}
function fetchText_(url){
  if(!/^https:\/\/(www\.)?cbr\.ru\/(scripts\/XML_daily\.asp|hd_base\/(KeyRate|infl|zcyc_params(\/zcyc)?)\/)$/i.test(url))throw new Error("Источник не разрешён: "+url);
  var r=UrlFetchApp.fetch(url,{muteHttpExceptions:true,followRedirects:true,headers:{"User-Agent":"Finplane/1.1"}});
  if(r.getResponseCode()<200||r.getResponseCode()>=300)throw new Error("HTTP "+r.getResponseCode());
  return r.getContentText("UTF-8");
}
function finplaneEnsureMarketSheet_(){
  var ss=SpreadsheetApp.getActiveSpreadsheet(),sh=ss.getSheetByName(MARKET_SHEET);
  if(!sh)sh=ss.insertSheet(MARKET_SHEET);
  if(sh.getLastRow()===0)sh.getRange(1,1,1,8).setValues([MARKET_HEADERS]);
  var header=sh.getRange(1,1,1,8).getValues()[0];
  if(header.some(function(v,i){return String(v)!==MARKET_HEADERS[i];}))throw new Error("Неизвестная структура рыночного листа; запись остановлена");
  var rows=sh.getLastRow()>1?sh.getRange(2,1,sh.getLastRow()-1,8).getValues():[],seen=Object.create(null);
  rows.forEach(function(r){if(r[0]){if(seen[String(r[0])])throw new Error("Повторный metric_id");seen[String(r[0])]=true;}});
  marketDefinitions_().forEach(function(d){if(!seen[d[0]])sh.appendRow([d[0],d[1],"",d[2],"","",d[3],d[4]]);});
  sh.setFrozenRows(1);return sh;
}
function finplaneMarketRows_(sh){
  var values=sh.getRange(2,1,sh.getLastRow()-1,8).getValues(),formulas=sh.getRange(2,1,sh.getLastRow()-1,8).getFormulas();
  var rows=values.map(function(r,i){return {row:i+2,id:String(r[0]||""),data:r,formulas:formulas[i],mode:String(r[7]||"").toLowerCase()};});
  var ofz=rows.filter(function(r){return FINPLANE_OFZ_IDS.indexOf(r.id)>=0;});
  if(ofz.some(function(r){return r.formulas[2]||r.formulas[4]||r.formulas[5];})&&ofz.some(function(r){return r.mode!=="formula";}))throw new Error("Для формул/массивов ОФЗ установите formula для всех 12 сроков; автоматическая запись остановлена");
  return rows;
}
function finplaneMarketWritable_(row){return row.mode==="auto"&&!row.formulas[2]&&!row.formulas[4]&&!row.formulas[5];}
function refreshMarketData_(){
  var lock=LockService.getScriptLock();if(!lock.tryLock(1000))return {status:"busy"};
  try{
    var sh=finplaneEnsureMarketSheet_(),rows=finplaneMarketRows_(sh),cache=Object.create(null),updates=Object.create(null),status=Object.create(null);
    var stamp=Utilities.formatDate(new Date(),Session.getScriptTimeZone(),"yyyy-MM-dd HH:mm:ss"),failed=0;
    function text(url){if(!Object.prototype.hasOwnProperty.call(cache,url)){try{cache[url]={text:fetchText_(url)};}catch(e){cache[url]={error:String(e)};}}if(cache[url].error)throw new Error(cache[url].error);return cache[url].text;}
    rows.forEach(function(row){
      if(!finplaneMarketWritable_(row)){status[row.id]={status:row.mode==="manual"?"manual":"formula_or_protected",checkedAt:stamp};return;}
      try{
        var url=String(row.data[6]||""),fresh;
        if(row.id==="eur_rub"){
          var root=XmlService.parse(text(url)).getRootElement(),value=null;
          root.getChildren("Valute").forEach(function(v){if(v.getChildText("CharCode")==="EUR"){var n=marketNumber_(v.getChildText("Nominal")),a=marketNumber_(v.getChildText("Value"));if(n>0&&a>0)value=a/n;}});
          var date=root.getAttribute("Date");
          if(value===null||!date||!finplaneMarketDateScore_(date.getValue(),false))throw new Error("Некорректный XML EUR");
          fresh={value:value,date:date.getValue()};
        }else if(row.id==="key_rate")fresh=finplaneMarketLatest_(cbrTableRows_(text(url)),1,false);
        else if(row.id==="inflation_yoy")fresh=finplaneMarketLatest_(cbrTableRows_(text(url)),2,true);
        else if(FINPLANE_OFZ_IDS.indexOf(row.id)>=0){var curve=finplaneParseCbrOfz_(text(url));fresh={value:curve.values[row.id],date:curve.date};}
        else throw new Error("Нет автоматического загрузчика для "+row.id);
        updates[row.id]={value:fresh.value,date:fresh.date,source:url};
        status[row.id]={status:"ok",checkedAt:stamp};
      }catch(e){failed++;status[row.id]={status:"error",checkedAt:stamp,error:String(e)};}
    });
    var current=finplaneMarketRows_(sh),written=0;
    current.forEach(function(row){var fresh=updates[row.id];if(!fresh||!finplaneMarketWritable_(row)||String(row.data[6]||"")!==fresh.source)return;sh.getRange(row.row,3).setValue(fresh.value);sh.getRange(row.row,5,1,2).setValues([[fresh.date,stamp]]);written++;});
    PropertiesService.getScriptProperties().setProperty("FINPLANE_MARKET_STATUS",JSON.stringify(status));
    return {status:failed?"partial":"ok",checkedAt:stamp,automaticMetrics:written,errors:failed};
  }finally{lock.releaseLock();}
}
function setupMarketData(){
  finplaneEnsureMarketSheet_();
  var triggers=ScriptApp.getProjectTriggers(),hourly=triggers.filter(function(t){return t.getHandlerFunction()==="finplaneRefreshMarketHourly";});
  if(!hourly.length)ScriptApp.newTrigger("finplaneRefreshMarketHourly").timeBased().everyHours(1).create();
  triggers.forEach(function(t){if(t.getHandlerFunction()==="refreshMarketData_")ScriptApp.deleteTrigger(t);});
  hourly.slice(1).forEach(function(t){ScriptApp.deleteTrigger(t);});
  return refreshMarketData_();
}
function finplaneRefreshMarketHourly(){return refreshMarketData_();}
function enableFinplaneAutomaticInflation(){
  var sh=finplaneEnsureMarketSheet_(),rows=finplaneMarketRows_(sh);
  var row=rows.filter(function(r){return r.id==="inflation_yoy";})[0];
  if(row.formulas[2]||row.formulas[4]||row.formulas[5]||row.mode==="formula")throw new Error("Формулы инфляции сохранены; сначала выберите один способ обновления");
  sh.getRange(row.row,7,1,2).setValues([["https://www.cbr.ru/hd_base/infl/","auto"]]);
  return setupMarketData();
}
function finplaneStampMarketEdit_(e){
  if(!e||!e.range)return;
  var range=e.range,sh=range.getSheet();
  if(sh.getName()!==MARKET_SHEET||range.getColumn()>3||range.getLastColumn()<3)return;
  for(var row=Math.max(2,range.getRow());row<=range.getLastRow();row++){
    if(String(sh.getRange(row,8).getValue()).toLowerCase()!=="manual"||sh.getRange(row,3).getFormula())continue;
    if(marketNumber_(sh.getRange(row,3).getValue())===null)continue;
    var now=new Date(),tz=Session.getScriptTimeZone();
    if(!sh.getRange(row,5).getValue())sh.getRange(row,5).setValue(Utilities.formatDate(now,tz,"dd.MM.yyyy"));
    sh.getRange(row,6).setValue(Utilities.formatDate(now,tz,"yyyy-MM-dd HH:mm:ss"));
  }
}
function readMarketData_(){
  var sh=SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MARKET_SHEET),out={};
  if(!sh||sh.getLastRow()<2||String(sh.getRange(1,1).getValue())!=="metric_id")return out;
  var statuses={};try{statuses=JSON.parse(PropertiesService.getScriptProperties().getProperty("FINPLANE_MARKET_STATUS")||"{}");}catch(e){}
  function date(v,format){return v instanceof Date?Utilities.formatDate(v,Session.getScriptTimeZone(),format):v;}
  sh.getRange(2,1,sh.getLastRow()-1,8).getValues().forEach(function(r){if(r[0])out[String(r[0])]={value:marketNumber_(r[2]),unit:r[3],date:date(r[4],"dd.MM.yyyy"),updatedAt:date(r[5],"yyyy-MM-dd HH:mm:ss"),source:r[6],mode:r[7],refresh:statuses[String(r[0])]||null};});
  return out;
}
