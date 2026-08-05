#!/bin/bash
set -euo pipefail

# One `task` entry point for both worlds, keyed on whether tsx is installed — NOT
# on NODE_ENV. Migrations (clickhouse:migrate / prisma:migrate) run through here
# in CI with NODE_ENV=test and no bundle built, AND in the OSS image where
# `pnpm install --prod` pruned tsx and build:server produced dist/server/task.cjs.
# Either branch is a supported way to run a task, so both must keep working:
# the app server itself always runs the bundle on plain node (see start.sh),
# but a task may run from source. An image that ships devDependencies — the
# saas one does, because pnpm's prune cannot scope to a single workspace member
# — therefore takes the tsx branch in production, by design. Do not delete the
# node branch: the OSS image has no tsx and depends on it.
if command -v tsx >/dev/null 2>&1; then
  # Regenerate the registry so a task just added to src/tasks/ runs without a
  # separate build, and so tsx has tasks.generated.ts to import (it is gitignored).
  node scripts/generate-task-registry.mjs
  exec tsx src/task.ts "$@"
else
  exec node --enable-source-maps dist/server/task.cjs "$@"
fi
