/**
 * The migrated ClickHouse these repository suites read and write, or nothing.
 *
 * The suites here assert a DDL↔repository column contract: a renamed column or
 * a widened type fails a real INSERT loudly, which no mock catches. So they
 * need the PRODUCTION schema, not a table they create themselves — a second
 * copy of the DDL beside the migrations is exactly the drift they exist to
 * find.
 *
 * Two ways to get it, in this order:
 *
 *   - The connection string the job supplies (`TEST_CLICKHOUSE_URL`, else
 *     `CI_CLICKHOUSE_URL`). In the `package-suites` job that points at a
 *     ClickHouse whose migrations have already run, so the suite reads the real
 *     schema without standing up a second server.
 *   - Otherwise the always-on local server (`LANGWATCH_TEST_CLICKHOUSE_URL`),
 *     where the harness gives this package a database of its own and replays
 *     the shipped migrations into it once per process — the same shape the
 *     private-dataplane suite next door and `@langwatch/gateway-server` use.
 *     Reading a developer's existing `test_langwatch` instead would assert
 *     against whatever migration it happens to have stopped at.
 *
 * With neither configured the suites `describe.skipIf` themselves away.
 */
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { ClickHouseMigrateTask } from "@langwatch/clickhouse-client";
import {
  migrateTestClickHouseOnce,
  nativeClickHouseBaseUrl,
  startTestClickHouseEndpoints,
} from "@langwatch/test-harness";

/** The endpoint name this package's migrated-schema suites ask the harness for. */
const MIGRATED_ENDPOINT_SUITE = "trace-migrated";

/**
 * `TEST_CLICKHOUSE_URL` names a database of its own and is taken verbatim.
 * `CI_CLICKHOUSE_URL` is the job-wide server, whose test database is
 * `test_langwatch` — the one the job migrates.
 */
function jobSuppliedUrl(): URL | null {
  const configured = process.env.TEST_CLICKHOUSE_URL ?? process.env.CI_CLICKHOUSE_URL;
  if (!configured) return null;
  const url = new URL(configured);
  if (!process.env.TEST_CLICKHOUSE_URL) url.pathname = "/test_langwatch";
  return url;
}

/** Whether any ClickHouse is reachable for these suites, checked at collect time. */
export function testClickHouseConfigured(): boolean {
  return Boolean(jobSuppliedUrl() ?? nativeClickHouseBaseUrl());
}

let localClient: ClickHouseClient | undefined;

/**
 * A client on a ClickHouse carrying the shipped migrations. Throws when none is
 * configured, so a suite that forgot its `describe.skipIf` fails loudly rather
 * than reading an empty database.
 */
export async function startMigratedTraceClickHouse(): Promise<ClickHouseClient> {
  const supplied = jobSuppliedUrl();
  if (supplied) return clientFor(supplied.toString());
  if (localClient) return localClient;

  const baseUrl = nativeClickHouseBaseUrl();
  if (!baseUrl) {
    throw new Error(
      "No ClickHouse is configured: set LANGWATCH_TEST_CLICKHOUSE_URL, TEST_CLICKHOUSE_URL or CI_CLICKHOUSE_URL.",
    );
  }

  const [provisioned] = await startTestClickHouseEndpoints({
    suite: MIGRATED_ENDPOINT_SUITE,
    names: ["schema"],
  });
  if (!provisioned) throw new Error("No ClickHouse endpoint was provisioned for the trace suites");

  await migrateTestClickHouseOnce({
    url: provisioned.url,
    migrate: async () => {
      // CLICKHOUSE_CLUSTER switches every engine to its Replicated form, which
      // needs a Keeper no test server has.
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

  localClient = clientFor(provisioned.url);
  return localClient;
}

function clientFor(url: string): ClickHouseClient {
  return createClient({
    url,
    clickhouse_settings: { date_time_input_format: "best_effort" },
  });
}
