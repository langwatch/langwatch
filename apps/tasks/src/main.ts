import "@langwatch/time/polyfill";
import process from "node:process";

import { bootNodeExecutable, configureLogger, createLogger } from "@langwatch/observability";
import { SecretEnvironmentService, secretLogRedactPaths } from "@langwatch/secrets";

import { clickhouseMigrate } from "./clickhouse-migrate.ts";
import { resolveTasksConfig, resolveTasksEnvironment, type TaskInput } from "./config.ts";
import { lwqlProvision } from "./lwql-provision.ts";
import { withMigrationLock } from "./migration-lock.ts";
import { prismaMigrate } from "./prisma-migrate.ts";
import { systemMigrationsPass } from "./system-migrations-pass.ts";

const tasks = new Map<string, (input: TaskInput) => Promise<void>>([
  ["prisma-migrate", prismaMigrate],
  ["clickhouse-migrate", clickhouseMigrate],
  ["lwql-provision", lwqlProvision],
  ["system-migrations-pass", systemMigrationsPass],
]);

export async function runTasks(argv: readonly string[], input: TaskInput): Promise<void> {
  if (argv.length === 0 || argv.some((name) => !tasks.has(name))) {
    throw new Error(`Pass task names in order. Available tasks: ${[...tasks.keys()].join(", ")}`);
  }

  const run = async () => {
    const logger = createLogger("langwatch:tasks");
    for (const name of argv) {
      input.signal.throwIfAborted();
      const task = tasks.get(name);
      if (!task) throw new Error(`Unknown task: ${name}`);
      logger.info({ task: name }, "task starting");
      await task(input);
      input.signal.throwIfAborted();
      logger.info({ task: name }, "task finished");
    }
  };

  if (argv.some((name) => name !== "system-migrations-pass")) {
    await withMigrationLock(input.config.databaseUrl, run);
  } else {
    await run();
  }
}

async function main(): Promise<void> {
  configureLogger({ redactPaths: secretLogRedactPaths() });
  const secrets = await SecretEnvironmentService.create({ source: process.env }).resolve();
  const config = resolveTasksConfig(secrets.environment);
  const environment = resolveTasksEnvironment(secrets.environment);
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  try {
    await runTasks(process.argv.slice(2), { config, environment, signal: controller.signal });
  } finally {
    process.off("SIGINT", abort);
    process.off("SIGTERM", abort);
  }
}

if (import.meta.main) await bootNodeExecutable("langwatch-tasks", main);
