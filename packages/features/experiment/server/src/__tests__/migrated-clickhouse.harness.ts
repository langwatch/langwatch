/**
 * A ClickHouse endpoint carrying the *shipped* migrations, for experiment
 * suites that must read the real `experiment_runs` / `experiment_run_items`
 * schema rather than a transcription of it.
 *
 * The endpoint comes from `startTestClickHouseEndpoints`, so the suite runs
 * against the always-on native server when one is configured and a reusable
 * container otherwise, and the schema comes from `ClickHouseMigrateTask` —
 * the same goose run production performs. `CarriedOver` arrived in a
 * migration, and a suite carrying its own DDL would prove the transcription
 * rather than the column the product deploys.
 */
import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { ClickHouseMigrateTask, DEFAULT_CLICKHOUSE_SETTINGS } from "@langwatch/clickhouse-client";
import { migrateTestClickHouseOnce, startTestClickHouseEndpoints } from "@langwatch/test-harness";

/** The one endpoint name every migrated-schema experiment suite asks for. */
const MIGRATED_ENDPOINT_SUITE = "experiment-migrated";

export interface MigratedClickHouse {
  /** Client bound to the migrated database. */
  client: ClickHouseClient;
  /** Connection URL with the migrated database in its path. */
  url: string;
  database: string;
}

let endpoint: MigratedClickHouse | undefined;

/**
 * Starts (or reuses) the migrated endpoint and returns a client bound to it.
 *
 * `CLICKHOUSE_CLUSTER` is unset for the migration: it switches every engine to
 * its `Replicated` form, which needs a Keeper no test server has.
 */
export async function startMigratedClickHouse(): Promise<MigratedClickHouse> {
  if (endpoint) return endpoint;

  const [provisioned] = await startTestClickHouseEndpoints({
    suite: MIGRATED_ENDPOINT_SUITE,
    names: ["schema"],
  });
  if (!provisioned) {
    throw new Error("No ClickHouse endpoint was provisioned for the experiment schema suite");
  }

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

/**
 * Deletes one tenant's rows from the migrated tables.
 *
 * Mutations rather than a dropped database: the endpoint is shared, and the
 * suites key their rows on ids unique per run.
 */
export async function deleteMigratedTenantRows({
  client,
  tenantId,
  tables,
}: {
  client: ClickHouseClient;
  tenantId: string;
  tables: readonly string[];
}): Promise<void> {
  for (const table of tables) {
    await client.command({
      query: `ALTER TABLE ${table} DELETE WHERE TenantId = {tenantId:String}`,
      query_params: { tenantId },
    });
  }
}
