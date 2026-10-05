/**
 * The budget reads span every project of the budget's organisation. Each one runs through the real
 * tenant guard here, so a statement the guard would refuse on a live stack fails this test.
 */
import { TenantGuard } from "@langwatch/clickhouse-client";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type { GatewayBudgetSpendRecord } from "../../gateway-budget-spend.repository.ts";
import { GatewayBudgetClickHouseRepository } from "../clickhouse.gateway-budget.repository.ts";
import type { GatewayClickHouseClient } from "../clickhouse.gateway-session.store.ts";

const PROJECTS = ["project-a", "project-b"];
const NOW = Temporal.Instant.from("2026-09-15T12:00:00Z");

type Statement = Parameters<GatewayClickHouseClient["query"]>[0];

function guardedRepository() {
  const guard = new TenantGuard();
  const statements: Statement[] = [];
  const repository = GatewayBudgetClickHouseRepository.create(async (tenantId) => ({
    query: async (input) => {
      guard.assert({
        tenantId,
        sql: input.query,
        params: input.query_params,
        ...(input.tenantIds ? { tenantIds: input.tenantIds } : {}),
        ...(input.unscoped ? { unscoped: input.unscoped } : {}),
      });
      statements.push(input);
      return { json: async () => [] };
    },
    insert: async () => undefined,
  }));
  return { repository, statements };
}

const budget: GatewayBudgetSpendRecord = {
  id: "budget-1",
  scopeType: "ORGANIZATION",
  scopeId: "org-1",
  window: "MONTH",
  providerKey: null,
  currentPeriodStartedAt: Temporal.Instant.from("2026-09-01T00:00:00Z"),
  lastResetAt: null,
  cycleAnchorAt: null,
};

describe("GatewayBudgetClickHouseRepository across an organisation's projects", () => {
  describe("when the budget's organisation has two projects", () => {
    /** @scenario "A budget's spend and recent ledger read across its organisation's projects under the tenant guard" */
    it("reads the ledger, the target spend and the bucket spend as guarded tenant-set statements", async () => {
      const { repository, statements } = guardedRepository();

      await expect(repository.recentEventsForBudget(PROJECTS, "budget-1")).resolves.toEqual([]);
      await repository.findSpendForTargetsAcrossTenants(
        PROJECTS,
        [
          { budgetId: "budget-1", scope: "ORGANIZATION", scopeId: "org-1", window: "MONTH" },
          {
            budgetId: "budget-2",
            scope: "ORGANIZATION",
            scopeId: "org-1",
            window: "MANUAL",
            periodFloorMs: NOW.epochMilliseconds - 3_600_000,
          },
        ],
        NOW,
      );
      await repository.findBucketSpendBreakdownForBudget({
        budget,
        tenantIds: PROJECTS,
        boundaries: [],
        now: NOW,
      });

      expect(statements).toHaveLength(4);
      for (const statement of statements) {
        expect(statement.tenantIds).toEqual(PROJECTS);
        expect(statement.query).toContain("TenantId IN (");
        expect(statement.unscoped).toBeUndefined();
      }
    });
  });

  describe("when the budget's organisation has no projects", () => {
    /** @scenario "A budget whose organisation has no projects reads no ledger" */
    it("answers empty without a statement", async () => {
      const { repository, statements } = guardedRepository();

      await expect(repository.recentEventsForBudget([], "budget-1")).resolves.toEqual([]);
      await expect(
        repository.findSpendForTargetsAcrossTenants(
          [],
          [{ budgetId: "budget-1", scope: "ORGANIZATION", scopeId: "org-1", window: "MONTH" }],
          NOW,
        ),
      ).resolves.toEqual([]);
      expect(statements).toHaveLength(0);
    });
  });
});
