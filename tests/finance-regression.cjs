const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const context=vm.createContext({console,Date,MONTHS:["Январь","Ноябрь"],STATE_SHEET:"_Состояние"});
vm.runInContext(fs.readFileSync(process.argv[2],'utf8'),context);
vm.runInContext(fs.readFileSync(process.argv[3],'utf8'),context);
if(process.argv[4])vm.runInContext(fs.readFileSync(process.argv[4],'utf8'),context);
const old=[{id:"a",date:"2026-11-05",user:"Юрий",mode:"income",income:1000,totalExpenses:0,investedRemainder:100,cashAdded:0,extra:"keep",items:[{id:"i",type:"investment",categoryName:"ОФЗ",amount:100,note:"keep"}]}];
const row=["2026-11-05","Юрий","Поступление бюджета",1000,"Инвестиции","ОФЗ",200,100,0,900,"a","i"];
const r=context.finplaneImportBudgetRows_([row],old)[0];
assert.equal(r.investedRemainder,200);assert.equal(r.items[0].amount,200);assert.equal(r.items[0].note,"keep");assert.equal(r.extra,"keep");assert.equal(old[0].investedRemainder,100);
const blank=row.slice();blank[3]="";assert.throws(()=>context.finplaneImportBudgetRows_([blank],old),/Пустой доход/);
const zero=row.slice();zero[3]=0;assert.equal(context.finplaneImportBudgetRows_([zero],old)[0].income,0);
for(const amount of [-1,"",null,"oops",Infinity]) {const b=row.slice();b[6]=amount;assert.throws(()=>context.finplaneImportBudgetRows_([b],old));}
assert.throws(()=>context.finplaneImportBudgetRows_([row,row],old));assert.throws(()=>context.finplaneImportBudgetRows_([],old));
class Sheet {
 constructor(name,values){this.name=name;this.values=values;}
 getName(){return this.name;}isSheetHidden(){return false;}
 getDataRange(){return {getValues:()=>structuredClone(this.values),getFormulas:()=>this.values.map(r=>r.map(()=>"")),clearContent:()=>{this.values=[[""]];}};}
 getRange(){return {getValue:()=>this.values[0][1],setValues:v=>{this.values=structuredClone(v);}};}
}
const state=new Sheet('_Состояние',[["OLD",100]]),budget=new Sheet('Статистика Бюджета',[["OLD BUDGET"]]);
const sheets=[state,budget];const ss={getSheets:()=>sheets,getSheetByName:n=>sheets.find(s=>s.name===n),deleteSheet:s=>sheets.splice(sheets.indexOf(s),1)};
assert.throws(()=>context.finplaneTransaction_(ss,{goals:[]},()=>{state.values=[["NEW"]];budget.values=[["BROKEN"]];throw new Error('simulated failure');}));
assert.deepEqual(state.values,[["OLD",100]]);assert.deepEqual(budget.values,[["OLD BUDGET"]]);
if(process.argv[4]) {
 context.LockService={getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})};
 context.SpreadsheetApp={getActiveSpreadsheet:()=>ss};context.Utilities={getUuid:()=>"test"};
 context.json_=x=>x;context.finplanePrepareBudgetIds=x=>x;context.finplaneCheckBudgetSheet_=()=>{};
 context.finplaneBudgetRows_=()=>[];context.writeBudget_=()=>{};context.writeGoals_=()=>{};context.writePlan_=()=>{};context.put_=()=>{};context.syncCalendar_=()=>({});
 context.saveState_=(s,p)=>{state.values=[[JSON.stringify(p),p.updatedAt]];};
 const loan={goals:[],loans:[{id:"loan",initial:100}],budgetLogs:[],updatedAt:1000};
 const success=context.doPost({postData:{contents:JSON.stringify(loan)}});assert.equal(success.status,"ok");
 const baseline=structuredClone(state.values);
 context.writeBudget_=()=>{budget.values=[["BROKEN"]];throw new Error("simulated write failure");};
 const failed=context.doPost({postData:{contents:JSON.stringify({...loan,updatedAt:success.updatedAt+1})}});
 assert.equal(failed.status,"error");assert.deepEqual(state.values,baseline);assert.deepEqual(budget.values,[["OLD BUDGET"]]);
}
console.log('Finance regression tests passed');
