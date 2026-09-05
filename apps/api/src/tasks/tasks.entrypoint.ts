import process from "node:process";
import { createLogger } from "@langwatch/observability";
import { runTask, TaskCatalogue } from "@langwatch/task";
import { OpenapiCheckTask } from "./openapi-document/openapi-check.task";
import { OpenapiGenerateTask } from "./openapi-document/openapi-generate.task";
import { OpenapiRouteCoverageTask } from "./openapi-route-coverage/openapi-route-coverage.task";

/**
 * The API process's own tiny task launcher — `pnpm --filter
 * @langwatch/platform-api task <name> [args]`.
 */

// These three live here rather than in `apps/tasks` because they walk this
// process's own registered REST routes (`apps/api/src/app-rest`), so they need
// its full REST boot graph, not `apps/tasks`' infrastructure handles. Every
// other task moved to the feature package that owns it, or to `apps/tasks`.
const logger = createLogger("langwatch:api:tasks");

const catalogue = TaskCatalogue.create({
  tasks: [
    OpenapiGenerateTask.create(),
    OpenapiCheckTask.create(),
    OpenapiRouteCoverageTask.create(),
  ],
});

void runTask({
  catalogue,
  argv: process.argv.slice(2),
  close: () => Promise.resolve(),
  logger,
}).then((code) => {
  process.exitCode = code;
});
