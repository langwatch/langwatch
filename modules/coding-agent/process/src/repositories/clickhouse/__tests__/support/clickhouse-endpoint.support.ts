// Suites assert DDL↔repository contract on production schema; migrated
// ClickHouse or skip if unconfigured.
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import type { ClickHouseQueryClient, QueryDriver } from "@langwatch/clickhouse-client";
import { startMigratedAppReaderClickHouse } from "@langwatch/test-harness/clickhouse-app-reader";

import { CODING_AGENT_ID_INDEXES } from "../../clickhouse.coding-agent-id-indexes.database.ts";

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

export interface CodingAgentClickHouseAsReader {
  /** The system connection: the suite's own inserts, commands and checks. */
  ch: ClickHouseClient;
  /** As a worker holds it: tenant reads as the app reader, inserts and commands as the system. */
  queryClient: ClickHouseQueryClient;
  /** The reader's own driver, for a suite that composes its own system side. */
  readerDriver: QueryDriver;
  close(): Promise<void>;
}

/**
 * A migrated container with the app reader provisioned, enforcing (ADR-202). The reader's names
 * are server-wide, so this never touches the shared server `testClickHouseUrl` names.
 */
export async function startCodingAgentClickHouseAsReader({
  suite,
}: {
  suite: string;
}): Promise<CodingAgentClickHouseAsReader> {
  const opened = await startMigratedAppReaderClickHouse({
    environment: process.env,
    suite,
    indexes: CODING_AGENT_ID_INDEXES,
  });
  return {
    ch: opened.admin,
    queryClient: opened.worker,
    readerDriver: opened.readerDriver,
    close: () => opened.close(),
  };
}
