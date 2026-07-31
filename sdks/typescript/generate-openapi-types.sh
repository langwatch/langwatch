#!/usr/bin/env bash

# `pipefail` and `-u` alongside `-e`: a silently-swallowed failure here ships
# a stale API client to every SDK consumer.
set -euo pipefail

SPEC=../../platform/app/src/app/api/openapiLangWatch.json
OUT=./src/internal/generated/openapi/api-client.ts

# `prepare` runs on every install of this package, including the ones where
# regenerating is neither possible nor wanted. The app depends on the SDK with
# `workspace:*`, so an install filtered to the app (`--filter @langwatch/web...`,
# what `npx @langwatch/server` boots with) pulls this package in as a DEPENDENCY.
# A dependency's devDependencies are never installed, openapi-typescript is one
# of ours, and pnpm runs `prepare` regardless — which took the packed artifact
# down before it ever served a request.
#
# The generated client is committed and ships in the tarball, so it is already
# correct in exactly the case the generator is missing. Regenerate when the tool
# is here (development, and the publish that runs with devDependencies present);
# keep the committed file when it is not. check_generated_files in CI is what
# stops that file going stale, not this script.
if ! pnpm exec openapi-typescript --version >/dev/null 2>&1; then
  echo "openapi-typescript unavailable — keeping the committed $OUT"
  exit 0
fi

pnpm exec openapi-typescript "$SPEC" -o "$OUT"

# The spec's recursive JsonValue lands as a self-referencing indexed access,
# which TypeScript rejects (TS2502). The patch reroutes it through a type alias.
# The committed client is already patched, so the early exit above skips it.
node scripts/patch-generated-openapi.mjs
