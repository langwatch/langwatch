/**
 * The api booted as `main.ts` boots it, wholly live over the local Postgres, Redis and a migrated
 * ClickHouse (ARCHITECTURE.md §7: one store tier per process), served on a free loopback port.
 * Every secret is a synthetic test value: nothing here is read from `.env`.
 */
import { createServer } from "node:net";

import { processConfig, Server } from "@langwatch/process";

import { processModules } from "../process-modules.generated.ts";
import { startMigratedClickHouseEndpoint } from "./monitor-performance.fixture.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const redisUrl = process.env.LANGWATCH_TEST_REDIS_URL;
const clickHouseUrl = process.env.LANGWATCH_TEST_CLICKHOUSE_URL;

/** Whether the local Postgres, Redis and ClickHouse a live boot needs are named. */
export const liveStoresConfigured = Boolean(databaseUrl && redisUrl && clickHouseUrl);

/** The connection string of the test database the live api reads and writes. */
export function liveDatabaseUrl(): string {
  if (!databaseUrl) throw new Error("LANGWATCH_TEST_DATABASE_URL is not set");
  return databaseUrl;
}

const SYNTHETIC_ENVIRONMENT: Readonly<Record<string, string>> = {
  NODE_ENV: "test",
  NEXTAUTH_SECRET: "synthetic-nextauth-secret-synthetic",
  API_KEY_PEPPER: "synthetic-api-key-pepper",
  LW_VIRTUAL_KEY_PEPPER: "synthetic-virtual-key-pepper",
  CREDENTIALS_SECRET: "0".repeat(64),
};

/** A port the kernel just handed out, free again for the api to bind. */
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  if (address === null || typeof address === "string") throw new Error("no free port was bound");
  return address.port;
}

/**
 * Boots and serves the api. `environment` adds or overrides process settings (`IS_SAAS`, ...).
 * `baseUrl` is where it serves, also its own public address. One test process mounts a module's
 * WebSocket declaration once, so a second api boots only after the first one closes.
 */
export async function bootLiveApi({
  environment = {},
}: { environment?: Readonly<Record<string, string>> } = {}) {
  if (!databaseUrl || !redisUrl) throw new Error("the live api needs the test Postgres and Redis");
  const [clickHouse, port] = await Promise.all([startMigratedClickHouseEndpoint(), freePort()]);
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = await Server.create("langwatch-api")
    .withEnvironment({
      ...SYNTHETIC_ENVIRONMENT,
      BASE_HOST: baseUrl,
      NEXTAUTH_URL: baseUrl,
      API_PORT: String(port),
      DATABASE_URL: databaseUrl,
      REDIS_URL: redisUrl,
      CLICKHOUSE_URL: clickHouse.url,
      ...environment,
    })
    .withConfig(processConfig(processModules))
    .withProcessOwnership(false)
    .withSecrets((_config, secrets) => secrets.withEnv())
    .start();
  const application = await server
    .container("api")
    .exposeTransports((transports) => transports.trpc().rest().browserBundle(false))
    .boot();
  await server.serve(application);

  return {
    application,
    baseUrl,
    /** Sends a request to the served api; `path` is absolute (`/api/...`). */
    fetch: (path: string, init?: RequestInit) => fetch(`${baseUrl}${path}`, init),
    close: () => server.close(),
  };
}

export type LiveApi = Awaited<ReturnType<typeof bootLiveApi>>;
