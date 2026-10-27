/**
 * The migrated ClickHouse these repository suites read and write, or null.
 * Reads the connection string the job supplies and `describe.skipIf` away
 * when none — the same shape every other datastore-needing suite uses.
 */
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { vendorQueryClient } from "@langwatch/clickhouse-client/testing";

import { GATEWAY_ID_INDEXES } from "../../clickhouse.gateway-id-indexes.database.ts";
import {
  ClickHouseGatewaySession,
  type GatewayClickHouseResolver,
} from "../../clickhouse.gateway-session.store.ts";

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
 * The gateway's own read path over a suite's connection: the process's client with gateway's
 * id indexes declared, one tenant's session per resolve, so an id-bound read expands its marker.
 */
export function gatewayClickHouseOver(vendor: ClickHouseClient): GatewayClickHouseResolver {
  const clickhouse = vendorQueryClient({ vendor, indexes: GATEWAY_ID_INDEXES });
  return async (tenantId) => ClickHouseGatewaySession.create({ clickhouse, tenantId });
}
