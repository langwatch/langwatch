/**
 * The lifetime read one request type's allowance is judged against: TenantId
 * filtered first, confirmed rows only, and the partition column bounded when
 * a window is given. @see modules/instant-eval/specs/instant-eval-billing.feature
 */
import type { ReaderReadStatement } from "@langwatch/clickhouse-client/builder";
import { describe, expect, it } from "vitest";

import type { GatewayClickHouseClient } from "../clickhouse.gateway-session.store.ts";
import { ClickHouseGatewaySpendEventsRepository } from "../clickhouse.gateway-spend-events.repository.ts";

function repositoryOver(rows: Record<string, unknown>[] = []) {
  const statements: ReaderReadStatement[] = [];
  const resolvedFor: string[] = [];
  const client: GatewayClickHouseClient = {
    read: async ({ statement }) => {
      statements.push(statement as ReaderReadStatement);
      return { rows: rows as never[] };
    },
    insert: async () => undefined,
  };

  return {
    statements,
    resolvedFor,
    repository: ClickHouseGatewaySpendEventsRepository.create(async (tenantId: string) => {
      resolvedFor.push(tenantId);
      return client;
    }),
  };
}

describe("given a ledger holding confirmed judgement rows", () => {
  describe("when the whole ledger is summed for one request type", () => {
    it("filters TenantId first, takes confirmed rows only, and bounds no window", async () => {
      const { repository, statements, resolvedFor } = repositoryOver([
        { SumCostNanoUSD: "1500000000" },
      ]);

      const total = await repository.sumCostNanoUsdByRequestType({
        tenantIds: ["project-1", "project-2"],
        requestType: "instant_eval",
      });

      const statement = statements[0]!;
      const { sql } = statement;
      expect(sql.indexOf("WHERE TenantId IN")).toBeGreaterThan(-1);
      expect(sql.indexOf("TenantId")).toBeLessThan(sql.indexOf("RequestType"));
      expect(sql).toContain("FROM gateway_spend FINAL");
      expect(sql).toMatch(/Status = \{v\d+:String\}/);
      expect(sql).not.toContain("OccurredAt");
      expect(Object.values(statement.params)).toEqual(
        expect.arrayContaining(["instant_eval", "confirmed"]),
      );
      expect(statement.tenantIds).toEqual(["project-1", "project-2"]);
      expect(statement.settings).toMatchObject({ SQL_langwatch_tenant_ids: "project-1,project-2" });
      expect(resolvedFor).toEqual(["project-1"]);
      expect(total).toBe(1_500_000_000);
    });
  });

  describe("when a window is given", () => {
    it("bounds OccurredAt at both ends so the month partitions prune", async () => {
      const { repository, statements } = repositoryOver([{ SumCostNanoUSD: 0 }]);

      await repository.sumCostNanoUsdByRequestType({
        tenantIds: ["project-1"],
        requestType: "instant_eval",
        fromMs: 1,
        toMs: 2,
      });

      expect(statements[0]!.sql).toMatch(
        /OccurredAt >= fromUnixTimestamp64Milli\(\{v\d+:Int64\}\) AND OccurredAt < fromUnixTimestamp64Milli\(\{v\d+:Int64\}\)/,
      );
      expect(Object.values(statements[0]!.params)).toEqual(expect.arrayContaining([1, 2]));
    });
  });

  describe("when no tenant is named, or the ledger answers no row", () => {
    it("answers zero without reading anything it cannot scope", async () => {
      const { repository, statements } = repositoryOver([]);

      expect(
        await repository.sumCostNanoUsdByRequestType({
          tenantIds: [],
          requestType: "instant_eval",
        }),
      ).toBe(0);
      expect(statements).toHaveLength(0);
      expect(
        await repository.sumCostNanoUsdByRequestType({
          tenantIds: ["project-1"],
          requestType: "instant_eval",
        }),
      ).toBe(0);
    });
  });
});
