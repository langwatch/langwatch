/**
 * A ClickHouse endpoint of this suite's own, carrying the *shipped* migrations and the app reader
 * (ADR-202): the rollup-rebuild suite replays an old view, which may never touch the shared test
 * database other suites read concurrently. Suites read as the reader and seed as the system.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { startMigratedAppReaderClickHouse } from "@langwatch/test-harness/clickhouse-app-reader";

import { GATEWAY_ID_INDEXES } from "../../clickhouse.gateway-id-indexes.database.ts";

export interface MigratedClickHouse {
  /** The system identity's client bound to the migrated database: seeds, cleanup and DDL. */
  client: ClickHouseClient;
  /** The process's client with gateway's id indexes: tenant reads go out as the app reader. */
  reading: ClickHouseQueryClient;
  url: string;
  database: string;
}

/** Starts (or reuses) the gateway's migrated endpoint with the reader provisioned. */
export async function startMigratedGatewayClickHouse(): Promise<MigratedClickHouse> {
  const opened = await startMigratedAppReaderClickHouse({
    suite: "gateway-migrated",
    indexes: GATEWAY_ID_INDEXES,
    environment: process.env,
  });
  return {
    client: opened.admin,
    reading: opened.worker,
    url: opened.endpoint.url,
    database: opened.endpoint.database,
  };
}
