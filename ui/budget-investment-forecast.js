(function(){
  'use strict';
  function available(source,items){
    const amount=Number(source);
    if(!Number.isFinite(amount)||amount<0||!Array.isArray(items))return {amount:0,invalid:true,overallocated:false};
    let used=0;
    for(const item of items){
      const value=item&&item.amount;
      if(value==null||value==='')return {amount:0,invalid:true,overallocated:false};
      const n=Number(value);
      if(!Number.isFinite(n)||n<0)return {amount:0,invalid:true,overallocated:false};
      used+=n;
    }
    if(!Number.isFinite(used))return {amount:0,invalid:true,overallocated:false};
    return {amount:Math.max(0,Math.round((amount-used)*100)/100),invalid:false,overallocated:used>amount+0.005};
  }
  if(typeof module!=='undefined'&&module.exports)module.exports=available;
  if(typeof document==='undefined')return;
  function mount(){
    const type=document.getElementById('itemTypeSelect');
    const panel=document.getElementById('tab-investment');
    const input=document.getElementById('investmentAmount');
    const income=document.getElementById('__INCOME_ID__');
    const row=type&&type.closest('.grid');
    if(!type||!panel||!input||!income||!row){console.error('Budget investment forecast: required controls missing');return;}
    panel.id='budgetInvestmentForecast';
    panel.className='hidden space-y-4 mt-4';
    row.insertAdjacentElement('afterend',panel);
    input.readOnly=true;
    input.setAttribute('aria-readonly','true');
    input.setAttribute('aria-describedby','budgetInvestmentForecastNote');
    input.value='0';
    const label=input.closest('label');
    if(label&&label.firstChild&&label.firstChild.nodeType===3)label.firstChild.textContent='Остаток для инвестиций, ₽ ';
    const note=document.createElement('p');
    note.id='budgetInvestmentForecastNote';
    note.className='text-xs text-slate-600 rounded-xl bg-emerald-50 border border-emerald-200 p-3';
    note.setAttribute('aria-live','polite');
    panel.prepend(note);
    panel.querySelectorAll('h2').forEach(h=>{if(h.textContent.includes('Симулятор инвестиций'))h.textContent='Прогноз доходности остатка';});
    function sync(){
      const selected=type.value==='investment';
      panel.hidden=!selected;
      panel.classList.toggle('hidden',!selected);
      if(!selected)return;
      const cash=typeof currentBudgetModalMode!=='undefined'&&currentBudgetModalMode==='cash_expense';
      const source=cash&&typeof getCashWalletInfo==='function'?getCashWalletInfo().remainingCash:Number(income.value);
      const items=typeof modalTempItems!=='undefined'?modalTempItems:[];
      const result=available(source,items);
      input.value=String(result.amount);
      note.textContent=result.invalid?'Проверьте сумму поступления и статьи: прогноз временно обнулён.':result.overallocated?'Статьи превышают доступную сумму. Свободного остатка для инвестиций нет.':'Расчёт на текущий остаток после всех добавленных статей. Сумма обновляется автоматически; прогноз не создаёт перевод и не является обещанием доходности.';
      if(typeof renderInvestmentSimulator==='function')renderInvestmentSimulator();
    }
    let queued=false;
    function schedule(){if(queued)return;queued=true;queueMicrotask(()=>{queued=false;sync();});}
    document.addEventListener('input',schedule);
    document.addEventListener('change',schedule);
    document.addEventListener('click',schedule);
    document.addEventListener('finplane:render',schedule);
    sync();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();
