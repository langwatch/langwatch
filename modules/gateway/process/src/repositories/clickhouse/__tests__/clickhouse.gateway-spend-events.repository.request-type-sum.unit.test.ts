/**
 * The lifetime read one request type's allowance is judged against: TenantId
 * filtered first, confirmed rows only, and the partition column bounded when
 * a window is given. @see specs/instant-evals/instant-eval-billing.feature
 */

import { describe, expect, it } from "vitest";

import { GatewaySpendEventsRepository } from "../clickhouse.gateway-spend-events.repository.ts";

type Query = { query: string; query_params: Record<string, unknown> };

function repositoryOver(rows: unknown[] = []) {
  const queries: Query[] = [];
  const resolvedFor: string[] = [];
  const client = {
    query: async (q: Query) => {
      queries.push(q);

      return { json: async () => rows };
    },
  };

  return {
    queries,
    resolvedFor,
    repository: GatewaySpendEventsRepository.create(async (tenantId: string) => {
      resolvedFor.push(tenantId);

      return client as never;
    }),
  };
}

describe("given a ledger holding confirmed judgement rows", () => {
  describe("when the whole ledger is summed for one request type", () => {
    it("filters TenantId first, takes confirmed rows only, and bounds no window", async () => {
      const { repository, queries, resolvedFor } = repositoryOver([{ CostNanoUSD: "1500000000" }]);

      const total = await repository.sumCostNanoUsdByRequestType({
        tenantIds: ["project-1", "project-2"],
        requestType: "instant_eval",
      });

      const sql = queries[0]!.query;
      expect(sql.indexOf("WHERE TenantId IN")).toBeGreaterThan(-1);
      expect(sql.indexOf("TenantId")).toBeLessThan(sql.indexOf("RequestType"));
      expect(sql).toContain("Status = 'confirmed'");
      expect(sql).not.toContain("OccurredAt");
      expect(queries[0]!.query_params).toEqual({
        tenantIds: ["project-1", "project-2"],
        requestType: "instant_eval",
      });
      expect(resolvedFor).toEqual(["project-1"]);
      expect(total).toBe(1_500_000_000);
    });
  });

  describe("when a window is given", () => {
    it("bounds OccurredAt at both ends so the month partitions prune", async () => {
      const { repository, queries } = repositoryOver([{ CostNanoUSD: 0 }]);

      await repository.sumCostNanoUsdByRequestType({
        tenantIds: ["project-1"],
        requestType: "instant_eval",
        fromMs: 1,
        toMs: 2,
      });

      expect(queries[0]!.query).toContain(
        "AND OccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64})",
      );
      expect(queries[0]!.query).toContain(
        "AND OccurredAt < fromUnixTimestamp64Milli({toMs:Int64})",
      );
      expect(queries[0]!.query_params).toMatchObject({ fromMs: 1, toMs: 2 });
    });
  });

  describe("when no tenant is named, or the ledger answers no row", () => {
    it("answers zero without reading anything it cannot scope", async () => {
      const { repository, queries } = repositoryOver([]);

      expect(
        await repository.sumCostNanoUsdByRequestType({
          tenantIds: [],
          requestType: "instant_eval",
        }),
      ).toBe(0);
      expect(queries).toHaveLength(0);
      expect(
        await repository.sumCostNanoUsdByRequestType({
          tenantIds: ["project-1"],
          requestType: "instant_eval",
        }),
      ).toBe(0);
    });
  });
});
