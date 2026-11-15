/**
 * A container ClickHouse with the app reader provisioned as the upgrade does (ADR-202), and the
 * process's client over it: reads as the reader, inserts and commands as the system identity.
 */
import { type ClickHouseClient, createClient } from "@clickhouse/client";
import {
  ClickHouseQueryClient,
  DEFAULT_CLICKHOUSE_SETTINGS,
  type IdIndexDeclaration,
  type QueryDriver,
  TenantGuard,
} from "@langwatch/clickhouse-client";
import {
  migrateTestClickHouseOnce,
  startTestClickHouseEndpoints,
  type TestClickHouseEndpoint,
  vendorQueryDriver,
} from "@langwatch/clickhouse-client/testing";
import { ClickHouseMigrateTask } from "@langwatch/clickhouse-migrations";
import { provisionTestAppReader } from "@langwatch/test-harness/clickhouse-app-reader";

export interface AppReaderClickHouse {
  endpoint: TestClickHouseEndpoint;
  /** The system identity's raw connection: a suite's DDL, seed inserts and cleanup. */
  admin: ClickHouseClient;
  /** The reader's raw connection, for a suite that wraps the driver its reads go through. */
  readerConnection: ClickHouseClient;
  /** As the process holds it: reads as the app reader, inserts and commands as the system. */
  client: ClickHouseQueryClient;
  close(): Promise<void>;
}

/** One container endpoint per suite, never the shared native server. */
export async function startAppReaderEndpoint({
  suite,
}: {
  suite: string;
}): Promise<TestClickHouseEndpoint> {
  const { LANGWATCH_TEST_CLICKHOUSE_URL: _shared, ...containerOnly } = process.env;
  const [endpoint] = await startTestClickHouseEndpoints({
    suite,
    names: ["reader"],
    environment: containerOnly,
  });
  if (!endpoint) throw new Error(`No ClickHouse endpoint was provisioned for ${suite}`);
  return endpoint;
}

/** The goose-migrated schema on the suite's own endpoint, as the upgrade applies it. */
export async function migrateAppReaderEndpoint({
  endpoint,
}: {
  endpoint: TestClickHouseEndpoint;
}): Promise<void> {
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
}

/** Provisions the reader on `endpoint` and opens the process's client over both identities. */
export async function appReaderClickHouseOver({
  endpoint,
  indexes = [],
  wrapReaderDriver = (driver) => driver,
}: {
  endpoint: TestClickHouseEndpoint;
  indexes?: readonly IdIndexDeclaration[];
  /** Wraps the reader's driver, for a suite that counts the reads it sends. */
  wrapReaderDriver?: (driver: QueryDriver) => QueryDriver;
}): Promise<AppReaderClickHouse> {
  const appReader = await provisionTestAppReader({ endpoint, environment: process.env, indexes });
  const admin = createClient({
    url: endpoint.url,
    clickhouse_settings: { ...DEFAULT_CLICKHOUSE_SETTINGS, date_time_input_format: "best_effort" },
  });
  const readerConnection = createClient({ url: appReader.readerUrl });
  const client = new ClickHouseQueryClient({
    driver: vendorQueryDriver({ vendor: admin }),
    readerDriver: wrapReaderDriver(vendorQueryDriver({ vendor: readerConnection })),
    tenantGuard: new TenantGuard(),
  });
  client.declareIdIndexes({ indexes });
  return {
    endpoint,
    admin,
    readerConnection,
    client,
    async close() {
      await Promise.all([appReader.close(), admin.close(), readerConnection.close()]);
    },
  };
}

const migrated = new Map<string, Promise<AppReaderClickHouse>>();

/** The suite's migrated endpoint with the reader provisioned, opened once per suite name. */
export function migratedAppReaderClickHouse({
  suite,
  indexes = [],
}: {
  suite: string;
  indexes?: readonly IdIndexDeclaration[];
}): Promise<AppReaderClickHouse> {
  let opened = migrated.get(suite);
  if (!opened) {
    opened = (async () => {
      const endpoint = await startAppReaderEndpoint({ suite });
      await migrateAppReaderEndpoint({ endpoint });
      return appReaderClickHouseOver({ endpoint, indexes });
    })();
    migrated.set(suite, opened);
  }
  return opened;
}
