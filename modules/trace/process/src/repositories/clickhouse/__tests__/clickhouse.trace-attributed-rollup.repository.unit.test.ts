// Spec: modules/trace/specs/trace-cross-owner-reads.feature. The rollups' guards, without a store.
import {
  ClickHouseQueryClient,
  type QueryDriver,
  type QueryRequest,
  TenantGuard,
} from "@langwatch/clickhouse-client";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it } from "vitest";

import { ClickHouseTraceAttributedRollupRepository } from "../clickhouse.trace-attributed-rollup.repository.ts";

type ReadRequest = Parameters<ClickHouseQueryClient["read"]>[0];

class RecordingDriver implements QueryDriver {
  readonly requests: QueryRequest[] = [];

  constructor(private readonly failure?: Error) {}

  async execute<Row>(request: QueryRequest): Promise<{ rows: Row[] }> {
    this.requests.push(request);
    if (this.failure) throw this.failure;
    return { rows: [] };
  }

  insert(): Promise<never> {
    return Promise.reject(new Error("the attributed rollups never insert"));
  }

  command(): Promise<never> {
    return Promise.reject(new Error("the attributed rollups never command"));
  }
}

function repositoryOver(driver: RecordingDriver) {
  return ClickHouseTraceAttributedRollupRepository.create(
    new ClickHouseQueryClient({ tenantGuard: new TenantGuard(), driver }),
  );
}

describe("ClickHouseTraceAttributedRollupRepository guards", () => {
  describe("when spend per project is asked for no projects", () => {
    /** @scenario "A read with no projects never reaches ClickHouse" */
    it("answers empty and issues no statement", async () => {
      const driver = new RecordingDriver();
      const answer = await repositoryOver(driver).findSpendByProjectAndValue({
        tenantIds: [],
        valueKey: "langwatch.user_id",
        window: { startMs: 0, endMs: 1 },
      });
      expect(answer).toEqual([]);
      expect(driver.requests).toHaveLength(0);
    });
  });

  describe("when the store refuses the statement", () => {
    /** @scenario "A store failure reaches the caller instead of an empty answer" */
    it("rejects with the store's error", async () => {
      const failure = Object.assign(new Error("Code: 159. Timeout exceeded"), { code: "159" });
      const driver = new RecordingDriver(failure);
      await expect(
        repositoryOver(driver).getAttributedSpendComparison({
          tenantId: "project-1",
          matches: [{ key: "langwatch.origin.kind", value: "ingestion_source" }],
          actorKey: "langwatch.user_id",
          previousStartMs: 0,
          currentStartMs: 1,
          endMs: 2,
        }),
      ).rejects.toMatchObject({ code: "159" });
      expect(driver.requests[0]?.sql).toMatch(/SETTINGS max_threads = 2, max_execution_time = 45$/);
    });
  });

  describe("when each rollup builds its statement", () => {
    it("reads one tenant on the reader identity, and the project read its declared set", async () => {
      const statements: ReadRequest["statement"][] = [];
      const repository = ClickHouseTraceAttributedRollupRepository.create(
        clickHouseQueryClientDouble({
          async read({ statement }: ReadRequest) {
            statements.push(statement);
            return { rows: [] };
          },
        }),
      );
      const tenantId = "project-1";
      const matches = [{ key: "langwatch.origin.kind", value: "ingestion_source" }];
      const window = { startMs: 1, endMs: 3 };
      const comparison = { previousStartMs: 1, currentStartMs: 2, endMs: 3 };
      await repository.getAttributedSpendComparison({
        tenantId,
        matches,
        actorKey: "u",
        ...comparison,
      });
      await repository.findAttributedSpendByValue({
        tenantId,
        matches,
        valueKey: "u",
        window,
        sortBy: "spend",
        sortDirection: "desc",
        limit: 5,
        offset: 0,
      });
      await repository.findAttributedSpendComparisonByValue({
        tenantId,
        matches,
        valueKey: "s",
        ...comparison,
      });
      await repository.findDailyAttributedSpend({
        tenantId,
        matches,
        groupBy: { kind: "firstModel" },
        window,
      });
      await repository.countAttributedTracesByValue({
        tenantId,
        matches,
        valueKey: "s",
        values: ["a"],
        sinceMs: 1,
      });
      await repository.findAttributedTracesBefore({
        tenantId,
        matches,
        attributeKeys: ["k"],
        beforeMs: 9,
        limit: 3,
      });
      await repository.getAttributedTraceRecency({ tenantId, matches, countSinceMs: [5, 7] });
      await repository.findSpendByProjectAndValue({
        tenantIds: ["project-1", "project-2"],
        valueKey: "u",
        window,
      });

      const single = statements.slice(0, -1);
      expect(single).toHaveLength(8);
      for (const statement of single) {
        expect(statement).toMatchObject({ identity: "reader", tenantId, tenantIds: undefined });
        expect(statement.settings).toMatchObject({ SQL_langwatch_tenant_ids: tenantId });
        expect(statement.sql).toContain("WHERE TenantId = {tenantId:String}");
      }
      expect(statements.at(-1)).toMatchObject({
        identity: "reader",
        tenantIds: ["project-1", "project-2"],
      });
      expect(statements.at(-1)?.settings).toMatchObject({
        SQL_langwatch_tenant_ids: "project-1,project-2",
      });
    });
  });
});
