#!/bin/sh
# The old `pnpm run task <name>`: maps the pre-architecture camelCase task names
# and flags onto the tasks app. Already-new names pass through unchanged.
echo 'langwatch: "/app/platform/app pnpm run task <name>" is deprecated; use cd /app/apps/tasks && pnpm --silent task <name>' >&2

old="${1:-}"
[ -n "$old" ] && shift
case "$old" in
  renderLwqlAccessConfig)
    if [ "${1:-}" = "--out" ] && [ -n "${2:-}" ]; then
      LWQL_RENDER_OUT_DIR="$2"
      export LWQL_RENDER_OUT_DIR
      shift 2
    fi
    new=lwql-render-access-config ;;
  provisionLwql) new=lwql-provision ;;
  clickhouseMigrate) new=upgrade ;;
  system-migrations) new=system-migrations-pass ;;
  backfillAnnotationsToClickhouse | backfillDatasetContentToS3 | backfillStalledSimulationRuns | \
    cleanupOldLambdas | clearStalePendingSsoSetup | generateOpenAPISpec | \
    generateWebhookSignatureVectors | groupQueueMigrationAudit | migrateCustomModels | \
    migrateModelProviderKeys | migrateObjectStorage | migrateSlackConnections | \
    objectStorageMigration | runTopicClustering | sendSlackAlert)
    echo "langwatch: the task \"$old\" has no equivalent in this image; see cd /app/apps/tasks && pnpm --silent task" >&2
    exit 1 ;;
  *) new="$old" ;;
esac

cd "${LANGWATCH_TASKS_DIR:-/app/apps/tasks}" && exec pnpm --silent task $new "$@"
