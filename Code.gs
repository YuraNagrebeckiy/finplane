/**
 * Семейный Финансовый Навигатор — бэкенд (Google Apps Script)
 * Развёртывание: Начать → Развернуть → Новое развёртывание → Веб-приложение
 *   Выполнять от имени: Я | У кого есть доступ: Все
 * После ЛЮБОГО изменения кода: Развернуть → Управление → ✏️ → Новая версия.
 * Первый запуск: выберите функцию authorize() и нажмите «Выполнить» — выдайте доступ к Таблице и Календарю.
 *
 * Доступ второму аккаунту к календарю: calendar.google.com → слева у «Финансы и Цели» ⋮ →
 * «Настройки и общий доступ» → «Доступ для отдельных пользователей» → Добавить → e-mail → «Вносить изменения и управлять доступом» или «Просмотр всех сведений».
 */
var CALENDAR_NAME = "Финансы и Цели";
var STATE_SHEET = "_Состояние";
var MONTHS = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];

function authorize() { getCalendar_(); SpreadsheetApp.getActiveSpreadsheet(); setupMarketData(); }

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function doGet(e) {
  if (e && e.parameter && e.parameter.market) return json_({ status: "ok", metrics: readMarketData_() });
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(STATE_SHEET);
  if (e && e.parameter && e.parameter.ts) return json_({ updatedAt: Number(sh ? sh.getRange("B1").getValue() : 0) || 0 });   // быстрая проверка «есть ли новое»
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
    if (!(p.goals && p.goals.length) && !(p.budgetLogs && p.budgetLogs.length)) return json_({ status: "ignored", message: "пустое состояние не сохраняется" });  // защита от затирания данных
    saveState_(ss, p);                                   // 1. полный снимок (для загрузки на другие устройства)
    writeBudget_(ss, p.budgetLogs || []);                // 2. «Статистика Бюджета»
    writeGoals_(ss, p.goals || []);                      // 3. «Цели» и «Цели ГГГГ»
    writePlan_(ss, p.plan, p.forecast || []);            // 3б. «План-Прогноз»
    put_(ss, "Сводка (приложение)", [["Показатель","Значение"]].concat(p.summary || []));   // 3г. итоговые цифры из приложения
    put_(ss, "Где были", [["Дата","Место","Локация","Тип","Заметка","Кто отметил"]].concat(p.trips || []));  // 3в. выходные и поездки
    var cal = { error: null };
    try { cal = syncCalendar_(p.goals || []); } catch (err) { cal = { error: String(err) }; }  // 4. Календарь
    return json_({ status: "ok", calendar: cal });
  } catch (err) {
    return json_({ status: "error", message: String(err) });
  } finally { lock.releaseLock(); }
}

function onEdit(e) {
  try {
    if (!e || !e.range) return;
    var sh = e.range.getSheet(), name = sh.getName();
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
    } else {
      var rows = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 10).getValues() : [];
      var oldLogs = p.budgetLogs || [], buckets = {};
      oldLogs.forEach(function(l) { var k = [l.date, l.user, l.mode].join("|"); (buckets[k] = buckets[k] || []).push(l); });
      var groups = [], current = null;
      rows.forEach(function(r) {
        if (!r[0] && !r[1] && !r[5]) return;
        var cashMode = String(r[2] || "").indexOf("Расход из наличных") === 0;
        if (!current || (r[3] !== "" && r[3] != null)) {
          var date = r[0] instanceof Date ? Utilities.formatDate(r[0], Session.getScriptTimeZone(), "yyyy-MM-dd") : String(r[0] || "");
          var key = [date, String(r[1] || ""), cashMode ? "cash_expense" : "income"].join("|");
          var prior = buckets[key] && buckets[key].length ? buckets[key].shift() : null;
          current = { id: prior ? prior.id : "sheet-" + Date.now() + "-" + groups.length, date: date, user: String(r[1] || "Семья"), mode: cashMode ? "cash_expense" : "income", income: Number(r[3]) || 0, items: [], totalExpenses: 0, investedRemainder: Number(r[7]) || 0, cashAdded: Number(r[8]) || 0 };
          groups.push(current);
        }
        var typeText = String(r[4] || "");
        var type = typeText === "Инвестиции" ? "investment" : (typeText === "Наличные на руках" ? "cash" : "expense");
        var category = String(r[5] || "");
        var amount = Number(r[6]) || 0;
        if (category && category !== "Без статей" && category !== "—") {
          current.items.push({ id: current.id + "-" + current.items.length, type: type, categoryName: category, amount: amount });
          if (type === "expense") current.totalExpenses += amount;
        }
        if (r[7] !== "" && r[7] != null) current.investedRemainder = Number(r[7]) || 0;
        if (r[8] !== "" && r[8] != null) current.cashAdded = Number(r[8]) || 0;
      });
      p.budgetLogs = groups;
    }
    p.updatedAt = Date.now();
    saveState_(ss, p);
  } catch (err) { console.error("onEdit sync error: " + err); }
}
function sheet_(ss, name) { return ss.getSheetByName(name) || ss.insertSheet(name); }

function put_(ss, name, rows) {
  var sh = sheet_(ss, name); sh.clearContents();
  var w = 1; rows.forEach(function (r) { if (r.length > w) w = r.length; });
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
  var rows = [["Дата","Пользователь","Режим","Получено (₽)","Тип","Статья","Сумма статьи (₽)","В инвестиции (₽)","В наличные на руках (₽)","Не распределено (₽)"]];
  var T = { investment: "Инвестиции", cash: "Наличные на руках", expense: "Расход" };
  logs.forEach(function (l) {
    var cashMode = l.mode === "cash_expense", mode = cashMode ? "Расход из наличных (17к)" : "Поступление бюджета";
    var un = cashMode ? "" : Math.max(0, (Number(l.income) || 0) - (Number(l.totalExpenses) || 0) - (Number(l.investedRemainder) || 0) - (Number(l.cashAdded) || 0));
    if (l.items && l.items.length) l.items.forEach(function (it, i) {
      rows.push([l.date, l.user, mode, i === 0 ? l.income : "", T[it.type] || "Расход", it.categoryName, it.amount, i === 0 ? l.investedRemainder : "", i === 0 ? (l.cashAdded || 0) : "", i === 0 ? un : ""]);
    });
    else rows.push([l.date, l.user, mode, l.income, "—", "Без статей", 0, l.investedRemainder || 0, l.cashAdded || 0, un]);
  });
  put_(ss, "Статистика Бюджета", rows);
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


// ==================== РЫНОЧНЫЕ ДАННЫЕ ====================
var MARKET_SHEET = "Рыночные данные";
var MARKET_HEADERS = ["metric_id","Показатель","Значение","Единица","Дата данных","Обновлено","Источник","Режим"];

function setupMarketData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), sh = ss.getSheetByName(MARKET_SHEET);
  if (sh && sh.getLastRow() > 0 && String(sh.getRange(1,1).getValue()) !== "metric_id") {
    throw new Error("Лист «Рыночные данные» уже существует с другой структурой. Данные не перезаписаны.");
  }
  if (!sh) sh = ss.insertSheet(MARKET_SHEET);
  if (sh.getLastRow() === 0) {
    sh.getRange(1,1,1,MARKET_HEADERS.length).setValues([MARKET_HEADERS]);
    sh.setFrozenRows(1);
  }
  refreshMarketData_();
  var exists = ScriptApp.getProjectTriggers().some(function(t) { return t.getHandlerFunction() === "refreshMarketData_"; });
  if (!exists) ScriptApp.newTrigger("refreshMarketData_").timeBased().everyDays(1).atHour(8).create();
  return { sheet: MARKET_SHEET, dailyTrigger: true };
}
function marketDefinitions_() {
  return [
    ["eur_rub","Курс евро ЦБ","₽ за 1 EUR","https://www.cbr.ru/scripts/XML_daily.asp","auto"],
    ["key_rate","Ключевая ставка ЦБ","% годовых","https://www.cbr.ru/hd_base/KeyRate/","auto"],
    ["ofz_0_25","ОФЗ 0,25 года","% годовых","https://www.cbr.ru/hd_base/zcyc_params/zcyc/","auto"],
    ["ofz_0_5","ОФЗ 0,5 года","% годовых","https://www.cbr.ru/hd_base/zcyc_params/zcyc/","auto"],
    ["ofz_0_75","ОФЗ 0,75 года","% годовых","https://www.cbr.ru/hd_base/zcyc_params/zcyc/","auto"],
    ["ofz_1","ОФЗ 1 год","% годовых","https://www.cbr.ru/hd_base/zcyc_params/zcyc/","auto"],
    ["ofz_2","ОФЗ 2 года","% годовых","https://www.cbr.ru/hd_base/zcyc_params/zcyc/","auto"],
    ["ofz_3","ОФЗ 3 года","% годовых","https://www.cbr.ru/hd_base/zcyc_params/zcyc/","auto"],
    ["ofz_5","ОФЗ 5 лет","% годовых","https://www.cbr.ru/hd_base/zcyc_params/zcyc/","auto"],
    ["ofz_7","ОФЗ 7 лет","% годовых","https://www.cbr.ru/hd_base/zcyc_params/zcyc/","auto"],
    ["ofz_10","ОФЗ 10 лет","% годовых","https://www.cbr.ru/hd_base/zcyc_params/zcyc/","auto"],
    ["ofz_15","ОФЗ 15 лет","% годовых","https://www.cbr.ru/hd_base/zcyc_params/zcyc/","auto"],
    ["ofz_20","ОФЗ 20 лет","% годовых","https://www.cbr.ru/hd_base/zcyc_params/zcyc/","auto"],
    ["ofz_30","ОФЗ 30 лет","% годовых","https://www.cbr.ru/hd_base/zcyc_params/zcyc/","auto"],
    ["inflation_yoy","Инфляция год к году","% годовых","https://rosstat.gov.ru/","manual"],
    ["liquidity_base","Средняя базовая ставка накопительных счетов","% годовых","https://finuslugi.ru/","manual"],
    ["liquidity_max","Средняя максимальная ставка с условиями","% годовых","https://finuslugi.ru/","manual"]
  ];
}
function fetchText_(url) {
  var r=UrlFetchApp.fetch(url,{muteHttpExceptions:true,followRedirects:true,headers:{"User-Agent":"Finplane/1.0"}});
  if(r.getResponseCode()<200||r.getResponseCode()>=300)throw new Error("HTTP "+r.getResponseCode()+" "+url);
  return r.getContentText("UTF-8");
}
function marketNumber_(v) {
  var n=Number(String(v||"").replace(/\s/g,"").replace(",","."));
  return isFinite(n)?n:null;
}
function cbrTableRows_(html) {
  var tables=String(html).match(/<table[\s\S]*?<\/table>/gi)||[],out=[];
  tables.forEach(function(table){
    var rows=table.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi)||[];
    rows.forEach(function(row){
      var cells=[],re=/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi,m;
      while((m=re.exec(row))!==null){
        cells.push(m[1].replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<[^>]+>/g," ")
          .replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/\s+/g," ").trim());
      }
      if(cells.length)out.push(cells);
    });
  });
  return out;
}
function refreshMarketData_() {
  var ss=SpreadsheetApp.getActiveSpreadsheet(),sh=ss.getSheetByName(MARKET_SHEET);
  if(!sh){sh=ss.insertSheet(MARKET_SHEET);sh.getRange(1,1,1,MARKET_HEADERS.length).setValues([MARKET_HEADERS]);}
  if(String(sh.getRange(1,1).getValue())!=="metric_id")throw new Error("Структура листа «Рыночные данные» не распознана; запись остановлена.");
  var old={};
  if(sh.getLastRow()>1)sh.getRange(2,1,sh.getLastRow()-1,MARKET_HEADERS.length).getValues().forEach(function(r){if(r[0])old[String(r[0])]=r;});
  var upd={},stamp=Utilities.formatDate(new Date(),Session.getScriptTimeZone(),"yyyy-MM-dd HH:mm:ss");
  try{
    var doc=XmlService.parse(fetchText_("https://www.cbr.ru/scripts/XML_daily.asp")),root=doc.getRootElement(),eur=null;
    root.getChildren("Valute").forEach(function(v){
      if(v.getChildText("CharCode")==="EUR"){
        var nominal=marketNumber_(v.getChildText("Nominal"))||1,val=marketNumber_(v.getChildText("Value"));
        if(val!==null)eur=val/nominal;
      }
    });
    if(eur!==null)upd.eur_rub={value:eur,date:root.getAttribute("Date")?root.getAttribute("Date").getValue():"",updated:stamp};
  }catch(e){console.error("EUR update: "+e);}
  try{
    var rows=cbrTableRows_(fetchText_("https://www.cbr.ru/hd_base/KeyRate/"));
    var row=rows.find(function(r){return /^\d{2}\.\d{2}\.\d{4}$/.test(r[0]||"")&&marketNumber_(r[1])!==null;});
    if(row)upd.key_rate={value:marketNumber_(row[1]),date:row[0],updated:stamp};
  }catch(e){console.error("Key rate update: "+e);}
  try{
    var rowsOfz=cbrTableRows_(fetchText_("https://www.cbr.ru/hd_base/zcyc_params/zcyc/"));
    var ofz=rowsOfz.find(function(r){return /^\d{2}\.\d{2}\.\d{4}$/.test(r[0]||"")&&r.length>=13&&r.slice(1,13).every(function(x){return marketNumber_(x)!==null;});});
    if(ofz){
      var ids=["ofz_0_25","ofz_0_5","ofz_0_75","ofz_1","ofz_2","ofz_3","ofz_5","ofz_7","ofz_10","ofz_15","ofz_20","ofz_30"];
      ids.forEach(function(id,i){upd[id]={value:marketNumber_(ofz[i+1]),date:ofz[0],updated:stamp};});
    }
  }catch(e){console.error("OFZ update: "+e);}
  var output=[MARKET_HEADERS];
  marketDefinitions_().forEach(function(d){
    var id=d[0],prev=old[id]||[],fresh=upd[id];
    output.push([id,d[1],fresh?fresh.value:(prev[2]!==undefined?prev[2]:""),d[2],
      fresh?fresh.date:(prev[4]||""),fresh?fresh.updated:(prev[5]||""),fresh?d[3]:(prev[6]||d[3]),d[4]]);
  });
  sh.getRange(1,1,output.length,MARKET_HEADERS.length).setValues(output);
  if(sh.getLastRow()>output.length)sh.getRange(output.length+1,1,sh.getLastRow()-output.length,MARKET_HEADERS.length).clearContent();
  sh.setFrozenRows(1);
  return {status:"ok",updatedAt:stamp,automaticMetrics:Object.keys(upd).length};
}
function readMarketData_() {
  var ss=SpreadsheetApp.getActiveSpreadsheet(),sh=ss.getSheetByName(MARKET_SHEET),out={};
  if(!sh||sh.getLastRow()<2||String(sh.getRange(1,1).getValue())!=="metric_id")return out;
  sh.getRange(2,1,sh.getLastRow()-1,MARKET_HEADERS.length).getValues().forEach(function(r){
    if(r[0])out[String(r[0])]={value:r[2]===""?null:Number(r[2]),unit:r[3],date:r[4],updatedAt:r[5],source:r[6],mode:r[7]};
  });
  return out;
}
