/**
 * The migrated ClickHouse these repository suites read and write, or null.
 *
 * They used to get it from `startTestContainers()` in the monolith, which
 * started a container and replayed the migrations into it. That module went
 * with platform/app.
 *
 * The replacement is the shape every other package suite that needs a
 * datastore already uses (`@langwatch/trace-server`'s repository suites,
 * `@langwatch/analytics-server`'s evaluation-analytics suite): read the
 * connection string the job supplies, and `describe.skipIf` it away when
 * there is none.
 */
import { createClient, type ClickHouseClient } from "@clickhouse/client";

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
