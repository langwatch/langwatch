/**
 * Main's governance metered-lane read, now served by the ledger's owner
 * (`governanceGatewaySpend.clickhouse.repository.ts`).
 */
import { createApiFixture } from "@langwatch/api-fixture";
import { describe, expect, it } from "vitest";

import type { GatewayClickHouseClient } from "../../../app/gateway.members.ts";
import { ClickHouseGatewaySpendEventsRepository } from "../clickhouse.gateway-spend-events.repository.ts";

type SentQuery = Parameters<GatewayClickHouseClient["query"]>[0];

function repositoryOver(rows: readonly Record<string, unknown>[]) {
  const queries: SentQuery[] = [];
  const resolvedFor: string[] = [];
  const client = createApiFixture<GatewayClickHouseClient>({
    query: async (input) => {
      queries.push(input);
      return { json: <T>(): Promise<T[]> => Promise.resolve(JSON.parse(JSON.stringify(rows))) };
    },
  });
  const repository = ClickHouseGatewaySpendEventsRepository.create(async (tenantId) => {
    resolvedFor.push(tenantId);
    return client;
  });
  return { repository, queries, resolvedFor };
}

describe("the metered lane per day across an organization's projects", () => {
  describe("given charged requests on two days", () => {
    it("filters TenantId first, collapses each request to its latest status, and sums per UTC day", async () => {
      const { repository, queries, resolvedFor } = repositoryOver([
        {
          Day: "2026-09-01",
          AmountNanoUsd: "1500000000",
          RequestCount: "3",
          PricedRequestCount: "2",
          RequestsWithoutAmount: "1",
        },
      ]);

      const days = await repository.sumDaysForOrganizationProjects({
        tenantIds: ["project-1", "project-2"],
        fromDay: "2026-09-01",
        toDay: "2026-09-02",
      });

      const sql = queries[0]?.query ?? "";
      expect(sql).toContain("WHERE TenantId IN {tenantIds:Array(String)}");
      expect(sql).toContain("argMax(Status, EventTimestamp)");
      expect(sql).toContain("GROUP BY Day");
      expect(queries[0]?.query_params).toEqual({
        tenantIds: ["project-1", "project-2"],
        fromMs: Date.UTC(2026, 8, 1),
        toMs: Date.UTC(2026, 8, 3),
      });
      expect(resolvedFor).toEqual(["project-1"]);
      expect(days).toEqual([
        {
          day: "2026-09-01",
          amountNanoUsd: 1_500_000_000,
          requestCount: 3,
          pricedRequestCount: 2,
          requestsWithoutAmount: 1,
        },
      ]);
    });
  });

  describe("given no project", () => {
    it("answers no days without asking the store", async () => {
      const { repository, queries } = repositoryOver([]);

      await expect(
        repository.sumDaysForOrganizationProjects({
          tenantIds: [],
          fromDay: "2026-09-01",
          toDay: "2026-09-02",
        }),
      ).resolves.toEqual([]);
      expect(queries).toEqual([]);
    });
  });
});
