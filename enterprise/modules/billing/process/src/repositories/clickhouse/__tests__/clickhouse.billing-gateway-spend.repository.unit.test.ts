/**
 * @see enterprise/modules/billing/specs/billing.feature
 */
import type { ReaderReadStatement } from "@langwatch/clickhouse-client/builder";
import { describe, expect, it } from "vitest";

import { ClickHouseBillingGatewaySpendRepository } from "../clickhouse.billing-gateway-spend.repository.ts";

function ledger(row: Record<string, unknown>) {
  const statements: ReaderReadStatement[] = [];
  const clickhouse = {
    read: async ({ statement }: { statement: ReaderReadStatement }) => {
      statements.push(statement);
      return { rows: [row] };
    },
  } as never;

  return { statements, repository: ClickHouseBillingGatewaySpendRepository.create(clickhouse) };
}

const expectTenantSetRead = (statement: ReaderReadStatement | undefined) => {
  expect(statement).toMatchObject({ identity: "reader", kind: "tenant" });
  expect(statement?.settings).toMatchObject({ SQL_langwatch_tenant_ids: "project-a,project-b" });
};

describe("ClickHouseBillingGatewaySpendRepository", () => {
  describe("when billing sums an organization's spend", () => {
    /** @scenario "Billing's spend read binds exactly the organization's projects" */
    it("reads gateway_spend FINAL over exactly the organization's projects as the reader", async () => {
      const { statements, repository } = ledger({ SumCostNanoUSD: "1500" });

      const total = await repository.sumSpendNanoUsdByRequestType({
        tenantIds: ["project-a", "project-b"],
        requestType: "instant_eval",
        fromMs: 1_000,
        toMs: 2_000,
      });

      expect(total).toBe(1500);
      const [statement] = statements;
      expectTenantSetRead(statement);
      expect(statement?.sql).toContain("FROM gateway_spend FINAL");
      expect(statement?.sql).toMatch(/Status = /);
      expect(statement?.sql).toMatch(/OccurredAt >= /);
      expect(statement?.sql).toMatch(/OccurredAt < /);
      expect(Object.values(statement?.params ?? {})).toEqual(
        expect.arrayContaining(["instant_eval", "confirmed"]),
      );
    });
  });

  describe("when billing sums one budget bucket since its floor", () => {
    it("reads gateway_budget_ledger_events FINAL over the organization's projects", async () => {
      const { statements, repository } = ledger({ SpentNanoUSD: "42" });

      const total = await repository.sumBudgetSpendNanoUsd({
        tenantIds: ["project-a", "project-b"],
        budgetId: "budget-1",
        bucketScopeId: "scope-1",
        fromMs: 1_000,
      });

      expect(total).toBe(42);
      const [statement] = statements;
      expectTenantSetRead(statement);
      expect(statement?.sql).toContain("FROM gateway_budget_ledger_events FINAL");
      expect(Object.values(statement?.params ?? {})).toEqual(
        expect.arrayContaining(["success", "budget-1", "scope-1"]),
      );
    });
  });

  describe("when the organization has no projects", () => {
    /** @scenario "Billing sums one request type's confirmed spend from gateway's shared ledger" */
    it("answers zero without a read", async () => {
      const { statements, repository } = ledger({ SumCostNanoUSD: "99" });

      await expect(
        repository.sumSpendNanoUsdByRequestType({ tenantIds: [], requestType: "instant_eval" }),
      ).resolves.toBe(0);
      expect(statements).toHaveLength(0);
    });
  });
});
