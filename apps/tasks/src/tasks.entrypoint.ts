import process from "node:process";
import { createLogger } from "@langwatch/observability";
import { runTask, TaskCatalogue } from "@langwatch/task";
import { resolveTasksConfig } from "./platform/config/tasks.config";
import { loadTaskModules, parseTaskModuleSpecifiers } from "./platform/task-modules-loader";
import { TasksEventingInfrastructure } from "./platform/tasks-eventing.composition";
import { TasksHost } from "./platform/tasks-host.composition";
import { buildTasksCatalogue } from "./tasks.catalogue";

/**
 * The runnable task process — `pnpm --filter @langwatch/tasks task <name>
 * [args]`, and the same words inside the container CMD:
 * `pnpm -s task <name>`.
 *
 * Loads config, composes the real infrastructure handles this environment
 * has (a missing one is a named absence, not a silent stub), builds the
 * catalogue — the built-in tasks plus whatever `LANGWATCH_TASK_MODULES`
 * names as plugins (Part 2 of the launch-interface plan doc) — runs the
 * requested task, and exits. An unknown or failing module fails boot outright.
 */
const logger = createLogger("langwatch:tasks");

async function main(): Promise<number> {
  const config = resolveTasksConfig(process.env).value;
  const host = TasksHost.create(config);
  const eventing = TasksEventingInfrastructure.tryCreate({ redis: host.redis });
  const pluginTasks = await loadTaskModules({
    specifiers: parseTaskModuleSpecifiers(config.taskModules),
    host,
  });
  const catalogue = TaskCatalogue.create({
    tasks: [...buildTasksCatalogue({ host, eventing }), ...pluginTasks],
  });

  return runTask({
    catalogue,
    argv: process.argv.slice(2),
    close: () => Promise.all([host.close(), eventing?.close()]).then(() => undefined),
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
