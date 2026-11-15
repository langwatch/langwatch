// Suites assert DDL↔repository contract on production schema; migrated
// ClickHouse or skip if unconfigured.
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { ClickHouseQueryClient, type QueryDriver, TenantGuard } from "@langwatch/clickhouse-client";
import {
  migrateTestClickHouseOnce,
  startTestClickHouseEndpoints,
  vendorQueryDriver,
} from "@langwatch/clickhouse-client/testing";
import { ClickHouseMigrateTask } from "@langwatch/clickhouse-migrations";
import { provisionTestAppReader } from "@langwatch/test-harness/clickhouse-app-reader";

import { CODING_AGENT_ID_INDEXES } from "../../clickhouse.coding-agent-id-indexes.database.ts";

/**
 * `TEST_CLICKHOUSE_URL` names a database of its own and is taken verbatim.
 * `CI_CLICKHOUSE_URL` is the job-wide server, whose test database is
 * `test_langwatch` — the one the job migrates.
 */
export function testClickHouseUrl(): URL | null {
  const configured = process.env.TEST_CLICKHOUSE_URL ?? process.env.CI_CLICKHOUSE_URL;
  if (!configured) return null;
  const url = new URL(configured);
  if (!process.env.TEST_CLICKHOUSE_URL) url.pathname = "/test_langwatch";
  return url;
}

export function createTestClickHouseClient(url: URL): ClickHouseClient {
  return createClient({
    url,
    clickhouse_settings: { date_time_input_format: "best_effort" },
  });
}

export interface CodingAgentClickHouseAsReader {
  /** The system connection: the suite's own inserts, commands and checks. */
  ch: ClickHouseClient;
  /** As a worker holds it: tenant reads as the app reader, inserts and commands as the system. */
  queryClient: ClickHouseQueryClient;
  /** The reader's own driver, for a suite that composes its own system side. */
  readerDriver: QueryDriver;
  close(): Promise<void>;
}

/**
 * A migrated container with the app reader provisioned, enforcing (ADR-202). The reader's names
 * are server-wide, so this never touches the shared server `testClickHouseUrl` names.
 */
export async function startCodingAgentClickHouseAsReader({
  suite,
}: {
  suite: string;
}): Promise<CodingAgentClickHouseAsReader> {
  const { LANGWATCH_TEST_CLICKHOUSE_URL: _native, ...containerOnly } = process.env;
  const [endpoint] = await startTestClickHouseEndpoints({
    suite,
    names: ["schema"],
    environment: containerOnly,
  });
  if (!endpoint) throw new Error(`No ClickHouse endpoint was provisioned for ${suite}`);
  await migrateTestClickHouseOnce({
    url: endpoint.url,
    migrate: async () => {
      // CLICKHOUSE_CLUSTER switches every engine to its Replicated form, which needs a Keeper.
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
  const appReader = await provisionTestAppReader({ endpoint, environment: process.env });
  const ch = createTestClickHouseClient(new URL(endpoint.url));
  const readerConnection = createClient({ url: appReader.readerUrl });
  const readerDriver = vendorQueryDriver({ vendor: readerConnection });
  const queryClient = new ClickHouseQueryClient({
    driver: vendorQueryDriver({ vendor: ch }),
    readerDriver,
    tenantGuard: new TenantGuard(),
  });
  queryClient.declareIdIndexes({ indexes: CODING_AGENT_ID_INDEXES });
  return {
    ch,
    queryClient,
    readerDriver,
    async close() {
      await Promise.all([appReader.close(), readerConnection.close(), ch.close()]);
    },
  };
}
