/**
 * @see enterprise/modules/billing/specs/billing.feature
 */
import { type QueryRequest, TenantGuard } from "@langwatch/clickhouse-client";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it } from "vitest";

import { ClickHouseBillingGatewaySpendRepository } from "../clickhouse.billing-gateway-spend.repository.ts";

function ledger(sum: unknown) {
  const requests: QueryRequest[] = [];
  const clickhouse = clickHouseQueryClientDouble({
    query: async (request: QueryRequest) => {
      requests.push(request);
      return { rows: [{ CostNanoUSD: sum }] } as never;
    },
  });

  return { requests, repository: ClickHouseBillingGatewaySpendRepository.create(clickhouse) };
}

describe("ClickHouseBillingGatewaySpendRepository", () => {
  describe("when billing sums an organization's spend", () => {
    /** @scenario "Billing's spend read binds exactly the organization's projects" */
    it("reads gateway_spend FINAL with one bound tenant per project, which the guard admits", async () => {
      const { requests, repository } = ledger("1500");

      const total = await repository.sumSpendNanoUsdByRequestType({
        tenantIds: ["project-a", "project-b"],
        requestType: "instant_eval",
        fromMs: 1_000,
        toMs: 2_000,
      });

      expect(total).toBe(1500);
      const [request] = requests;
      expect(request?.table).toBe("gateway_spend");
      expect(request?.sql).toContain("FROM gateway_spend FINAL");
      expect(request?.sql).toContain("TenantId IN ({tenant0:String}, {tenant1:String})");
      expect(request?.sql).toContain("Status = 'confirmed'");
      expect(request?.params).toMatchObject({
        tenant0: "project-a",
        tenant1: "project-b",
        requestType: "instant_eval",
        fromMs: 1_000,
        toMs: 2_000,
      });
      expect(() => new TenantGuard().assert(request!)).not.toThrow();
    });
  });

  describe("when the organization has no projects", () => {
    /** @scenario "Billing sums one request type's confirmed spend from gateway's shared ledger" */
    it("answers zero without a read", async () => {
      const { requests, repository } = ledger("99");

      await expect(
        repository.sumSpendNanoUsdByRequestType({ tenantIds: [], requestType: "instant_eval" }),
      ).resolves.toBe(0);
      expect(requests).toHaveLength(0);
    });
  });
});
