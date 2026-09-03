import process from "node:process";
import { createLogger } from "@langwatch/observability";
import { runTask, TaskCatalogue } from "@langwatch/task";
import { OpenapiCheckTask } from "./openapi-document/openapi-check.task";
import { OpenapiGenerateTask } from "./openapi-document/openapi-generate.task";

/**
 * The API process's own tiny task launcher — `pnpm --filter
 * @langwatch/platform-api task openapi-generate [path]` and `... task
 * openapi-check [scratch] [frozen]`.
 *
 * Only these two tasks live here rather than in `apps/tasks`: they walk this
 * process's own registered REST routes
 * (`apps/api/src/app-rest/app-rest.packaged-families.ts`), so they need this
 * process's full boot graph, not `apps/tasks`' infrastructure handles. Every
 * other task moved out from under `apps/api/src/tasks` to the feature package
 * that owns it, or to `apps/tasks`.
 */
const logger = createLogger("langwatch:api:tasks");

const catalogue = TaskCatalogue.create({
  tasks: [OpenapiGenerateTask.create(), OpenapiCheckTask.create()],
});

void runTask({
  catalogue,
  argv: process.argv.slice(2),
  close: () => Promise.resolve(),
  logger,
}).then((code) => {
  process.exitCode = code;
});
