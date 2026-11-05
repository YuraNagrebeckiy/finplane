import re
import runpy
import subprocess
from pathlib import Path
EXPECTED="6793ecfc0535f4e4b8eacd32cf6f839e7e067da3"
def apply():
    if subprocess.check_output(["git","hash-object","index.html"],text=True).strip()!=EXPECTED:raise ValueError("index.html changed since review")
    source=Path("index.html").read_text(encoding="utf-8")
    runtime=Path("ui/grouped-navigation.js").read_text(encoding="utf-8")
    for name in ["tab-stats","tab-loans","tab-weekend","tab-trips","tabBtn-stats","tabBtn-weekend"]:
        if len(re.findall(r'\bid="'+re.escape(name)+r'"',source))!=1:raise ValueError("Missing or duplicate "+name)
    marker='function switchTab(tabId) {'
    if source.count(marker)!=1:raise ValueError("Expected one switchTab")
    source=source.replace(marker,marker+'\n      if(tabId === "loans") tabId = "stats";\n      if(tabId === "trips") tabId = "weekend";',1)
    old='["home", "goals", "plan", "stats", "loans", "weekend", "trips", "sync"]'
    new='["home", "goals", "plan", "stats", "weekend", "sync"]'
    if source.count(old)!=1:raise ValueError("Expected one navigation list")
    source=source.replace(old,new,1)
    if source.count("</body>")!=1:raise ValueError("Expected body end")
    source=source.replace("</body>",'<script id="finplane-grouped-navigation">\n'+runtime+'\n</script>\n</body>',1)
    runpy.run_path("scripts/apply_campaign_ui.py")["check_javascript"](source)
    Path("index.html").write_text(source,encoding="utf-8")
    print("Budget/debts and weekend/trips grouped without copying financial state")
    print("Family-bureau label present in source:",bool(re.search(r'калькулятор[^<\n]*семейн[^<\n]*бюро',source,re.I)))
if __name__=="__main__":apply()
