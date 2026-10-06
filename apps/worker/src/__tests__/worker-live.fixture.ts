/**
 * The worker booted and run as `main.ts` runs it, wholly live over the local Postgres, Redis and
 * a migrated ClickHouse (ARCHITECTURE.md §7: one store tier per process). Every secret is a
 * synthetic test value: nothing here is read from `.env`.
 */
import { startTestClickHouseEndpoints } from "@langwatch/clickhouse-client/testing";
import { ClickHouseMigrateTask } from "@langwatch/clickhouse-migrations";
import { processConfig, Server } from "@langwatch/process";

import { processModules } from "../process-modules.generated.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const redisUrl = process.env.LANGWATCH_TEST_REDIS_URL;
const clickHouseUrl = process.env.LANGWATCH_TEST_CLICKHOUSE_URL;

/** Whether the local Postgres, Redis and ClickHouse a live boot needs are named. */
export const liveStoresConfigured = Boolean(databaseUrl && redisUrl && clickHouseUrl);

const SYNTHETIC_ENVIRONMENT: Readonly<Record<string, string>> = {
  NODE_ENV: "test",
  // No quick tunnel from a test process: it would open a real one where cloudflared is on PATH.
  VOICE_TUNNEL: "false",
  VOICE_WS_PORT: "0",
  WORKER_METRICS_PORT: "0",
  BASE_HOST: "http://langwatch.test",
  API_KEY_PEPPER: "synthetic-api-key-pepper",
  CREDENTIALS_SECRET: "0".repeat(64),
};

let migrated: Promise<string> | undefined;

/** One migrated endpoint per test process; `CLICKHOUSE_CLUSTER` would demand a Keeper. */
function migratedClickHouse(): Promise<string> {
  migrated ??= (async () => {
    const [endpoint] = await startTestClickHouseEndpoints({
      suite: "worker-live",
      names: ["schema"],
      environment: process.env,
    });
    if (!endpoint) throw new Error("No ClickHouse endpoint was provisioned");
    const previousCluster = process.env.CLICKHOUSE_CLUSTER;
    delete process.env.CLICKHOUSE_CLUSTER;
    try {
      await ClickHouseMigrateTask.createFromConfig({
        config: { buildTime: false, skipped: false, sharedUrl: endpoint.url, privateEndpoints: [] },
      }).execute();
    } finally {
      if (previousCluster !== undefined) process.env.CLICKHOUSE_CLUSTER = previousCluster;
    }
    return endpoint.url;
  })();
  return migrated;
}

/**
 * Boots the worker and starts its consumers. It takes jobs from the test Redis, so a suite that
 * must not share them with another process names its own `REDIS_DB_INDEX` in `environment`.
 */
export async function bootLiveWorker({
  environment = {},
}: { environment?: Readonly<Record<string, string>> } = {}) {
  if (!databaseUrl || !redisUrl)
    throw new Error("the live worker needs the test Postgres and Redis");
  const server = await Server.create("langwatch-worker")
    .withEnvironment({
      ...SYNTHETIC_ENVIRONMENT,
      DATABASE_URL: databaseUrl,
      REDIS_URL: redisUrl,
      CLICKHOUSE_URL: await migratedClickHouse(),
      ...environment,
    })
    .withConfig(processConfig(processModules, "worker"))
    .withProcessOwnership(false)
    .withSecrets((_config, secrets) => secrets.withEnv())
    .start();
  const application = await server.container("worker").boot();
  await server.run(application);

  return { application, close: () => server.close() };
}

export type LiveWorker = Awaited<ReturnType<typeof bootLiveWorker>>;
