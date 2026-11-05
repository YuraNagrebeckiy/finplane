import json
import re
import runpy
import subprocess
from pathlib import Path

PINS={"Code.gs":"7f809e3df0d37cd0031b12fb44be4152b45bb8e9","BudgetSheet.gs":"646f4d8f984423c1d1fa30cac5ac89420c488b95","index.html":"9e6df41d32a8eaff725739b3d2279aaba46c3d62","ui/campaign-panel.js":"1cec77309e70117c216f1fe4c31d2fcd9c758dc7"}
def once(text,old,new):
    if text.count(old)!=1: raise ValueError("Expected one anchor: "+old[:70])
    return text.replace(old,new,1)
def function(text,name,body):
    matches=list(re.finditer(r"(?ms)^function "+re.escape(name)+r"\([^\n]*\).*?^}",text))
    if len(matches)!=1: raise ValueError("Expected one function: "+name)
    m=matches[0];return text[:m.start()]+body+text[m.end():]
def apply():
    for name,sha in PINS.items():
        if subprocess.check_output(["git","hash-object",name],text=True).strip()!=sha: raise ValueError("Changed source: "+name)
    code=Path("Code.gs").read_text(encoding="utf-8")
    budget=Path("BudgetSheet.gs").read_text(encoding="utf-8")
    index=Path("index.html").read_text(encoding="utf-8")
    ui=Path("ui/campaign-panel.js").read_text(encoding="utf-8")
    code=once(code,'if (!(p.goals && p.goals.length) && !(p.budgetLogs && p.budgetLogs.length))','if (!(p.goals && p.goals.length) && !(p.loans && p.loans.length) && !(p.budgetLogs && p.budgetLogs.length))')
    code=once(code,'    saveState_(ss, p);                                   // 1. полный снимок (для загрузки на другие устройства)\n','    finplaneValidateGoals_(p.goals||[]);\n    finplaneValidateBudgetLogs_(p.budgetLogs||[]);\n    finplaneCheckBudgetSheet_(ss);\n    finplaneBudgetRows_(p.budgetLogs||[]);\n    p.updatedAt=Math.max(Date.now(),currentUpdatedAt+1);\n')
    start=code.index('    writeBudget_(ss, p.budgetLogs || []);')
    end=code.index('    var cal = { error: null };',start)
    code=code[:start]+'    finplaneTransaction_(ss,p,function() {\n'+code[start:end]+'      saveState_(ss,p);\n    });\n'+code[end:]
    code=once(code,'return json_({ status: "ok", calendar: cal });','return json_({ status: "ok", updatedAt:p.updatedAt, calendar: cal });')
    code=function(code,'writeBudget_','function writeBudget_(ss, logs) {\n  return finplaneWriteBudgetSheet_(ss,logs);\n}')
    start=code.index('    } else {\n      var rows = sh.getLastRow() > 1')
    end=code.index('      p.budgetLogs = groups;',start)
    end=code.index('\n    }',end)+len('\n    }')
    code=code[:start]+"      if(p.goals.length!==Object.keys(old).length)throw new Error('Добавляйте и удаляйте цели через приложение');\n    } else {\n      p.budgetLogs=finplaneReadBudgetSheet_(sh,p.budgetLogs||[]);\n    }"+code[end:]
    code=once(code,'    p.updatedAt = Date.now();\n    saveState_(ss, p);','    p.updatedAt = Math.max(Date.now(),(Number(p.updatedAt)||0)+1);\n    finplanePersistEdit_(ss,p,name);')
    code=once(code,'function authorize() { getCalendar_(); SpreadsheetApp.getActiveSpreadsheet(); setupMarketData(); }','function authorize() { getCalendar_(); SpreadsheetApp.getActiveSpreadsheet(); setupMarketData(); finplaneSetupCalendarTrigger_(); }')
    budget=once(budget,'function finplaneBudgetRows_(logs) {','function finplaneBudgetRows_(logs) {\n  finplaneValidateBudgetLogs_(logs);')
    budget=once(budget,'function finplaneImportBudgetRows_(rows,previous) {','function finplaneImportBudgetRows_(rows,previous) {\n  finplaneValidateBudgetLogs_(previous);')
    budget=once(budget,'if (value === "" || value == null) return 0;','if (value === "" || value == null) throw new Error("Пустая сумма: укажите 0 явно");')
    budget=once(budget,'if (!isFinite(n))','if (!isFinite(n) || n < 0)')
    budget=once(budget,'[[3,"income"],[7,"investedRemainder"],[8,"cashAdded"]]','[[3,"income"]]')
    budget=once(budget,'  return ordered;','  ordered.forEach(function(log) {\n    var id=String(log.id);\n    if(log.mode==="income" && !seen[JSON.stringify([id,"income"])]) throw new Error("Пустой доход: укажите 0 явно");\n    log.investedRemainder=0;log.cashAdded=0;\n    log.items.forEach(function(item){if(item.type==="investment")log.investedRemainder+=item.amount;if(item.type==="cash")log.cashAdded+=item.amount;});\n    if(log.mode==="cash_expense" && log.cashAdded)throw new Error("Нельзя повторно переводить наличные в наличные");\n  });\n  if(ordered.length!==previous.length)throw new Error("Удаляйте операции через приложение; импорт остановлен");\n  finplaneValidateBudgetLogs_(ordered);\n  return ordered;')
    ui=once(ui,"goals.filter(g=>g.status!=='Выполнено')","goals.filter(g=>!['Выполнено','Отменено','Отменена'].includes(g.status))")
    ui=once(ui,"Number.isFinite(amount)?","g.amount!=null&&g.amount!==''&&Number.isFinite(amount)?")
    ui=once(ui,"(g.currency==='EUR'?'€':'₽')","(g.currency==='EUR'?'€':g.currency==='RUB'?'₽':String(g.currency||'RUB'))")
    ui=once(ui,"Все текущие цели выполнены. Новые цели можно добавить в разделе целей.","Активных миссий нет. Проверьте завершённые и отменённые цели.")
    lines=ui.splitlines()
    matches=[i for i,line in enumerate(lines) if line.strip().startswith('function mount(){')]
    if len(matches)!=1:raise ValueError("Expected one mount")
    lines[matches[0]]="  function mount(){renderMissions();document.addEventListener('finplane:render',renderMissions);}"
    ui="\n".join(lines)
    pattern=r'(?s)<script id="finplane-campaign-v2-script">.*?</script>'
    m=list(re.finditer(pattern,index))
    if len(m)!=1:raise ValueError("Expected one campaign script")
    index=index[:m[0].start()]+'<script id="finplane-campaign-v2-script">\n'+ui+'\n</script>'+index[m[0].end():]
    m=list(re.finditer(r'function renderAll\(\)\s*\{',index))
    if len(m)!=1:raise ValueError("Expected one renderAll")
    index=index[:m[0].end()]+"\n      queueMicrotask(() => document.dispatchEvent(new Event('finplane:render')));"+index[m[0].end():]
    index=once(index,'goals.filter(g => g.status !== "Выполнено").sort','goals.filter(g => !["Выполнено","Отменено","Отменена"].includes(g.status)).sort')
    bundle="\n\n".join([code,Path("BudgetIdentity.gs").read_text(encoding="utf-8"),budget,Path("FinplaneSafety.gs").read_text(encoding="utf-8")])
    m=list(re.finditer(r'(?m)^    const GAS_CODE = [^\n]*;',index))
    if len(m)!=1:raise ValueError("Expected one GAS_CODE")
    encoded=json.dumps(bundle,ensure_ascii=False).replace("<",chr(92)+"u003c")
    assert json.loads(encoded)==bundle
    index=index[:m[0].start()]+"    const GAS_CODE = "+encoded+";"+index[m[0].end():]
    runpy.run_path("scripts/apply_campaign_ui.py")["check_javascript"](index)
    for path,content in {"Code.gs":code,"BudgetSheet.gs":budget,"index.html":index,"ui/campaign-panel.js":ui}.items():Path(path).write_text(content,encoding="utf-8")
    subprocess.run(["node","tests/finance-regression.cjs","FinplaneSafety.gs","BudgetSheet.gs","Code.gs"],check=True)
    subprocess.run(["node","BudgetIdentity.test.cjs"],check=True)
    print("Finance fixes applied and regression tests passed")
if __name__=="__main__":apply()
