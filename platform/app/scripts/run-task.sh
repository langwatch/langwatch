#!/bin/bash
set -euo pipefail

# One `task` entry point for both worlds, keyed on whether tsx is installed — NOT
# on NODE_ENV. Migrations (clickhouse:migrate / prisma:migrate) run through here
# in CI with NODE_ENV=test and no bundle built, AND in the prod image where
# `pnpm install --prod` pruned tsx and build:server produced dist/server/task.cjs.
# The prod image is the only place without tsx, so tsx's absence is the reliable
# signal to run the bundle; its presence (dev, CI, e2e) means run from source.
if command -v tsx >/dev/null 2>&1; then
  # Regenerate the registry so a task just added to src/tasks/ runs without a
  # separate build, and so tsx has tasks.generated.ts to import (it is gitignored).
  node scripts/generate-task-registry.mjs
  exec tsx src/task.ts "$@"
else
  exec node --enable-source-maps dist/server/task.cjs "$@"
fi
