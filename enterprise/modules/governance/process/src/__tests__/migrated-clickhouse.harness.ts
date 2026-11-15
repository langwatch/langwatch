// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

// ClickHouse endpoint with the shipped goose migrations, for governance's ClickHouse suites.
// Same shape as modules/experiment/process/src/__tests__/migrated-clickhouse.harness.ts.
import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { ClickHouseQueryClient, type QueryDriver, TenantGuard } from "@langwatch/clickhouse-client";
import {
  migrateTestClickHouseOnce,
  startTestClickHouseEndpoints,
  type TestClickHouseEndpoint,
  vendorQueryDriver,
} from "@langwatch/clickhouse-client/testing";
import { ClickHouseMigrateTask } from "@langwatch/clickhouse-migrations";
import { provisionTestAppReader } from "@langwatch/test-harness/clickhouse-app-reader";

const SYSTEM_SETTINGS = { date_time_input_format: "best_effort" } as const;

async function migratedEndpoint({
  suite,
  environment,
}: {
  suite: string;
  environment: Readonly<Record<string, string | undefined>>;
}): Promise<TestClickHouseEndpoint> {
  const [endpoint] = await startTestClickHouseEndpoints({ suite, names: ["schema"], environment });
  if (!endpoint) throw new Error(`No ClickHouse endpoint was provisioned for ${suite}`);

  await migrateTestClickHouseOnce({
    url: endpoint.url,
    migrate: async () => {
      const previousCluster = process.env.CLICKHOUSE_CLUSTER;
      delete process.env.CLICKHOUSE_CLUSTER;
      try {
        await ClickHouseMigrateTask.createFromConfig({
          config: { buildTime: false, sharedUrl: endpoint.url, privateEndpoints: [] },
        }).execute();
      } finally {
        if (previousCluster !== undefined) process.env.CLICKHOUSE_CLUSTER = previousCluster;
      }
    },
  });
  return endpoint;
}

/**
 * Starts (or reuses) `suite`'s endpoint and returns a client bound to its migrated database.
 * `CLICKHOUSE_CLUSTER` is unset for the migration: it switches every engine to its `Replicated`
 * form, which needs a Keeper no test server has.
 */
export async function startMigratedClickHouse({
  suite,
}: {
  suite: string;
}): Promise<ClickHouseClient> {
  const endpoint = await migratedEndpoint({ suite, environment: process.env });
  return createClient({ url: endpoint.url, clickhouse_settings: SYSTEM_SETTINGS });
}

export interface MigratedClickHouseAsReader {
  /** The system connection: the suite's own inserts, commands and checks. */
  client: ClickHouseClient;
  /** As a worker holds it: tenant reads as the app reader, inserts and commands as the system. */
  queryClient: ClickHouseQueryClient;
  close(): Promise<void>;
}

/**
 * The migrated endpoint with the app reader provisioned, enforcing (ADR-202). The reader's names
 * are server-wide, so the suite starts its own container, never the shared native server.
 */
export async function startMigratedClickHouseAsReader({
  suite,
}: {
  suite: string;
}): Promise<MigratedClickHouseAsReader> {
  const { LANGWATCH_TEST_CLICKHOUSE_URL: _native, ...containerOnly } = process.env;
  const endpoint = await migratedEndpoint({ suite, environment: containerOnly });
  const client = createClient({ url: endpoint.url, clickhouse_settings: SYSTEM_SETTINGS });
  const asReader = await appReaderOver({ endpoint, system: vendorQueryDriver({ vendor: client }) });
  return {
    client,
    queryClient: asReader.queryClient,
    async close() {
      await Promise.all([asReader.close(), client.close()]);
    },
  };
}

/**
 * Provisions the app reader on `endpoint` (a container, never the shared native server) and
 * returns a client as a worker holds it: tenant reads as the reader, the rest on `system`.
 */
export async function appReaderOver({
  endpoint,
  system,
}: {
  endpoint: TestClickHouseEndpoint;
  system: QueryDriver;
}): Promise<{
  queryClient: ClickHouseQueryClient;
  /** The reader's own driver, for a suite that composes its own system side. */
  readerDriver: QueryDriver;
  close(): Promise<void>;
}> {
  const appReader = await provisionTestAppReader({ endpoint, environment: process.env });
  const readerConnection = createClient({ url: appReader.readerUrl });
  const readerDriver = vendorQueryDriver({ vendor: readerConnection });
  return {
    queryClient: new ClickHouseQueryClient({
      driver: system,
      readerDriver,
      tenantGuard: new TenantGuard(),
    }),
    readerDriver,
    async close() {
      await Promise.all([appReader.close(), readerConnection.close()]);
    },
  };
}
