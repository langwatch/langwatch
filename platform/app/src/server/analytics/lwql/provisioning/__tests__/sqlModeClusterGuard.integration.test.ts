/**
 * AC9 end-to-end coercion proof (issue #8258). The unit test drives the guard
 * with fake rows; this runs the guard's real SQL through the real
 * `@clickhouse/client` under `JSONEachRow` — the exact path
 * `selfProvisionEntry` uses — against the single-node harness ClickHouse.
 *
 * It pins the bug that live e2e caught: a UInt8 `is_local` arrives as a JS
 * number, not the string "1". The guard counts in SQL now, so the parsed host
 * count is exactly 1 on this lone node and the guard permits. The multi-host
 * refusal stays proven by the chart e2e (`test_lwql_replicas` scenario 2).
 *
 * @see ../sqlModeClusterGuard.ts
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  type LangWatchQLClickHouseHarness,
  startLangWatchQLClickHouse,
} from "../../__tests__/lwqlClickHouseHarness";
import {
  assertLwqlSqlModeClusterSafe,
  type ClusterGuardQuery,
  maxOwnClusterHostCount,
  maxReplicaHostCount,
} from "../sqlModeClusterGuard";

/** The guard's query as production wires it: real client, `JSONEachRow`. */
function clusterGuardQuery(client: ClickHouseClient): ClusterGuardQuery {
  return async (sql) =>
    (await (
      await client.query({ query: sql, format: "JSONEachRow" })
    ).json()) as Record<string, unknown>[];
}

describe("assertLwqlSqlModeClusterSafe against real ClickHouse", () => {
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
    expect(await maxOwnClusterHostCount(query)).toBe(1);
  });

  it("counts no replicated-table hosts on a lone node", async () => {
    expect(await maxReplicaHostCount(query)).toBe(0);
  });

  it("permits sql mode on the single node", async () => {
    await expect(
      assertLwqlSqlModeClusterSafe({ query, env: {} }),
    ).resolves.toBeUndefined();
  });
});
