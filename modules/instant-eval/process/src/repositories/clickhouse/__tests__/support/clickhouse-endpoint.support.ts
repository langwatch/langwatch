// Suites assert DDL↔repository contract on production schema; migrated
// ClickHouse or skip if unconfigured.
import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { startMigratedAppReaderClickHouse } from "@langwatch/test-harness/clickhouse-app-reader";

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

/**
 * Instant-eval's migrated container with the app reader provisioned (ADR-202): suites read as the
 * reader through `worker` and seed or clean as the system identity through `admin`.
 */
export function startInstantEvalReaderClickHouse() {
  return startMigratedAppReaderClickHouse({
    suite: "instant-eval-migrated",
    environment: process.env,
  });
}
