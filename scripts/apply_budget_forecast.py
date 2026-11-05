import re
import runpy
import subprocess
from pathlib import Path

PINS={"index.html":"2833ea16ed33b0fc4bfdc79f12913f8a080fda86","ui/campaign-panel.html":"fda06205b9829155d3dc4be0a77d087116cbb1d9"}
def one(pattern,text,label,flags=0):
    found=list(re.finditer(pattern,text,flags))
    if len(found)!=1:raise ValueError("Expected one "+label)
    return found[0]
def apply():
    for name,sha in PINS.items():
        if subprocess.check_output(["git","hash-object",name],text=True).strip()!=sha:raise ValueError("Changed source: "+name)
    source=Path("index.html").read_text(encoding="utf-8")
    template=Path("ui/campaign-panel.html").read_text(encoding="utf-8")
    runtime=Path("ui/budget-investment-forecast.js").read_text(encoding="utf-8")
    modal=one(r"^    function recalcBudgetModal\(\)\s*\{.*?^    }",source,"budget recalculation",re.M|re.S).group()
    income=one(r"\b(?:const|let)\s+income\s*=\s*([^;]+);",modal,"income expression").group(1)
    income_id=one(r"getElementById\([\"']([^\"']+)[\"']\)",income,"income control").group(1)
    if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]*",income_id):raise ValueError("Unexpected income ID")
    one(r'\bid="'+re.escape(income_id)+r'"',source,"income input")
    runtime=runtime.replace("__INCOME_ID__",income_id)
    stress=r'<details class="fp-simulation">.*?</details>'
    for text in [source,template]:one(stress,text,"stress test block",re.S)
    source=re.sub(stress,"",source,count=1,flags=re.S)
    template=re.sub(stress,"",template,count=1,flags=re.S)
    event=one(r"^    function runFinancialEvent\(\)\s*\{.*?^    }",source,"stress test function",re.M|re.S)
    source=source[:event.start()]+source[event.end():]
    nav=one(r'<button\b(?=[^>]*\bid="tabBtn-investment")[^>]*>.*?</button>',source,"investment navigation",re.S)
    source=source[:nav.start()]+source[nav.end():]
    old='["home", "goals", "plan", "stats", "loans", "weekend", "trips", "investment", "sync"]'
    new='["home", "goals", "plan", "stats", "loans", "weekend", "trips", "sync"]'
    if source.count(old)!=1:raise ValueError("Expected one tab list")
    source=source.replace(old,new,1)
    if source.count("</body>")!=1:raise ValueError("Expected body end")
    source=source.replace("</body>",'<script id="finplane-budget-investment-forecast">\n'+runtime+'\n</script>\n</body>',1)
    source=re.sub(r"\.fp-simulation #campaignEventResult[^{}]*\{[^{}]*\}","",source)
    if "runFinancialEvent" in source or "campaignEventResult" in source:raise ValueError("Stress test references remain")
    for name in ["investmentAmount","investmentMonths","invLiquidityTotal","invOfzTotal","invCashTotal"]:one(r'\bid="'+name+r'"',source,name)
    runpy.run_path("scripts/apply_campaign_ui.py")["check_javascript"](source)
    for name,text in {"index.html":source,"ui/campaign-panel.html":template,"ui/budget-investment-forecast.js":runtime}.items():Path(name).write_text(text,encoding="utf-8")
    subprocess.run(["node","tests/budget-investment-forecast.cjs"],check=True)
    print("Stress test removed; investment forecast connected to budget remainder")
if __name__=="__main__":apply()
