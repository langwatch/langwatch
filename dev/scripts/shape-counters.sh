#!/bin/bash
# The goal counters, measured at HEAD. Printed every tick beside the previous tick's values.
export PATH=/usr/bin:/bin:/usr/sbin:/sbin:$PATH; cd /Users/afr/Source/github.com/langwatch/langwatch
L='createTrpcService|createTrpcApiService|createServiceApp|createProjectVersionedApp|createServiceVersionedApp|createVersionedApp\b|createProjectApp|createTrpcHandlerBinding|createAppRestSecurity|mountProjectTransport|registerJsonProtocol|createTrpcProcedure\b|createTrpcRouter\b|createRestRouter\b|mountProjectRestRouter'
legacy=$(git grep -lE "$L" HEAD -- 'apps/api/src/*.ts' 'modules/*.ts' 'enterprise/*.ts' | grep -v __tests__ | wc -l | tr -d ' ')
# The shape register is empty, so it can no longer answer this: count the
# modules that still hold a transport file naming a deleted builder.
mods=$(git ls-tree -r --name-only HEAD modules enterprise/modules | grep -E "/transport/(api-rest|api-trpc)/[^/]+\.api\.ts$" | sed -E "s|^((enterprise/)?modules/[^/]+)/.*|\\1|" | sort -u | wc -l | tr -d " ")
rows=$(node -e 'console.log(String(require("./packages/architecture-enforcer/src/feature-shape-baseline.json").entries.length))')
# The doors table is deleted. A family is now a module's own REST declaration,
# and it is absent until a process mounts it.
# A family is absent while the process refuses to mount it, and the one reason
# left is a fact nothing binds: `factBindings` refuses at mount, by name.
declared=$(git ls-tree -r --name-only HEAD modules enterprise/modules | grep -cE "/transport/[^/]+\.rest\.ts$")
absent=$(git grep -l "withMiddleware(" HEAD -- 'modules/*/server/src/transport/*.rest.ts' 'enterprise/modules/*/server/src/transport/*.rest.ts' | wc -l | tr -d " ")
apiside=$(git ls-tree -r --name-only HEAD apps/api/src/features | grep -cE '\.(composition|composition\.types|mount)\.ts$')
portsfiles=$(git ls-tree -r --name-only HEAD modules enterprise/modules | grep -E "/(ports|adapters)/[^/]+\.ts$" | grep -v __tests__ | wc -l | tr -d " ")
portnames=$(LC_ALL=C git grep -hoP '\b[A-Z][A-Za-z0-9]*Ports?\b' HEAD -- 'modules/*.ts' 'enterprise/*.ts' 'packages/*.ts' 'apps/*.ts' | sort -u | wc -l | tr -d " ")
portword=$(LC_ALL=C git grep -lP '\b[A-Z][A-Za-z0-9]*Ports?\b' HEAD -- 'modules/*.ts' 'enterprise/*.ts' 'packages/*.ts' 'apps/*.ts' | wc -l | tr -d " ")
main=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo "?")
base=$(haven env 2>/dev/null | grep -oE "BASE_HOST=[^ ]+" | head -1 | cut -d= -f2- | tr -d "'\"")
boot=$( [ -n "$base" ] && curl -sk -o /dev/null -w "%{http_code}" --max-time 5 "$base/api/health" 2>/dev/null || echo "no-stack")
dirty=$(git status --porcelain --untracked-files=all | awk 'substr($0, 4) !~ /^\.rtk(\/|$)/ { count++ } END { print count+0 }')
echo "dirty=$dirty legacy_files=$legacy modules_on_legacy=$mods feature_shape_rows=$rows families_declared=$declared families_unbound=$absent api_side_files=$apiside ports_adapters_files=$portsfiles port_names=$portnames port_word_files=$portword main_unfolded=$main api_boot=$boot head=$(git log --format=%h -1)"
