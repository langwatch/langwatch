/**
 * Vitest global setup for this package's integration suite: runs exactly
 * once, before any test file, so table creation happens once per suite
 * regardless of how many `*.integration.test.ts` files exist (see
 * `testClickHouse.ts`'s docblock for why isolation is by tenant id instead of
 * by database, and why a database-per-test would be the slow choice).
 */
import { createClient } from "@clickhouse/client";
import { FIXTURE_TABLE_DDL } from "./fixtures";
import { startTestClickHouse, writeTestClickHouseInfo } from "./testClickHouse";

export async function setup(): Promise<void> {
  const { url } = await startTestClickHouse();

  const client = createClient({ url });
  try {
    for (const ddl of FIXTURE_TABLE_DDL) {
      await client.command({ query: ddl });
    }
  } finally {
    await client.close();
  }

  writeTestClickHouseInfo({ url });
}

export async function teardown(): Promise<void> {
  // Nothing to stop: a native local ClickHouse is the always-on dev
  // instance, and a container started with `.withReuse()` is left running
  // for the next run, same as `langwatch/vitest.integration.config.ts`'s own
  // globalSetup. Fixture tables and their rows are left in place too — the
  // next run drops and recreates them (see `FIXTURE_TABLE_DDL`).
}
