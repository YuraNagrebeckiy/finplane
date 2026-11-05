import json
import re
import runpy
import subprocess
from pathlib import Path
PINS={"Code.gs":"e08a47586cb19a046fd99420fd7ad3c5d7f2e5ed","index.html":"57830284dbcca7d7fe24574b5a4d68845594cf55"}
def apply():
    for name,sha in PINS.items():
        if subprocess.check_output(["git","hash-object",name],text=True).strip()!=sha:raise ValueError("Changed source: "+name)
    code=Path("Code.gs").read_text(encoding="utf-8")
    marker="// ==================== РЫНОЧНЫЕ ДАННЫЕ ===================="
    if code.count(marker)!=1:raise ValueError("Expected one old market block")
    code=code.split(marker)[0]+"// Market functions are defined in MarketData.gs.\n"
    anchor="    var sh = e.range.getSheet(), name = sh.getName();"
    if code.count(anchor)!=1:raise ValueError("Expected one onEdit market hook")
    code=code.replace(anchor,anchor+'\n    if(name === MARKET_SHEET){finplaneStampMarketEdit_(e);return;}',1)
    code=code.replace(" *   Выполнять от имени: Я | У кого есть доступ: Все"," *   Доступ: не расширять без проверки аутентификации; doGet/doPost не защищены токеном.")
    index=Path("index.html").read_text(encoding="utf-8")
    bundle="\n\n".join([code]+[Path(name).read_text(encoding="utf-8") for name in ["BudgetIdentity.gs","BudgetSheet.gs","FinplaneSafety.gs","MarketData.gs"]])
    names=re.findall(r'^function\s+(\w+)\s*\(',bundle,re.M)
    if len(names)!=len(set(names)):raise ValueError("Duplicate global functions")
    found=list(re.finditer(r'(?m)^    const GAS_CODE = [^\n]*;',index))
    if len(found)!=1:raise ValueError("Expected one GAS_CODE")
    encoded=json.dumps(bundle,ensure_ascii=False).replace("<",chr(92)+"u003c")
    if json.loads(encoded)!=bundle:raise ValueError("Bundle encoding changed source")
    m=found[0];index=index[:m.start()]+"    const GAS_CODE = "+encoded+";"+index[m.end():]
    runpy.run_path("scripts/apply_campaign_ui.py")["check_javascript"](index)
    subprocess.run(["node","tests/market-data.cjs","MarketData.gs"],check=True)
    Path("Code.gs").write_text(code,encoding="utf-8")
    Path("index.html").write_text(index,encoding="utf-8")
    subprocess.run(["node","tests/finance-regression.cjs","FinplaneSafety.gs","BudgetSheet.gs","Code.gs"],check=True)
    subprocess.run(["node","BudgetIdentity.test.cjs"],check=True)
    print("Market module integrated; parser, storage and financial regressions passed")
if __name__=="__main__":apply()
