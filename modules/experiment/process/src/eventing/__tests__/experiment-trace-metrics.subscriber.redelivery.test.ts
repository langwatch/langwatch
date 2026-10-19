/**
 * @vitest-environment node
 * A redelivered settled experiment trace records the same run metrics, so the run cannot
 * double-count its cost.
 * Spec: modules/experiment/specs/experiment-run-processing-composition.feature.
 */
import type { ComputeExperimentRunMetricsCommandData } from "@langwatch/experiment-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceSummaryData } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { createExperimentTraceMetricsSyncHandler } from "../experiment-trace-metrics.subscriber.ts";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

describe("given a settled experiment trace", () => {
  describe("when the same span event is handled twice", () => {
    it("records one run, trace and cost identity across both deliveries", async () => {
      const computeRunMetrics = vi
        .fn<(data: ComputeExperimentRunMetricsCommandData) => Promise<void>>()
        .mockResolvedValue(undefined);
      const handle = createExperimentTraceMetricsSyncHandler({
        findSummary: async () =>
          createApiFixture<TraceSummaryData>({
            traceId: "trace-1",
            totalCost: 0.25,
            attributes: { "evaluation.run_id": "run-1" },
          }),
        findExperimentId: async () => "experiment-1",
        computeRunMetrics,
      });

      await handle({ tenantId: "project-1", traceId: "trace-1" });
      await handle({ tenantId: "project-1", traceId: "trace-1" });

      const [first, second] = computeRunMetrics.mock.calls.map(([data]) => data);
      expect({ ...first, occurredAt: 0 }).toEqual({ ...second, occurredAt: 0 });
      expect(first).toMatchObject({
        experimentId: "experiment-1",
        runId: "run-1",
        totalCost: 0.25,
      });
    });
  });
});
