import { describe, expect, it } from "vitest";
import { SuiteAnalyticsRollupMapProjection } from "../suiteAnalyticsRollup.mapProjection";
import type { SuiteRunItemCompletedEvent } from "../../schemas/events";

const TENANT = "proj-suite-rollup";

function makeItemCompleted({
  status,
  verdict,
  durationMs,
}: {
  status: string;
  verdict?: string;
  durationMs?: number;
}): SuiteRunItemCompletedEvent {
  return {
    type: "lw.suite_run.item_completed",
    id: `evt-ic-${Math.random()}`,
    tenantId: TENANT,
    aggregateId: "suite-run-x",
    occurredAt: 60_000 * 12,
    data: {
      batchRunId: "batch-rollup",
      scenarioRunId: "scn-run-1",
      scenarioId: "scn-1",
      status,
      verdict,
      durationMs,
    },
  } as unknown as SuiteRunItemCompletedEvent;
}

describe("SuiteAnalyticsRollupMapProjection", () => {
  const proj = new SuiteAnalyticsRollupMapProjection({
    store: { append: async () => {} },
  });

  describe("given an item with verdict success", () => {
    it("emits successCount=1 / itemCount=1 / verdict 'success'", () => {
      const row = proj.mapSuiteRunItemCompleted(
        makeItemCompleted({ status: "SUCCESS", verdict: "success", durationMs: 250 }),
      );
      expect(row.tenantId).toBe(TENANT);
      expect(row.batchRunId).toBe("batch-rollup");
      expect(row.verdict).toBe("success");
      expect(row.itemCount).toBe(1);
      expect(row.successCount).toBe(1);
      expect(row.failureCount).toBe(0);
      expect(row.errorCount).toBe(0);
      expect(row.durationSum).toBe(250);
      expect(row.bucketStart.getTime() % 60_000).toBe(0);
    });
  });

  describe("given an item with status ERROR", () => {
    it("emits errorCount=1", () => {
      const row = proj.mapSuiteRunItemCompleted(
        makeItemCompleted({ status: "ERROR" }),
      );
      expect(row.errorCount).toBe(1);
      expect(row.verdict).toBe("");
    });
  });

  describe("given an item with verdict 'inconclusive'", () => {
    it("emits inconclusiveCount=1", () => {
      const row = proj.mapSuiteRunItemCompleted(
        makeItemCompleted({ status: "SUCCESS", verdict: "inconclusive" }),
      );
      expect(row.inconclusiveCount).toBe(1);
      expect(row.successCount).toBe(0);
    });
  });
});
