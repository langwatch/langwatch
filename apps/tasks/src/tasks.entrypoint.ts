import process from "node:process";
import { createLogger } from "@langwatch/observability";
import { runTask, TaskCatalogue } from "@langwatch/task";
import { resolveTasksConfig } from "./platform/config/tasks.config";
import { TasksHost } from "./platform/tasks-host.composition";
import { buildTasksCatalogue } from "./tasks.catalogue";

/**
 * The runnable task process — `pnpm --filter @langwatch/tasks task <name>
 * [args]`, and the same words inside the container CMD:
 * `pnpm -s task <name>`.
 *
 * Loads config, composes the real infrastructure handles this environment
 * has (a missing one is a named absence, not a silent stub), builds the
 * catalogue, runs the requested task, and exits with the launcher's code.
 */
const logger = createLogger("langwatch:tasks");

async function main(): Promise<number> {
  const config = resolveTasksConfig(process.env).value;
  const host = TasksHost.create(config);
  const catalogue = TaskCatalogue.create({ tasks: buildTasksCatalogue({ host }) });

  return runTask({
    catalogue,
    argv: process.argv.slice(2),
    close: () => host.close(),
    logger,
  });
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    logger.error({ error }, "tasks process failed to boot");
    process.exitCode = 1;
  });
