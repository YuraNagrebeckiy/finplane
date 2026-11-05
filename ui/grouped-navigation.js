(function(){
  'use strict';
  function mount(){
    const stats=document.getElementById('tab-stats'),loans=document.getElementById('tab-loans');
    const weekend=document.getElementById('tab-weekend'),trips=document.getElementById('tab-trips');
    if(!stats||!loans||!weekend||!trips){console.error('Grouped navigation: required sections missing');return;}
    function combine(parent,child,label){
      const heading=document.createElement('h2');heading.textContent=label;heading.className='text-lg font-extrabold text-slate-900 mt-6';
      child.prepend(heading);child.hidden=false;child.classList.remove('hidden');parent.appendChild(child);
    }
    combine(stats,loans,'Долги и счета');
    combine(weekend,trips,'Места и поездки');
    function rename(id,label,tip){const button=document.getElementById(id);if(!button)return;const text=button.lastElementChild;if(text)text.textContent=label;button.setAttribute('aria-label',label);button.setAttribute('data-tooltip',tip);}
    rename('tabBtn-stats','Бюджет, долги и счета','Статистика бюджета, долги и счета в одном разделе');
    rename('tabBtn-weekend','Выходные, места и поездки','Идеи выходных, места и история поездок');
    ['tabBtn-loans','tabBtn-trips'].forEach(id=>{const el=document.getElementById(id);if(el)el.remove();});
    const targets=new Set();
    document.querySelectorAll('h2,h3,h4').forEach(h=>{
      if(/калькулятор.*семейн.*бюро/i.test(h.textContent)){
        const card=h.closest('.card-modern,.card-light,[data-family-bureau]');
        if(card&&!card.id.startsWith('tab-'))targets.add(card);
      }
    });
    const walker=document.createTreeWalker(weekend,NodeFilter.SHOW_COMMENT);
    let node;
    while((node=walker.nextNode())){
      if(!/калькулятор.*семейн.*бюро/i.test(node.textContent))continue;
      let card=node.nextSibling;
      while(card&&card.nodeType!==1)card=card.nextSibling;
      if(card&&card.tagName==='DIV'&&!card.id.startsWith('tab-'))targets.add(card);
    }
    targets.forEach(card=>{card.hidden=true;card.style.display='none';card.setAttribute('aria-hidden','true');});
    if(!targets.size)console.warn('Family bureau calculator was not found; no unrelated calculator was hidden');
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();
