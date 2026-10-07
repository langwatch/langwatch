// Spec: modules/trace/specs/trace-cross-owner-reads.feature. The rollups' guards, without a store.
import {
  ClickHouseQueryClient,
  type QueryDriver,
  type QueryRequest,
} from "@langwatch/clickhouse-client";
import { describe, expect, it } from "vitest";

import { ClickHouseTraceAttributedRollupRepository } from "../clickhouse.trace-attributed-rollup.repository.ts";

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
  return ClickHouseTraceAttributedRollupRepository.create(new ClickHouseQueryClient({ driver }));
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
      expect(driver.requests[0]?.settings).toEqual({ max_threads: 2, max_execution_time: 45 });
    });
  });
});
