/** The cluster guard's topology queries against a real single-node ClickHouse. */
import type { ClickHouseClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  type LangWatchQLClickHouseHarness,
  startLangWatchQLClickHouse,
} from "../../langwatch-ql/__tests__/lwql-clickhouse-harness.ts";
import {
  type ClusterGuardQuery,
  LangWatchQLSqlModeClusterGuardService,
} from "../langwatch-ql-sql-mode-cluster-guard.service.ts";

const clusterGuard = LangWatchQLSqlModeClusterGuardService.create();

/** The guard's query as production wires it: real client, `JSONEachRow`. */
function clusterGuardQuery(client: ClickHouseClient): ClusterGuardQuery {
  return async (sql) =>
    (await (await client.query({ query: sql, format: "JSONEachRow" })).json()) as Record<
      string,
      unknown
    >[];
}

describe("the SQL-mode cluster guard against real ClickHouse", () => {
  let harness: LangWatchQLClickHouseHarness;
  let query: ClusterGuardQuery;

  beforeAll(async () => {
    harness = await startLangWatchQLClickHouse({
      suite: "sqlModeClusterGuard",
    });
    query = clusterGuardQuery(harness.admin);
  });

  afterAll(async () => {
    await harness.stop();
  });

  it("parses the single node's host count as exactly 1 through JSONEachRow", async () => {
    expect(await clusterGuard.maxOwnClusterHostCount(query)).toBe(1);
  });

  it("counts no replicated-table hosts on a lone node", async () => {
    expect(await clusterGuard.maxReplicaHostCount(query)).toBe(0);
  });

  it("permits sql mode on the single node", async () => {
    await expect(clusterGuard.assertSafe({ query, source: {} })).resolves.toBeUndefined();
  });
});
