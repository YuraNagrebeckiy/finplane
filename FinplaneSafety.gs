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
  var names=[STATE_SHEET,"Статистика Бюджета","Цели","План-Прогноз","Сводка (приложение)","Где были"];
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
