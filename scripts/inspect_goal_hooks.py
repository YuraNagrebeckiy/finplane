import json
import re
import subprocess
from pathlib import Path
EXPECTED="e5b7449b8d594c223306ae7a48db0d2336fdf52d"
def extract(source):
    result={}
    lines=source.splitlines()
    for i,line in enumerate(lines):
        m=re.match(r'^(    )(?:async\s+)?function\s+(\w+)\s*\(',line)
        arrow=re.match(r'^    const\s+(get\w+)\s*=\s*',line)
        name=m[2] if m else arrow[1] if arrow else None
        if not name or not re.search(r'goal|budget|capital|cash|sync|savestate',name,re.I):continue
        if re.search(r'default|demo|sample|seed|initial',name,re.I):continue
        if arrow:
            if not line.rstrip().endswith(';'):continue
            result[name]={'line':i+1,'source':line};continue
        end=i+1
        if not line.rstrip().endswith('}'):
            while end<len(lines) and not re.match(r'^    }\s*;?\s*$',lines[end]):end+=1
            if end>=len(lines):raise ValueError('Unterminated function: '+name)
            end+=1
        result[name]={'line':i+1,'source':'\n'.join(lines[i:end])}
    return result
if __name__=='__main__':
    if subprocess.check_output(['git','hash-object','index.html'],text=True).strip()!=EXPECTED:raise ValueError('Changed application source')
    source=Path('index.html').read_text(encoding='utf-8')
    functions=extract(source)
    if not functions:raise ValueError('No integration hooks extracted')
    out=Path('docs/goal-integration');out.mkdir(parents=True,exist_ok=True)
    metadata={}
    for name,item in functions.items():
        path=out/(name+'.txt');path.write_text(item['source']+'\n',encoding='utf-8')
        metadata[name]={'line':item['line'],'file':path.as_posix()}
    metadata['_source']={'blob':EXPECTED,'note':'Read-only source extracts, not executable application modules or live financial data'}
    (out/'index.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'hooks':len(functions),'names':sorted(functions)},ensure_ascii=False))
