/**
 * The batch denominator (ADR-061).
 *
 * A batch's expected size travels on each of its simulation runs, so a batch
 * whose fan-out fell short reports the shortfall instead of silently
 * redefining itself as however many runs made it to the queue.
 *
 * @see specs/suites/suite-run-aggregates.feature
 * @see dev/docs/adr/061-run-aggregates-are-queries.md
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { describe, expect, it, vi } from "vitest";
import { SimulationClickHouseRepository } from "../simulation.clickhouse.repository";

/** A step-1 batch aggregate row, with only the fields these tests vary. */
function batchRow(overrides: { TotalCount: string; ExpectedCount: string }) {
  return {
    BatchRunId: "batch-1",
    PassCount: "0",
    FailCount: "0",
    RunningCount: "0",
    LastUpdatedAt: "1000",
    LastRunAt: "1000",
    FirstCompletedAt: "0",
    AllCompletedAt: "0",
    MinStartedAt: "1000",
    MaxStartedAt: "1000",
    ...overrides,
  };
}

/**
 * getBatchHistoryForScenarioSet issues three reads: a distinct-batch count, the
 * batch aggregates, then the per-run preview. Only the aggregates carry the
 * denominator, so route by the column each query selects.
 */
function repositoryReturning(row: Record<string, string>) {
  const client = {
    query: vi.fn().mockImplementation(({ query }: { query: string }) => {
      const rows = query.includes("ExpectedCount")
        ? [row]
        : query.includes("TotalBatchCount")
          ? [{ TotalBatchCount: "1" }]
          : [];
      return Promise.resolve({ json: () => Promise.resolve(rows) });
    }),
  } as unknown as ClickHouseClient;
  return new SimulationClickHouseRepository(vi.fn().mockResolvedValue(client));
}

async function firstBatch(row: Record<string, string>) {
  const result = await repositoryReturning(row).getBatchHistoryForScenarioSet({
    projectId: "project-1",
    scenarioSetId: "set-1",
  });
  return result.batches[0]!;
}

describe("batch history expected count", () => {
  describe("given every run in the batch reached the queue", () => {
    it("reports the same expected and actual count", async () => {
      const batch = await firstBatch(
        batchRow({ TotalCount: "6", ExpectedCount: "6" }),
      );

      expect(batch.totalCount).toBe(6);
      expect(batch.expectedCount).toBe(6);
    });
  });

  describe("given part of the fan-out never reached the queue", () => {
    it("reports more expected than were run", async () => {
      const batch = await firstBatch(
        batchRow({ TotalCount: "5", ExpectedCount: "6" }),
      );

      expect(batch.totalCount).toBe(5);
      expect(batch.expectedCount).toBe(6);
    });
  });

  describe("given a batch queued before the denominator was recorded", () => {
    it("falls back to counting the runs rather than reporting zero", async () => {
      const batch = await firstBatch(
        batchRow({ TotalCount: "4", ExpectedCount: "0" }),
      );

      expect(batch.expectedCount).toBe(4);
    });
  });

  describe("given more runs exist than the batch expected", () => {
    it("never reports fewer expected than actually ran", async () => {
      const batch = await firstBatch(
        batchRow({ TotalCount: "7", ExpectedCount: "6" }),
      );

      expect(batch.expectedCount).toBe(7);
    });
  });
});
