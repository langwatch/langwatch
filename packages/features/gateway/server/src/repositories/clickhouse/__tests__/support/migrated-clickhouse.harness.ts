/**
 * A ClickHouse endpoint of this suite's own, carrying the *shipped*
 * migrations: the rollup-rebuild suite replays an old view, which may never
 * touch the shared test database other suites read concurrently.
 */
import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { ClickHouseMigrateTask, DEFAULT_CLICKHOUSE_SETTINGS } from "@langwatch/clickhouse-client";
import { migrateTestClickHouseOnce, startTestClickHouseEndpoints } from "@langwatch/test-harness";

/** The one endpoint name the gateway's migrated-schema suites ask for. */
const MIGRATED_ENDPOINT_SUITE = "gateway-migrated";

export interface MigratedClickHouse {
  client: ClickHouseClient;
  url: string;
  database: string;
}

let endpoint: MigratedClickHouse | undefined;

/**
 * Starts (or reuses) the migrated endpoint and returns a client bound to it.
 * `CLICKHOUSE_CLUSTER` is unset for the migration: it switches every engine
 * to its `Replicated` form, which needs a Keeper no test server has.
 */
export async function startMigratedGatewayClickHouse(): Promise<MigratedClickHouse> {
  if (endpoint) return endpoint;

  const [provisioned] = await startTestClickHouseEndpoints({
    suite: MIGRATED_ENDPOINT_SUITE,
    names: ["schema"],
  });
  if (!provisioned) throw new Error("No ClickHouse endpoint was provisioned for the gateway suite");

  await migrateTestClickHouseOnce({
    url: provisioned.url,
    migrate: async () => {
      const previousCluster = process.env.CLICKHOUSE_CLUSTER;
      delete process.env.CLICKHOUSE_CLUSTER;
      try {
        await ClickHouseMigrateTask.createFromConfig({
          config: {
            buildTime: false,
            skipped: false,
            sharedUrl: provisioned.url,
            privateEndpoints: [],
          },
        }).execute();
      } finally {
        if (previousCluster !== undefined) process.env.CLICKHOUSE_CLUSTER = previousCluster;
      }
    },
  });

  endpoint = {
    client: createClient({
      url: provisioned.url,
      request_timeout: 180_000,
      clickhouse_settings: {
        ...DEFAULT_CLICKHOUSE_SETTINGS,
        date_time_input_format: "best_effort",
      },
    }),
    url: provisioned.url,
    database: provisioned.database,
  };

  return endpoint;
}
