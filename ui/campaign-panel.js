(function(){
  'use strict';
  function renderMissions(){
    const box=document.getElementById('campaignMissionCards');
    if(!box)return;
    const goals=typeof state!=='undefined'&&Array.isArray(state.goals)?state.goals:[];
    const active=goals.filter(g=>!['Выполнено','Отменено','Отменена'].includes(g.status)).slice();
    if(typeof getGoalTargetDate==='function')active.sort((a,b)=>getGoalTargetDate(a)-getGoalTargetDate(b));
    box.replaceChildren();
    if(!active.length){const p=document.createElement('p');p.className='fp-muted';p.textContent=goals.length?'Активных миссий нет. Проверьте завершённые и отменённые цели.':'Миссий пока нет. Добавьте реальную финансовую цель в разделе целей.';box.appendChild(p);return;}
    active.slice(0,3).forEach(g=>{
      const card=document.createElement('article');card.className='fp-mission';
      const title=document.createElement('strong');title.textContent=g.title||'Цель без названия';
      const info=document.createElement('p');const amount=Number(g.amount);
      const sum=g.amount!=null&&g.amount!==''&&Number.isFinite(amount)?new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(amount)+' '+(g.currency==='EUR'?'€':g.currency==='RUB'?'₽':String(g.currency||'RUB')):'Сумма не указана';
      info.textContent='Сумма цели: '+sum+' · Срок: '+(g.day||15)+' '+(g.month||'')+' '+(g.year||'');
      const status=document.createElement('p');status.textContent='Статус: '+(g.status||'Запланировано');
      card.append(title,info,status);box.appendChild(card);
    });
  }
  function mount(){renderMissions();document.addEventListener('finplane:render',renderMissions);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();