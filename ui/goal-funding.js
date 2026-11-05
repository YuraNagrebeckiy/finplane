(function(root){
  'use strict';
  const MONTHS=['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const CLOSED=new Set(['Выполнено','Куплено','Отменено','Отменена']);
  function cents(value,label){
    if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw new Error('Invalid '+label);
    const n=Math.round(value*100);if(!Number.isSafeInteger(n))throw new Error('Amount too large');return n;
  }
  function deadline(goal){
    const y=Number(goal.year),m=MONTHS.indexOf(goal.month),d=goal.day==null?15:Number(goal.day);
    if(!Number.isInteger(y)||y<1900||y>2200||m<0||!Number.isInteger(d)||d<1||d>31)return Infinity;
    const day=Math.min(d,new Date(y,m+1,0).getDate());return y*10000+(m+1)*100+day;
  }
  function allocate(goals,availableRub,eurRate){
    if(!Array.isArray(goals))throw new Error('Goals must be an array');
    const total=cents(availableRub,'goal budget'),ids=new Set();
    const open=[];
    for(const goal of goals){
      if(!goal||goal.id==null||!String(goal.id).trim())throw new Error('Missing goal ID');
      const id=String(goal.id);if(ids.has(id))throw new Error('Duplicate goal ID');ids.add(id);
      if(CLOSED.has(goal.status))continue;
      const currency=goal.currency||'RUB';
      let target=null,reason=null;
      if(currency!=='RUB'&&currency!=='EUR')reason='unsupported_currency';
      else if(currency==='EUR'&&(typeof eurRate!=='number'||!Number.isFinite(eurRate)||eurRate<=0))reason='missing_exchange_rate';
      else {cents(goal.amount,'goal amount');target=cents(goal.amount*(currency==='EUR'?eurRate:1),'converted goal amount');if(!target)reason='non_monetary';}
      open.push({goalId:id,targetCents:target,allocatedCents:0,progress:0,ready:false,reason,deadline:deadline(goal)});
    }
    open.sort((a,b)=>a.deadline-b.deadline||(a.goalId<b.goalId?-1:a.goalId>b.goalId?1:0));
    let left=total;
    for(const row of open){if(row.reason)continue;row.allocatedCents=Math.min(left,row.targetCents);left-=row.allocatedCents;row.progress=row.allocatedCents/row.targetCents;row.ready=row.allocatedCents===row.targetCents;}
    return {availableCents:total,unassignedCents:left,allocations:open};
  }
  function fundingEvents(previous,next,event,seen){
    if(!previous||!next||!event||event.type!=='deposit'||event.confirmed!==true||!event.actionId||next.availableCents<=previous.availableCents)return [];
    const old=new Map(previous.allocations.map(row=>[row.goalId,row]));
    return next.allocations.filter(row=>!row.reason&&row.allocatedCents>(old.get(row.goalId)?.allocatedCents||0)).map(row=>{
      const before=old.get(row.goalId),key=JSON.stringify([String(event.actionId),row.goalId,'funding']);
      return {key,goalId:row.goalId,fromCents:before?.allocatedCents||0,toCents:row.allocatedCents,progress:row.progress,unlocked:row.ready&&!(before&&before.ready)};
    }).filter(item=>!seen||!Object.prototype.hasOwnProperty.call(seen,item.key));
  }
  const api={allocate,fundingEvents};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FinplaneGoalFunding=api;
})(typeof globalThis!=='undefined'?globalThis:this);
