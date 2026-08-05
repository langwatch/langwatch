#!/bin/bash
set -euo pipefail

# One `task` entry point for both worlds, keyed on whether tsx is installed — NOT
# on NODE_ENV. Migrations (clickhouse:migrate / prisma:migrate) run through here
# in CI with NODE_ENV=test and no bundle built, and in the production images,
# which prune devDependencies away and run build:server's dist/server/task.cjs.
# Either branch is a supported way to run a task, so both must keep working:
# tsx from source where it is installed (dev, CI, e2e), the bundle where it is
# not. Do not delete the node branch — production has no tsx and depends on it.
if command -v tsx >/dev/null 2>&1; then
  # Regenerate the registry so a task just added to src/tasks/ runs without a
  # separate build, and so tsx has tasks.generated.ts to import (it is gitignored).
  node scripts/generate-task-registry.mjs
  exec tsx src/task.ts "$@"
else
  exec node --enable-source-maps dist/server/task.cjs "$@"
fi
