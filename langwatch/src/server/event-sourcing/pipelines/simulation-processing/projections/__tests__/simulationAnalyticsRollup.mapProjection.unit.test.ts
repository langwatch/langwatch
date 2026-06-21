import { describe, expect, it } from "vitest";
import { SimulationAnalyticsRollupMapProjection } from "../simulationAnalyticsRollup.mapProjection";
import type { SimulationRunFinishedEvent } from "../../schemas/events";

const TENANT = "proj-sim-rollup";

function makeFinished({
  verdict,
  status,
  durationMs,
  occurredAt = 60_000 * 12,
}: {
  verdict?: string;
  status?: string;
  durationMs?: number;
  occurredAt?: number;
}): SimulationRunFinishedEvent {
  return {
    type: "lw.simulation_run.finished",
    id: "evt-f",
    tenantId: TENANT,
    aggregateId: "run-x",
    occurredAt,
    data: {
      scenarioRunId: "run-x",
      durationMs,
      status,
      results: verdict ? { verdict } : undefined,
    },
  } as unknown as SimulationRunFinishedEvent;
}

describe("SimulationAnalyticsRollupMapProjection", () => {
  const proj = new SimulationAnalyticsRollupMapProjection({
    store: { append: async () => {} },
  });

  describe("given a finished success event", () => {
    it("emits a row with runCount=1 / successCount=1 / status SUCCESS", () => {
      const row = proj.mapSimulationRunFinished(
        makeFinished({ verdict: "success", durationMs: 1500 }),
      );
      expect(row.tenantId).toBe(TENANT);
      expect(row.verdict).toBe("success");
      expect(row.status).toBe("SUCCESS");
      expect(row.runCount).toBe(1);
      expect(row.successCount).toBe(1);
      expect(row.failureCount).toBe(0);
      expect(row.inconclusiveCount).toBe(0);
      expect(row.errorCount).toBe(0);
      expect(row.durationSum).toBe(1500);
      expect(row.bucketStart.getTime() % 60_000).toBe(0);
    });
  });

  describe("given a finished failure event", () => {
    it("emits failureCount=1 / status FAILURE", () => {
      const row = proj.mapSimulationRunFinished(
        makeFinished({ verdict: "failure", durationMs: 500 }),
      );
      expect(row.failureCount).toBe(1);
      expect(row.successCount).toBe(0);
      expect(row.status).toBe("FAILURE");
    });
  });

  describe("given an explicit ERROR status", () => {
    it("emits errorCount=1", () => {
      const row = proj.mapSimulationRunFinished(
        makeFinished({ status: "ERROR" }),
      );
      expect(row.errorCount).toBe(1);
      expect(row.status).toBe("ERROR");
    });
  });

  describe("given a finished event with no verdict and no durationMs", () => {
    it("zeroes verdict counters and durationSum", () => {
      const row = proj.mapSimulationRunFinished(makeFinished({}));
      expect(row.verdict).toBe("");
      expect(row.successCount).toBe(0);
      expect(row.failureCount).toBe(0);
      expect(row.inconclusiveCount).toBe(0);
      expect(row.durationSum).toBe(0);
    });
  });
});
