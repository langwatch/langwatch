/**
 * The spend reads span every project of one organisation. Each runs through the real tenant guard
 * here, so a statement the guard would refuse on a live stack fails this test.
 */
import { TenantGuard } from "@langwatch/clickhouse-client";
import { describe, expect, it } from "vitest";

import type { GatewayClickHouseClient } from "../clickhouse.gateway-session.store.ts";
import { ClickHouseGatewaySpendEventsRepository } from "../clickhouse.gateway-spend-events.repository.ts";

const PROJECTS = ["project-a", "project-b"];

type Statement = Parameters<GatewayClickHouseClient["query"]>[0];

function guardedRepository() {
  const guard = new TenantGuard();
  const statements: Statement[] = [];
  const repository = ClickHouseGatewaySpendEventsRepository.create(async (tenantId) => ({
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

describe("ClickHouseGatewaySpendEventsRepository across an organisation's projects", () => {
  describe("when the organisation has two projects", () => {
    it("reads events, summaries, end-user spend, request-type sums and days as guarded tenant-set statements", async () => {
      const { repository, statements } = guardedRepository();

      await repository.walkSpendEvents({ tenantIds: PROJECTS, limit: 10 });
      await repository.readSpendSummaries({
        tenantIds: PROJECTS,
        groupBy: ["model"],
        fromMs: 0,
        toMs: 1,
      });
      await repository.readEndUserSpend({
        tenantIds: PROJECTS,
        endUserId: "end-user-1",
        fromMs: 0,
        toMs: 1,
      });
      await repository.sumCostNanoUsdByRequestType({
        tenantIds: PROJECTS,
        requestType: "instant_eval",
      });
      await repository.sumDaysForOrganizationProjects({
        tenantIds: PROJECTS,
        fromDay: "2026-09-01",
        toDay: "2026-09-02",
      });

      expect(statements).toHaveLength(5);
      for (const statement of statements) {
        expect(statement.tenantIds).toEqual(PROJECTS);
        expect(statement.query).toContain("TenantId IN (");
        expect(statement.unscoped).toBeUndefined();
      }
    });
  });
});
