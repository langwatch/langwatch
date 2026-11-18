/**
 * A scratch ClickHouse database for the retention integration suites, on the server
 * LANGWATCH_TEST_CLICKHOUSE_URL names, with the query client the repositories take.
 */
import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { ClickHouseQueryClient, type QueryDriver, TenantGuard } from "@langwatch/clickhouse-client";
import { generate } from "@langwatch/ksuid";

import { DECLARED_ID_INDEXES } from "./declared-id-indexes.fixture.ts";

/** The server alone: each suite makes its own scratch database; CI's URL names test_langwatch. */
export const scratchClickHouseUrl = serverUrl(
  process.env.LANGWATCH_TEST_CLICKHOUSE_URL ?? process.env.CI_CLICKHOUSE_URL,
);

function serverUrl(configured: string | undefined): string | undefined {
  if (configured === undefined) return undefined;
  const url = new URL(configured);
  url.pathname = "/";
  return url.toString();
}

export type ScratchClickHouse = Readonly<{
  scoped: ClickHouseClient;
  queryClient: ClickHouseQueryClient;
  drop: () => Promise<void>;
}>;

export async function createScratchClickHouse({
  url,
  prefix,
}: {
  url: string;
  prefix: string;
}): Promise<ScratchClickHouse> {
  const database = `${prefix}_${generate("test").toString().toLowerCase()}`;
  const admin = createClient({ url });
  await admin.command({ query: `CREATE DATABASE ${database}` });
  const scoped = createClient({ url, database, clickhouse_settings: { mutations_sync: "2" } });
  return {
    scoped,
    queryClient: queryClientOver(scoped),
    drop: async () => {
      await admin.command({ query: `DROP DATABASE IF EXISTS ${database}` });
      await Promise.all([admin.close(), scoped.close()]);
    },
  };
}

function queryClientOver(client: ClickHouseClient): ClickHouseQueryClient {
  const driver: QueryDriver = {
    async execute(request) {
      const result = await client.query({
        query: request.sql,
        format: "JSONEachRow",
        ...(request.params === undefined ? {} : { query_params: request.params }),
      });
      return { rows: await result.json() };
    },
    async insert(request) {
      await client.insert({ table: request.table, values: request.rows, format: "JSONEachRow" });
    },
    async command(request) {
      await client.command({
        query: request.sql,
        ...(request.params === undefined ? {} : { query_params: request.params }),
      });
    },
  };
  const routed = new ClickHouseQueryClient({ tenantGuard: new TenantGuard(), driver });
  routed.declareIdIndexes({ indexes: DECLARED_ID_INDEXES });
  return routed;
}
