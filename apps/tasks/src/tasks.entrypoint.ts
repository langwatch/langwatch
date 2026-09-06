// Temporal, before anything reads a clock. A runtime that ships it natively keeps its own.
import "@langwatch/time/polyfill";

import process from "node:process";
import { configureLogger, createLogger, type Logger } from "@langwatch/observability";
import {
  SecretEnvironmentService,
  secretLogRedactPaths,
  secretResolutionSummary,
} from "@langwatch/secrets";
import { runTask, TaskCatalogue } from "@langwatch/task";
import { resolveTasksConfig } from "./platform/config/tasks.config.ts";
import { loadTaskModules, parseTaskModuleSpecifiers } from "./platform/task-modules-loader.ts";
import { TasksEventingInfrastructure } from "./platform/tasks-eventing.composition.ts";
import { TasksHost } from "./platform/tasks-host.composition.ts";
import { buildTasksCatalogue } from "./tasks.catalogue.ts";

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
const bootLogger = (): Logger => createLogger("langwatch:tasks");

async function main(): Promise<number> {
  // Before the Zod parse, so every task downstream still sees a plain string.
  const secrets = await SecretEnvironmentService.create({ source: process.env }).resolve();
  // Configured before the first logger is built, so a classified field that
  // reaches a record is masked by name rather than printed.
  configureLogger({ redactPaths: secretLogRedactPaths() });
  const logger = bootLogger();
  const config = resolveTasksConfig(secrets.environment).value;
  logger.info({ secrets: secretResolutionSummary(secrets) }, "resolved secrets");
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
    bootLogger().error({ error }, "tasks process failed to boot");
    process.exitCode = 1;
  });
