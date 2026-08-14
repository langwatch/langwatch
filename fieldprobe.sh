#!/bin/bash
# Measure which structured fields production records actually carry.
#
# Levels matter: a handled CUSTOMER failure is logged at warn by design
# (specs/observability/request-log-cause-and-level.feature), so filtering to
# error|fatal hides exactly the records these fields exist on.
#
#   usage: ./fieldprobe.sh '<severity regex>' field...
LEVELS="$1"; shift
echo "severity_text=~\"(?i)($LEVELS)\"  over 24h"
for f in "$@"; do
  printf '  %-18s ' "$f"
  gcx --context lw-prod logs query \
    "topk(8, sum by ($f) (count_over_time({deployment_environment=\"prod\"} | severity_text=~\"(?i)($LEVELS)\" [24h])))" \
    --since 24h -o json 2>&1 | grep -v '"class":"hint"' | python3 -c "
import json,sys
key='$f'
try:
    d=json.load(sys.stdin)
    res=d.get('data',{}).get('result',[])
    rows=[]
    for r in res:
        m=r.get('stream') or r.get('metric') or {}
        v=max(float(x[1]) for x in r['values']) if 'values' in r else float(r['value'][1])
        rows.append((v, m.get(key) or '(absent)'))
    rows.sort(reverse=True)
    print('  '.join(f'{s}={int(v)}' for v,s in rows[:8]) if rows else 'no data')
except Exception as e:
    print('ERR', str(e)[:100])
"
done
