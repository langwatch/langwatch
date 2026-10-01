// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * `ClickHouseGovernanceRepositories.requires = ["clickhouse"]` claims a
 * `ClickHouseQueryClient` instance, so this constructs the live tier from a
 * real one — never a hand-rolled resolver function — and performs a read
 * through it. Before the fix, `create` expected `{ clickhouse: (tenantId) =>
 * Promise<ClickHouseClient> }`; handed the actual process member, the first
 * `clickhouse(tenantId)` call threw `clickhouse is not a function` at
 * runtime, invisible to every type check because `feature-installer`'s
 * `AnyProvider` erases `create`'s parameter type.
 *
 * Spec: specs/ai-gateway/governance/folds.feature
 */
import type { QueryRequest, QueryResult } from "@langwatch/clickhouse-client";
import { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { ClickHouseGovernanceRepositories } from "../clickhouse.governance-clickhouse.repositories.ts";

/** These cases are about reads; a write reaching the driver is the test failing. */
const unusedInsert = async (): Promise<void> => {
  throw new Error("insert is not part of this case");
};
const unusedCommand = async (): Promise<void> => {
  throw new Error("command is not part of this case");
};

function memberOver(rows: unknown[]) {
  const calls: QueryRequest[] = [];
  const clickhouse = new ClickHouseQueryClient({
    driver: {
      // Generic, matching QueryDriver.execute exactly: a stub driver cannot
      // know the caller's Row at compile time, only at the one call site
      // that names it, so the cast lives here and nowhere a real read runs.
      execute: async <Row>(request: QueryRequest): Promise<QueryResult<Row>> => {
        calls.push(request);
        return { rows: rows as Row[] };
      },
      insert: unusedInsert,
      command: unusedCommand,
    },
  });
  return { calls, clickhouse };
}

const spendTotalsInput = {
  tenantId: "org_test",
  windowStart: Temporal.Instant.fromEpochMilliseconds(2_000),
  windowEnd: Temporal.Instant.fromEpochMilliseconds(3_000),
  baselineStart: Temporal.Instant.fromEpochMilliseconds(1_000),
  sourceFilter: { type: "all" as const },
};

describe("ClickHouseGovernanceRepositories.create", () => {
  describe("given the real clickhouse process member, a ClickHouseQueryClient instance", () => {
    it("constructs every repository and performs a scoped read through it", async () => {
      const { calls, clickhouse } = memberOver([{ currentSpend: "2", baselineSpend: "1" }]);

      const repositories = ClickHouseGovernanceRepositories.create({ clickhouse });
      const totals = await repositories.anomalySpend.findSpendTotals(spendTotalsInput);

      expect(totals).toEqual({ currentSpend: 2, baselineSpend: 1 });
      expect(calls).toHaveLength(1);
      const request = calls[0];
      // Per-tenant scoping is the point: the member call itself names the
      // same tenant the query's own `TenantId` predicate is bound to.
      expect(request?.tenantId).toBe("org_test");
      expect(request?.params?.tenantId).toBe("org_test");
      expect(request?.sql).toContain("TenantId = {tenantId:String}");
    });

    it("reads an empty result as zero spend", async () => {
      const { clickhouse } = memberOver([]);

      const repositories = ClickHouseGovernanceRepositories.create({ clickhouse });
      const totals = await repositories.anomalySpend.findSpendTotals(spendTotalsInput);

      expect(totals).toEqual({ currentSpend: 0, baselineSpend: 0 });
    });
  });
});
