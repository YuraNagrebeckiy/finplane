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
  var old = Object.create(null), groups = Object.create(null), ordered = [], seen = Object.create(null);
  previous.forEach(function(log) {
    var id = String(log.id);
    if (old[id]) throw new Error("Повторный ID в исходном состоянии");
    old[id] = log;
  });
  function number(value) {
    if (value === "" || value == null) return 0;
    var n = Number(value);
    if (!isFinite(n)) throw new Error("Некорректная сумма");
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
    [[3,"income"],[7,"investedRemainder"],[8,"cashAdded"]].forEach(function(pair) {
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
