/**
 * @vitest-environment node
 * @unit
 * Scenario's peer reaction to a settled trace: reads trace's fold, sends its own computeRunMetrics.
 */
import type { ComputeRunMetricsCommandData } from "@langwatch/scenario-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceSummaryData } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import {
  TRACE_SPAN_METRICS_SETTLE_MS,
  createTraceSpanMetricsSyncHandler,
  hasSimulationMetrics,
} from "../trace-metrics-sync.subscriber.ts";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const SETTLED = { tenantId: "project-1", traceId: "trace-1", occurredAt: 1_234 };

function summary(overrides: Partial<TraceSummaryData> = {}): TraceSummaryData {
  return createApiFixture<TraceSummaryData>({
    spanCount: 2,
    totalCost: 0.001,
    attributes: { "scenario.run_id": "run-1" },
    ...overrides,
  });
}

function setup(found: TraceSummaryData | null) {
  const findSummary = vi.fn().mockResolvedValue(found);
  const computeRunMetrics = vi
    .fn<(data: ComputeRunMetricsCommandData) => Promise<void>>()
    .mockResolvedValue(undefined);
  return {
    findSummary,
    computeRunMetrics,
    handle: createTraceSpanMetricsSyncHandler({ findSummary, computeRunMetrics }),
  };
}

describe("the trace settle window", () => {
  it("is main's 60 seconds", () => {
    expect(TRACE_SPAN_METRICS_SETTLE_MS).toBe(60_000);
  });
});

describe("traceSpanMetricsSync handler", () => {
  describe("when the settled trace carries a scenario run id", () => {
    /**
     * @scenario "Scenario's subscriber publishes metrics after the trace settles"
     * @scenario "Scenario and Experiment metrics are published from the worker"
     */
    it("reads trace's summary, then sends computeRunMetrics in pull mode at the span's time", async () => {
      const { handle, findSummary, computeRunMetrics } = setup(summary());

      await handle(SETTLED);

      expect(findSummary).toHaveBeenCalledWith({ projectId: "project-1", traceId: "trace-1" });
      expect(computeRunMetrics).toHaveBeenCalledExactlyOnceWith({
        tenantId: "project-1",
        scenarioRunId: "run-1",
        traceId: "trace-1",
        retryCount: 0,
        occurredAt: 1_234,
      });
    });

    it("sends when the cost is zero but the trace has spans", async () => {
      const { handle, computeRunMetrics } = setup(summary({ totalCost: 0 }));

      await handle(SETTLED);

      expect(computeRunMetrics).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the settled trace is not a scenario trace", () => {
    /** @scenario "Scenario's subscriber ignores non-scenario traces" */
    it("sends nothing", async () => {
      const { handle, findSummary, computeRunMetrics } = setup(
        summary({ attributes: { "langwatch.origin": "sdk" } }),
      );

      await handle(SETTLED);

      expect(findSummary).toHaveBeenCalledTimes(1);
      expect(computeRunMetrics).not.toHaveBeenCalled();
    });
  });

  describe("when trace has no summary for the trace yet", () => {
    it("sends nothing", async () => {
      const { handle, computeRunMetrics } = setup(null);

      await handle(SETTLED);

      expect(computeRunMetrics).not.toHaveBeenCalled();
    });
  });

  describe("when the trace has no spans and no cost", () => {
    it("sends nothing", async () => {
      const { handle, computeRunMetrics } = setup(summary({ spanCount: 0, totalCost: null }));

      await handle(SETTLED);

      expect(computeRunMetrics).not.toHaveBeenCalled();
    });
  });

  describe("when computeRunMetrics fails", () => {
    it("throws, so the queue retries the settled trace", async () => {
      const { handle, computeRunMetrics } = setup(summary());
      computeRunMetrics.mockRejectedValue(new Error("Dispatch error"));

      await expect(handle(SETTLED)).rejects.toThrow("Dispatch error");
    });
  });

  describe("when trace's summary cannot be read", () => {
    it("throws, so the queue retries the settled trace", async () => {
      const { handle, findSummary, computeRunMetrics } = setup(null);
      findSummary.mockRejectedValue(new Error("read failed"));

      await expect(handle(SETTLED)).rejects.toThrow("read failed");
      expect(computeRunMetrics).not.toHaveBeenCalled();
    });
  });
});

describe("hasSimulationMetrics", () => {
  it("is true for a scenario trace with data to aggregate", () => {
    expect(hasSimulationMetrics(summary())).toBe(true);
  });

  it("is false without a scenario run id", () => {
    expect(hasSimulationMetrics(summary({ attributes: { "langwatch.origin": "sdk" } }))).toBe(
      false,
    );
  });

  it("is false for no spans and no cost", () => {
    expect(hasSimulationMetrics(summary({ spanCount: 0, totalCost: null }))).toBe(false);
  });
});
