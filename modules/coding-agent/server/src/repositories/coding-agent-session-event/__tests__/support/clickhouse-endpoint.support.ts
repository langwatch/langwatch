/**
 * The migrated ClickHouse these repository suites read and write, or null.
 *
 * The suites here assert a DDL↔repository column contract: a renamed column or
 * a widened type fails a real INSERT loudly, which no mock catches. So they
 * need the PRODUCTION schema, not a table they create themselves — a second
 * copy of the DDL beside the migrations is exactly the drift they exist to
 * find.
 *
 * They used to get it from `startTestContainers()` in the monolith, which
 * started a container and replayed the migrations into it. That module went
 * with platform/app, and the two suites importing it have been unresolvable
 * ever since — which is why the package's test script excluded every
 * `*.integration.test.ts` rather than failing to collect.
 *
 * The replacement is the shape every other package suite that needs a
 * datastore already uses (`@langwatch/analytics-server`'s
 * evaluation-analytics suite, `@langwatch/ops-server`'s redis suites): read the
 * connection string the job supplies, and `describe.skipIf` it away when there
 * is none. In the `package-suites` job that string points at a ClickHouse whose
 * migrations have already run, so the suite gets the real schema without
 * standing up a second server; on a laptop with no ClickHouse configured it
 * skips instead of failing.
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
