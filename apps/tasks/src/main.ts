import "@langwatch/time/polyfill";
import process from "node:process";

import { langWatchQlSupply } from "@langwatch/analytics-process";
import { createDataPrivacyDirectoryReader } from "@langwatch/data-privacy-process";
import { serverModules as processModules } from "@langwatch/installed-server-modules";
import { bootNodeExecutable, configureLogger, createLogger } from "@langwatch/observability";
import { processConfig, Server } from "@langwatch/process-server";
import { RedisConnectionService, RedisShutdownService } from "@langwatch/redis-client";
import { secretLogRedactPaths, SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { Task, TaskCatalogue } from "@langwatch/task";

import { clearStalePendingSsoSetup } from "./clear-stale-pending-sso-setup.ts";
import { clickhouseMigrate } from "./clickhouse-migrate.ts";
import {
  resolveTasksConfig,
  resolveTasksEnvironment,
  tasksSecrets,
  type TaskConnections,
  type TaskInput,
  type TasksConfig,
} from "./config.ts";
import { openTasksDatabase } from "./database.ts";
import { lwqlProvision } from "./lwql-provision.ts";
import { lwqlRenderAccessConfig } from "./lwql-render-access-config.ts";
import { prismaMigrate } from "./prisma-migrate.ts";
import { systemMigrationsPass } from "./system-migrations-pass.ts";

const tasks = new Map<string, (input: TaskInput) => Promise<void>>([
  ["prisma-migrate", prismaMigrate],
  ["clickhouse-migrate", clickhouseMigrate],
  ["lwql-provision", lwqlProvision],
  ["lwql-render-access-config", lwqlRenderAccessConfig],
  ["system-migrations-pass", systemMigrationsPass],
  ["clear-stale-pending-sso-setup", clearStalePendingSsoSetup],
]);

/** Tasks that never touch the migration database, so never wait on its advisory lock. */
const LOCK_FREE_TASKS = new Set(["system-migrations-pass", "lwql-render-access-config"]);

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

  const database = input.connections.database;
  if (database && argv.some((name) => !LOCK_FREE_TASKS.has(name))) {
    await database.hold(run);
  } else {
    await run();
  }
}

const isTask = (contribution: unknown): contribution is Task => contribution instanceof Task;

/** Boots the installed modules in the tasks role and runs the named tasks they declared. */
export async function runModuleTasks(names: readonly string[], signal: AbortSignal): Promise<void> {
  const server = await Server.create("langwatch-tasks")
    .withConfig(processConfig(processModules))
    .withSecrets((config, secrets) =>
      secrets.withEnv().withFile().withOnePassword(config.process.onePasswordAccount),
    )
    .withProcessOwnership(false)
    .start();
  try {
    const app = await server
      .composeProcess("tasks")
      .withModules(processModules)
      .withMember("dataPrivacy", (members) => ({
        directory: createDataPrivacyDirectoryReader(members.read("prisma")),
      }))
      .withMember("langwatchQl", (members) =>
        langWatchQlSupply({
          admin: members.read("clickhouseAdmin"),
          postgres: members.read("databaseTarget"),
          database: () => members.read("prisma"),
        }),
      )
      .withMember("elevenLabsWebhook", () => void 0)
      .withMember("queue", () => void 0)
      .withMember("content", () => void 0)
      .withMember("gatewayInternalProtocol", () => ({}))
      .withMember("connectJudge", () => null)
      .withMember("monitor", () => void 0)
      .withPipelines((pipelines) => pipelines.produce())
      .boot();
    await server.run(app);
    const catalogue = TaskCatalogue.create({ tasks: app.tasks(isTask) });
    const logger = createLogger("langwatch:tasks");
    for (const name of names) {
      signal.throwIfAborted();
      logger.info({ task: name }, "task starting");
      await catalogue.get({ name }).run({ args: [], signal });
      logger.info({ task: name }, "task finished");
    }
  } finally {
    await server.close();
  }
}

/**
 * The runner's one secrets seam: each connection string lives only inside the
 * closure `into` hands it to, and what escapes is the connector built there.
 */
async function openConnections(config: TasksConfig): Promise<TaskConnections> {
  const chain = SecretsChain.start({ environment: process.env }).withEnv().withFile();
  const resolver = SecretsResolver.over(chain);
  const declared = Object.values(tasksSecrets);
  await resolver.preflight(declared);
  const secrets = resolver.scopeTo("tasks", declared);

  // Each URL is spent where it is read: the connection is what comes back.
  const database = await secrets.into(tasksSecrets.databaseUrl, (url) =>
    url === undefined ? null : openTasksDatabase(url, config),
  );
  const redis = await secrets.into(tasksSecrets.redisUrl, (url) =>
    url === undefined ? null : new RedisConnectionService().connect({ url }),
  );

  resolver.seal();

  return { database, redis };
}

async function main(): Promise<void> {
  configureLogger({ redactPaths: secretLogRedactPaths(Object.values(tasksSecrets)) });
  const argv = process.argv.slice(2);
  const moduleTasks = argv.filter((name) => !tasks.has(name));
  if (moduleTasks.length > 0 && moduleTasks.length < argv.length) {
    throw new Error(
      `Run ${[...tasks.keys()].join(", ")} apart from module tasks (${moduleTasks.join(", ")}).`,
    );
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  if (moduleTasks.length > 0) {
    try {
      await runModuleTasks(moduleTasks, controller.signal);
    } finally {
      process.off("SIGINT", abort);
      process.off("SIGTERM", abort);
    }
    return;
  }
  const source = { ...process.env };
  const environment = resolveTasksEnvironment(source);
  const config = resolveTasksConfig(source);
  const connections = await openConnections(config);
  try {
    await runTasks(argv, {
      config,
      connections,
      environment,
      signal: controller.signal,
    });
  } finally {
    // Whoever opened a connection closes it; a task only uses one.
    if (connections.redis) await RedisShutdownService.create().shutdown(connections.redis);
    await connections.database?.close();
    process.off("SIGINT", abort);
    process.off("SIGTERM", abort);
  }
}

if (import.meta.main) await bootNodeExecutable("langwatch-tasks", main);
