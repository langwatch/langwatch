/**
 * ClickHouse endpoint with shipped migrations for metric suites, in a container with the app reader
 * provisioned (ADR-202): suites read as the reader and seed as the system identity. Every metric
 * file shares the one endpoint, one file at a time: each holds the server until its process ends.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { startMigratedAppReaderClickHouse } from "@langwatch/test-harness/clickhouse-app-reader";

export interface MigratedClickHouse {
  /** The system identity's client bound to the migrated database: seeds and cleanup. */
  client: ClickHouseClient;
  /** The process's client: reads as the app reader with the tenant setting. */
  reading: ClickHouseQueryClient;
  /** Connection URL with the migrated database in its path. */
  url: string;
  database: string;
}

/** Starts (or reuses) metric's migrated endpoint with the reader provisioned. */
export async function startMigratedClickHouse(): Promise<MigratedClickHouse> {
  const opened = await startMigratedAppReaderClickHouse({
    suite: "metric-migrated",
    environment: process.env,
  });
  return {
    client: opened.admin,
    reading: opened.worker,
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
