#!/bin/bash
# The goal counters, measured at HEAD. Printed every tick beside the previous tick's values.
export PATH=/usr/bin:/bin:/usr/sbin:/sbin:$PATH; cd /Users/afr/Source/github.com/langwatch/langwatch
L='createTrpcService|createTrpcApiService|createServiceApp|createProjectVersionedApp|createServiceVersionedApp|createVersionedApp\b|createProjectApp|createTrpcHandlerBinding|createAppRestSecurity|mountProjectTransport|registerJsonProtocol|createTrpcProcedure\b|createTrpcRouter\b|createRestRouter\b|mountProjectRestRouter'
legacy=$(git grep -lE "$L" HEAD -- 'apps/api/src/*.ts' 'modules/*.ts' 'packages/enterprise/*.ts' | grep -v __tests__ | wc -l | tr -d ' ')
mods=$(node -e 'const b=require("./packages/architecture-lint/src/feature-shape-baseline.json");console.log(String(b.entries.filter(e=>e.key.includes("legacy-transport")).length))')
rows=$(node -e 'console.log(String(require("./packages/architecture-lint/src/feature-shape-baseline.json").entries.length))')
absent=$(( $(git show HEAD:apps/api/src/app-rest/api-rest.doors.ts | grep -c 'family: "') - $(git show HEAD:apps/api/src/app-rest/api-rest.doors.ts | grep -c 'mount:') ))
apiside=$(git ls-tree -r --name-only HEAD apps/api/src/features | grep -cE '\.(composition|composition\.types|mount)\.ts$')
portsfiles=$(git ls-tree -r --name-only HEAD modules packages/enterprise/features | grep -E "/(ports|adapters)/[^/]+\.ts$" | grep -v __tests__ | wc -l | tr -d " ")
main=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo "?")
boot=$(ls ${TMPDIR:-/tmp}/langwatch-boot-ok 2>/dev/null >/dev/null && cat ${TMPDIR:-/tmp}/langwatch-boot-ok || echo "unknown")
dirty=$(git status --porcelain --untracked-files=all | awk 'substr($0, 4) !~ /^\.rtk(\/|$)/ { count++ } END { print count+0 }')
echo "dirty=$dirty legacy_files=$legacy modules_on_legacy=$mods feature_shape_rows=$rows families_absent=$absent api_side_files=$apiside ports_adapters_files=$portsfiles main_unfolded=$main api_boot=$boot head=$(git log --format=%h -1)"
