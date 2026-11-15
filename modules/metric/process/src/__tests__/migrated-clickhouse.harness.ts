/**
 * ClickHouse endpoint with shipped migrations for metric suites, in a container with the app reader
 * provisioned (ADR-202): suites read as the reader and seed as the system identity. One endpoint
 * per suite: the reader is one user per server and each file provisions its own password.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";

import { migratedAppReaderClickHouse } from "./support/app-reader-clickhouse.support.ts";

export interface MigratedClickHouse {
  /** The system identity's client bound to the migrated database: seeds and cleanup. */
  client: ClickHouseClient;
  /** The process's client: reads as the app reader with the tenant setting. */
  reading: ClickHouseQueryClient;
  /** Connection URL with the migrated database in its path. */
  url: string;
  database: string;
}

/** Starts (or reuses) the suite's own migrated endpoint with the reader provisioned. */
export async function startMigratedClickHouse({
  suite,
}: {
  suite: string;
}): Promise<MigratedClickHouse> {
  const opened = await migratedAppReaderClickHouse({ suite: `metric-migrated-${suite}` });
  return {
    client: opened.admin,
    reading: opened.client,
    url: opened.endpoint.url,
    database: opened.endpoint.database,
  };
}

/**
 * Deletes one tenant's rows from the migrated metric tables. Mutations
 * rather than a dropped database, since the endpoint is shared and suites
 * key their rows on ids unique per run.
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
