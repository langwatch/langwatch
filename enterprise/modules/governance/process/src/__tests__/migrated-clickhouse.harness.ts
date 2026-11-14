// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

// ClickHouse endpoint with the shipped goose migrations, for governance's ClickHouse suites.
// Same shape as modules/experiment/process/src/__tests__/migrated-clickhouse.harness.ts.
import { type ClickHouseClient, createClient } from "@clickhouse/client";
import {
  migrateTestClickHouseOnce,
  startTestClickHouseEndpoints,
} from "@langwatch/clickhouse-client/testing";
import { ClickHouseMigrateTask } from "@langwatch/clickhouse-migrations";

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
  const [endpoint] = await startTestClickHouseEndpoints({
    suite,
    names: ["schema"],
    environment: process.env,
  });
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

  return createClient({
    url: endpoint.url,
    clickhouse_settings: { date_time_input_format: "best_effort" },
  });
}
