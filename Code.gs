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

function doPost(e) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return json_({ status: "busy" });
  try {
    var p = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!(p.goals && p.goals.length) && !(p.loans && p.loans.length) && !(p.budgetLogs && p.budgetLogs.length)) return json_({ status: "ignored", message: "пустое состояние не сохраняется" });
    var currentStateSheet = ss.getSheetByName(STATE_SHEET);
    var currentUpdatedAt = Number(currentStateSheet ? currentStateSheet.getRange("B1").getValue() : 0) || 0;
    var currentClientUpdatedAt = 0;
    if (currentStateSheet && currentStateSheet.getLastRow() > 0) {
      var currentRaw = currentStateSheet.getRange(1, 1, currentStateSheet.getLastRow(), 1).getValues().map(function (r) { return r[0]; }).join("");
      try { currentClientUpdatedAt = Number(JSON.parse(currentRaw).clientUpdatedAt) || 0; } catch (readErr) {}
    }
    var incomingUpdatedAt = Number(p.updatedAt) || 0;
    if (!incomingUpdatedAt) return json_({ status: "error", message: "missing client updatedAt" });
    if (currentClientUpdatedAt > 0 && incomingUpdatedAt < currentClientUpdatedAt) {
      return json_({ status: "stale", serverUpdatedAt: currentUpdatedAt, currentClientUpdatedAt: currentClientUpdatedAt, incomingUpdatedAt: incomingUpdatedAt });
    }
    // BudgetIdentity.gs is required. Validate and assign IDs before any writes.
    // Both the JSON snapshot and budget projection receive the same prepared logs.
    p.budgetLogs = finplanePrepareBudgetIds(p.budgetLogs == null ? [] : p.budgetLogs, function () {
      return Utilities.getUuid();
    });
    finplaneValidateGoals_(p.goals||[]);
    finplaneValidateBudgetLogs_(p.budgetLogs||[]);
    finplaneCheckBudgetSheet_(ss);
    finplaneBudgetRows_(p.budgetLogs||[]);
    p.clientUpdatedAt = incomingUpdatedAt;
    p.updatedAt=Math.max(Date.now(),currentUpdatedAt+1);
    finplaneTransaction_(ss,p,function() {
    writeBudget_(ss, p.budgetLogs || []);                // 2. «Статистика Бюджета»
    writeGoals_(ss, p.goals || []);                      // 3. «Цели» и «Цели ГГГГ»
    writePlan_(ss, p.plan, p.forecast || []);            // 3б. «План-Прогноз»
    put_(ss, "Сводка (приложение)", [["Показатель","Значение"]].concat(p.summary || []));   // 3г. итоговые цифры из приложения
    put_(ss, "Где были", [["Дата","Место","Локация","Тип","Заметка","Кто отметил"]].concat(p.trips || []));  // 3в. выходные и поездки
      saveState_(ss,p);
    });
    var cal = { error: null };
    try { cal = syncCalendar_(p.goals || []); } catch (err) { cal = { error: String(err) }; }  // 4. Календарь
    return json_({ status: "ok", updatedAt:p.updatedAt, calendar: cal });
  } catch (err) {
    return json_({ status: "error", message: String(err) });
  } finally { lock.releaseLock(); }
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


// Market functions are defined in MarketData.gs.
