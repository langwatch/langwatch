import process from "node:process";

import { createLogger } from "@langwatch/observability";
import { runTask, TaskCatalogue } from "@langwatch/task";

import { OpenapiCheckTask } from "./openapi-document/openapi-check.task.ts";
import { OpenapiGenerateTask } from "./openapi-document/openapi-generate.task.ts";

/**
 * The API process's own tiny task launcher — `pnpm --filter
 * @langwatch/platform-api task <name> [args]`.
 */

// Both live here rather than in `apps/tasks` because this is the process that
// serves the document. Neither opens a client: they read the installed module
// declarations, which is the whole input, so the launcher closes nothing.
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
