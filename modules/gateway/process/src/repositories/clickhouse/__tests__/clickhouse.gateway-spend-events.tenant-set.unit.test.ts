/**
 * The spend reads span every project of one organisation. Each is a built statement on the reader
 * identity whose tenant setting is exactly that set, so the row policy admits nothing wider.
 */
import type { ReaderReadStatement } from "@langwatch/clickhouse-client/builder";
import { describe, expect, it } from "vitest";

import type { GatewayClickHouseClient } from "../clickhouse.gateway-session.store.ts";
import { ClickHouseGatewaySpendEventsRepository } from "../clickhouse.gateway-spend-events.repository.ts";

const PROJECTS = ["project-a", "project-b"];

function setRepository() {
  const statements: ReaderReadStatement[] = [];
  const resolvedFor: string[] = [];
  const client: GatewayClickHouseClient = {
    read: async ({ statement }) => {
      statements.push(statement as ReaderReadStatement);
      return { rows: [] };
    },
    insert: async () => undefined,
  };
  const repository = ClickHouseGatewaySpendEventsRepository.create(async (tenantId) => {
    resolvedFor.push(tenantId);
    return client;
  });
  return { repository, statements, resolvedFor };
}

describe("ClickHouseGatewaySpendEventsRepository across an organisation's projects", () => {
  describe("when the organisation has two projects", () => {
    it("reads events, summaries, end-user spend, request-type sums and metered rollups under the project set", async () => {
      const { repository, statements, resolvedFor } = setRepository();
      const window = { tenantIds: PROJECTS, fromDay: "2026-09-01", toDay: "2026-09-02" };

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
      await repository.sumDaysForOrganizationProjects(window);
      await repository.sumWindowByModel(window);
      await repository.sumWindowByVirtualKey(window);

      expect(statements).toHaveLength(7);
      for (const statement of statements) {
        expect(statement).toMatchObject({
          identity: "reader",
          kind: "tenant",
          tenantId: "project-a",
          tenantIds: PROJECTS,
        });
        expect(statement.settings).toMatchObject({
          SQL_langwatch_tenant_ids: "project-a,project-b",
        });
        expect(statement.sql).toContain("WHERE TenantId IN ({tenantIds:Array(String)})");
        expect(statement.params).toMatchObject({ tenantIds: PROJECTS });
      }
      expect(new Set(resolvedFor)).toEqual(new Set(["project-a"]));
    });
  });

  describe("when the organisation has no project", () => {
    it("answers empty without building a statement it cannot scope", async () => {
      const { repository, statements } = setRepository();
      const window = { tenantIds: [], fromDay: "2026-09-01", toDay: "2026-09-02" };

      await expect(repository.walkSpendEvents({ tenantIds: [], limit: 10 })).resolves.toEqual({
        rows: [],
        nextCursor: null,
      });
      await expect(repository.sumWindowByModel(window)).resolves.toEqual([]);
      await expect(repository.sumWindowByVirtualKey(window)).resolves.toEqual([]);
      expect(statements).toEqual([]);
    });
  });
});
