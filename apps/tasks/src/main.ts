import "@langwatch/time/polyfill";
import process from "node:process";

import { bootNodeExecutable, configureLogger, createLogger } from "@langwatch/observability";
import { RedisConnectionService, RedisShutdownService } from "@langwatch/redis-client";
import { secretLogRedactPaths, SecretsChain, SecretsResolver } from "@langwatch/secrets";

import {
  processEnvironment,
  resolveTasksConfig,
  resolveTasksEnvironment,
  tasksSecrets,
  type TaskConnections,
  type TaskInput,
  type TasksConfig,
} from "./config.ts";
import { openTasksDatabase } from "./database.ts";

type TaskRun = (input: TaskInput) => Promise<void>;

// Each task loads its own graph when it runs, so a seed never pays for the migration pass.
const tasks = new Map<string, () => Promise<TaskRun>>([
  ["prisma-migrate", async () => (await import("./prisma-migrate.ts")).prismaMigrate],
  ["clickhouse-migrate", async () => (await import("./clickhouse-migrate.ts")).clickhouseMigrate],
  ["lwql-provision", async () => (await import("./lwql-provision.ts")).lwqlProvision],
  [
    "lwql-render-access-config",
    async () => (await import("./lwql-render-access-config.ts")).lwqlRenderAccessConfig,
  ],
  [
    "system-migrations-pass",
    async () => (await import("./system-migrations-pass.ts")).systemMigrationsPass,
  ],
  ["storage-seed", async () => (await import("./storage-seed/storage-seed.ts")).storageSeed],
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
      const load = tasks.get(name);
      if (!load) throw new Error(`Unknown task: ${name}`);
      const task = await load();
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

/**
 * The runner's one secrets seam: each connection string lives only inside the
 * closure `into` hands it to, and what escapes is the connector built there.
 */
async function openConnections({
  config,
  chain,
}: {
  config: TasksConfig;
  chain: SecretsChain;
}): Promise<TaskConnections> {
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
  const [first, ...rest] = argv;
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  if (first !== undefined && !tasks.has(first)) {
    try {
      // Only module tasks load every module; the migrations stay a small graph.
      const { runModuleTask } = await import("./module-task.ts");
      await runModuleTask({
        name: first,
        args: rest,
        signal: controller.signal,
        plugins: {
          taskModules: resolveTasksConfig({ ...processEnvironment }).taskModules,
          importModule: (specifier) => import(specifier),
        },
      });
    } finally {
      process.off("SIGINT", abort);
      process.off("SIGTERM", abort);
    }
    return;
  }
  const source = { ...processEnvironment };
  const environment = resolveTasksEnvironment(source);
  const config = resolveTasksConfig(source);
  const chain = SecretsChain.start({ environment: processEnvironment })
    .withEnv()
    .withFile()
    .withOnePassword(config.onePasswordAccount);
  const connections = await openConnections({ config, chain });
  try {
    await runTasks(argv, {
      config,
      connections,
      chain,
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
