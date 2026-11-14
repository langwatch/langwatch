/**
 * Main's governance metered-lane read, now served by the ledger's owner
 * (`governanceGatewaySpend.clickhouse.repository.ts`).
 */
import type { ReaderReadStatement } from "@langwatch/clickhouse-client/builder";
import { describe, expect, it } from "vitest";

import type { GatewayClickHouseClient } from "../clickhouse.gateway-session.store.ts";
import { ClickHouseGatewaySpendEventsRepository } from "../clickhouse.gateway-spend-events.repository.ts";

function repositoryOver(rows: readonly Record<string, unknown>[]) {
  const queries: ReaderReadStatement[] = [];
  const resolvedFor: string[] = [];
  const client: GatewayClickHouseClient = {
    read: async ({ statement }) => {
      queries.push(statement as ReaderReadStatement);
      return { rows: JSON.parse(JSON.stringify(rows)) };
    },
    query: () => Promise.reject(new Error("spend reads are built statements")),
    insert: async () => undefined,
  };
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

      const sql = queries[0]?.sql ?? "";
      expect(sql).toContain("FROM gateway_spend WHERE TenantId IN ({tenantIds:Array(String)})");
      expect(sql).toContain("argMax(Status, EventTimestamp)");
      expect(sql).toContain("GROUP BY TenantId, GatewayRequestId HAVING");
      expect(sql).toContain("GROUP BY toDate(toStartOfDay(RequestOccurredAt, {v0:String}))");
      expect(sql).toContain("ORDER BY Day ASC SETTINGS max_execution_time = 20");
      expect(queries[0]?.settings).toMatchObject({
        SQL_langwatch_tenant_ids: "project-1,project-2",
      });
      expect(queries[0]?.params).toMatchObject({
        v0: "UTC",
        tenantIds: ["project-1", "project-2"],
      });
      expect(Object.values(queries[0]?.params ?? {})).toEqual(
        expect.arrayContaining([Date.UTC(2026, 8, 1), Date.UTC(2026, 8, 3)]),
      );
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
