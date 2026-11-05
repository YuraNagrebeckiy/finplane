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
