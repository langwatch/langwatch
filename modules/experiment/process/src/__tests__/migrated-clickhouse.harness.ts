// ClickHouse endpoint with real shipped migrations for experiment suites, in a container with the
// app reader provisioned (ADR-202): suites read as the reader and seed as the system identity.
import type { ClickHouseClient } from "@clickhouse/client";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";

import {
  EXPERIMENT_ID_INDEXES,
  EXPERIMENT_SECOND_ID_INDEXES,
} from "../repositories/clickhouse/clickhouse.experiment-id-indexes.database.ts";
import { migratedAppReaderClickHouse } from "./support/app-reader-clickhouse.support.ts";

export interface MigratedClickHouse {
  /** The system identity's client bound to the migrated database: seeds and cleanup. */
  client: ClickHouseClient;
  /** The process's client with experiment's id indexes: reads as the app reader. */
  reading: ClickHouseQueryClient;
  /** Connection URL with the migrated database in its path. */
  url: string;
  database: string;
}

/**
 * Starts (or reuses) the suite's own migrated endpoint with the reader provisioned. One endpoint
 * per suite: the reader is one user per server and each file provisions its own password, so two
 * files running at once on one server would replace each other's reader.
 */
export async function startMigratedClickHouse({
  suite,
}: {
  suite: string;
}): Promise<MigratedClickHouse> {
  const opened = await migratedAppReaderClickHouse({
    suite: `experiment-migrated-${suite}`,
    indexes: [...EXPERIMENT_ID_INDEXES, ...EXPERIMENT_SECOND_ID_INDEXES],
  });
  return {
    client: opened.admin,
    reading: opened.client,
    url: opened.endpoint.url,
    database: opened.endpoint.database,
  };
}
/**
 * Deletes one tenant's rows from the migrated tables. Mutations rather than
 * a dropped database: the endpoint is shared, and suites key their rows on
 * ids unique per run.
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
