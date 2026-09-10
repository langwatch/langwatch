import process from "node:process";
import { configureLogger, createLogger, type Logger } from "@langwatch/observability";
import {
  SecretEnvironmentService,
  secretLogRedactPaths,
  secretResolutionSummary,
} from "@langwatch/secrets";
import { runTask, TaskCatalogue } from "@langwatch/task";
import { resolveTasksConfig } from "./platform/config/tasks.config.ts";
import { PostgresMigrationLockAdapter } from "./platform/infrastructure/postgres-migration-lock.adapter.ts";
import { type MigrationLockPort, UnlockedMigrationLock } from "./platform/migration-lock.port.ts";
import { isMigrationTask, MigrationLockService } from "./platform/migration-lock.service.ts";
import { parseTaskInvocation } from "./platform/task-invocation.ts";
import { runTasksInOrder } from "./platform/task-sequence.ts";
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
 * requested tasks, and exits. An unknown or failing module fails boot outright.
 *
 * Several names in one invocation run in one process, in the order given,
 * stopping at the first failure: `pnpm -s task prisma-migrate
 * clickhouse-migrate lwql-provision` is the whole preparation step, and it
 * resolves secrets and parses config once. A run that includes a schema
 * migration takes the migration lock first, so a second runner waits rather
 * than rebuilding the schema underneath this one.
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

  const close = (): Promise<void> =>
    Promise.all([host.close(), eventing?.close()]).then(() => undefined);
  const noClose = (): Promise<void> => Promise.resolve();

  try {
    const invocation = parseTaskInvocation({
      argv: process.argv.slice(2),
      isTaskName: (name) => catalogue.names().includes(name),
    });
    const run = async (): Promise<number> => {
      // Nothing was named at all: one call, so the launcher reports it with
      // the catalogue's own names rather than exiting silently on an empty loop.
      if (invocation.names.length === 0) {
        return runTask({ catalogue, argv: [], close: noClose, logger });
      }
      return runTasksInOrder({
        names: invocation.names,
        args: invocation.args,
        runOne: ({ name, args }) =>
          runTask({ catalogue, argv: [name, ...args], close: noClose, logger }),
      });
    };

    if (!invocation.names.some(isMigrationTask)) return await run();

    const lock = MigrationLockService.create({
      lock: migrationLock(config.databaseUrl),
      logger,
    });
    return await lock.run(run);
  } finally {
    await close();
  }
}

/** Nothing to contend for without a database: the tasks refuse by name instead. */
function migrationLock(databaseUrl: string | undefined): MigrationLockPort {
  return databaseUrl
    ? PostgresMigrationLockAdapter.create({ databaseUrl })
    : new UnlockedMigrationLock();
}

/** Runs the task process and sets the exit code; never re-throws. */
export async function bootTasks(): Promise<void> {
  try {
    process.exitCode = await main();
  } catch (error) {
    bootLogger().error({ error }, "tasks process failed to boot");
    process.exitCode = 1;
  }
}
