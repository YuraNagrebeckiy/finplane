import re
import subprocess
import sys
import tempfile
from pathlib import Path

EXPECTED_BLOB = "72d879e411ba9ee91545e3c18fdb099b7fbd9b95"
ROOT = Path(__file__).resolve().parents[1]
HUD = (ROOT / "ui/campaign-panel.html").read_text(encoding="utf-8")
STYLE = '<style id="finplane-campaign-v2-style">\n' + (ROOT / "ui/campaign-panel.css").read_text(encoding="utf-8") + '\n</style>'
SCRIPT = '<script id="finplane-campaign-v2-script">\n' + (ROOT / "ui/campaign-panel.js").read_text(encoding="utf-8") + '\n</script>'

def patch_html(source):
    if 'id="finplane-campaign-v2-style"' in source:
        raise ValueError("Campaign UI already patched; refusing a second application")
    pattern = r'<section\b[^>]*\bid="familyCampaignHud"[^>]*>[\s\S]*?</section>'
    matches = list(re.finditer(pattern, source))
    if len(matches) != 1:
        raise ValueError("Expected exactly one campaign HUD")
    match = matches[0]
    for name in ["campaignLevel", "campaignXp", "campaignNextLevel", "campaignMissions", "campaignDebt", "campaignProgress", "campaignEventResult"]:
        if source.count('id="' + name + '"') != 1:
            raise ValueError("Missing or duplicate existing ID: " + name)
        if HUD.count('id="' + name + '"') != 1:
            raise ValueError("Replacement loses ID: " + name)
    if source.count("</head>") != 1 or source.count("</body>") != 1:
        raise ValueError("Unexpected document structure")
    updated = source[:match.start()] + HUD + source[match.end():]
    updated = updated.replace("</head>", STYLE + "\n</head>", 1)
    updated = updated.replace("</body>", SCRIPT + "\n</body>", 1)
    return updated

def check_javascript(source):
    blocks = re.findall(r'<script\b([^>]*)>([\s\S]*?)</script>', source, flags=re.I)
    checked = 0
    with tempfile.TemporaryDirectory() as directory:
        for attrs, code in blocks:
            if re.search(r'\bsrc\s*=', attrs, re.I):
                continue
            kind = re.search(r'type=[\"\']([^\"\']+)', attrs, re.I)
            if kind and kind[1] not in ("module", "text/javascript", "application/javascript"):
                continue
            target = Path(directory) / (str(checked) + (".mjs" if kind and kind[1] == "module" else ".js"))
            target.write_text(code, encoding="utf-8")
            subprocess.run(["node", "--check", str(target)], check=True)
            checked += 1
    if not checked:
        raise ValueError("No inline JavaScript checked")
    return checked

def self_test():
    ids = ["campaignLevel", "campaignXp", "campaignNextLevel", "campaignMissions", "campaignDebt", "campaignProgress", "campaignEventResult"]
    old = '<section id="familyCampaignHud">' + ''.join('<span id="'+i+'"></span>' for i in ids) + '</section>'
    fixture = '<html><head></head><body>BEFORE' + old + 'AFTER<script>const untouched = 42;</script></body></html>'
    updated = patch_html(fixture)
    assert 'BEFORE' + HUD + 'AFTER' in updated
    assert '<script>const untouched = 42;</script>' in updated
    assert updated.count('id="familyCampaignHud"') == 1
    assert check_javascript(updated) == 2
    for invalid in [updated, fixture.replace('id="campaignXp"', 'id="missing"'), fixture.replace(old, old+old)]:
        try:
            patch_html(invalid)
        except ValueError:
            pass
        else:
            raise AssertionError("Invalid input accepted")
    print("Campaign patch self-tests passed")

if __name__ == "__main__":
    if "--self-test" in sys.argv:
        self_test()
    else:
        target = Path("index.html")
        actual = subprocess.check_output(["git", "hash-object", str(target)], text=True).strip()
        if actual != EXPECTED_BLOB:
            raise SystemExit("index.html changed since review; no files modified")
        original = target.read_bytes().decode("utf-8")
        updated = patch_html(original)
        count = check_javascript(updated)
        target.write_bytes(updated.encode("utf-8"))
        print("Campaign interface updated; inline scripts syntax-checked:", count)
