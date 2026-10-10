/**
 * @vitest-environment node
 * @unit
 * Experiment's reaction to a settled experiment trace: reads trace's fold, records its metrics.
 * Spec: modules/experiment/specs/experiment-run-processing-composition.feature.
 */
import type { ComputeExperimentRunMetricsCommandData } from "@langwatch/experiment-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceSummaryData } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import {
  EXPERIMENT_TRACE_METRICS_SETTLE_MS,
  carriesExperimentRunMarker,
  createExperimentTraceMetricsSyncHandler,
  experimentTraceSpanSchema,
} from "../experiment-trace-metrics.subscriber.ts";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const SETTLED = { tenantId: "project-1", traceId: "trace-1" };

function summary(overrides: Partial<TraceSummaryData> = {}): TraceSummaryData {
  return createApiFixture<TraceSummaryData>({
    traceId: "trace-1",
    totalCost: 0.25,
    attributes: { "evaluation.run_id": "run-1" },
    ...overrides,
  });
}

function setup({
  found = summary(),
  experimentId = "experiment-1",
  computeRunMetrics = async () => undefined,
}: {
  found?: TraceSummaryData | null;
  experimentId?: string | null;
  computeRunMetrics?: (data: ComputeExperimentRunMetricsCommandData) => Promise<void>;
} = {}) {
  const findSummary = vi.fn().mockResolvedValue(found);
  const findExperimentId = vi.fn().mockResolvedValue(experimentId);
  const compute = vi.fn(computeRunMetrics);
  return {
    findSummary,
    findExperimentId,
    computeRunMetrics: compute,
    handle: createExperimentTraceMetricsSyncHandler({
      findSummary,
      findExperimentId,
      computeRunMetrics: compute,
    }),
  };
}

function spanWith(attributes: { key: string; value: { stringValue?: string } }[]) {
  return experimentTraceSpanSchema.parse({ span: { attributes } });
}

describe("the experiment trace settle window", () => {
  it("is main's 60 seconds", () => {
    expect(EXPERIMENT_TRACE_METRICS_SETTLE_MS).toBe(60_000);
  });
});

describe("the experiment run marker filter", () => {
  describe("when a span carries evaluation.run_id", () => {
    /** @scenario "Experiment reacts only to spans that carry a run id" */
    it("admits the span", () => {
      expect(
        carriesExperimentRunMarker(
          spanWith([{ key: "evaluation.run_id", value: { stringValue: "run-1" } }]),
        ),
      ).toBe(true);
    });
  });

  describe("when a span carries no run id", () => {
    /**
     * @scenario "Experiment reacts only to spans that carry a run id"
     * @scenario Subscriber does not fire for traces without evaluation.run_id
     */
    it("declines the span, so no job or read follows", () => {
      expect(carriesExperimentRunMarker(spanWith([]))).toBe(false);
      expect(
        carriesExperimentRunMarker(
          spanWith([{ key: "evaluation.run_id", value: { stringValue: "" } }]),
        ),
      ).toBe(false);
    });
  });
});

describe("traceSpanMetricsSync handler", () => {
  describe("when the settled trace carries a recorded run and cost", () => {
    /**
     * @scenario Trace metrics are published to experiment pipeline after stabilisation
     * @scenario "Scenario and Experiment metrics are published from the worker"
     */
    it("reads trace's fold and records the cost on the run", async () => {
      const { handle, findSummary, findExperimentId, computeRunMetrics } = setup();

      await handle(SETTLED);

      expect(findSummary).toHaveBeenCalledWith({ projectId: "project-1", traceId: "trace-1" });
      expect(findExperimentId).toHaveBeenCalledWith({ tenantId: "project-1", runId: "run-1" });
      expect(computeRunMetrics).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "project-1",
          experimentId: "experiment-1",
          runId: "run-1",
          traceId: "trace-1",
          totalCost: 0.25,
        }),
      );
    });
  });

  describe("when the folded trace has no run id", () => {
    /** @scenario Subscriber does not fire for traces without evaluation.run_id */
    it("records nothing", async () => {
      const { handle, findExperimentId, computeRunMetrics } = setup({
        found: summary({ attributes: {} }),
      });

      await handle(SETTLED);

      expect(findExperimentId).not.toHaveBeenCalled();
      expect(computeRunMetrics).not.toHaveBeenCalled();
    });
  });

  describe("when the trace has no cost data", () => {
    /** @scenario Subscriber does not fire when trace has no cost data */
    it.each([null, 0])("records nothing for a total cost of %s", async (totalCost) => {
      const { handle, computeRunMetrics } = setup({ found: summary({ totalCost }) });

      await handle(SETTLED);

      expect(computeRunMetrics).not.toHaveBeenCalled();
    });
  });

  describe("when trace has no fold for the trace", () => {
    it("records nothing", async () => {
      const { handle, computeRunMetrics } = setup({ found: null });

      await handle(SETTLED);

      expect(computeRunMetrics).not.toHaveBeenCalled();
    });
  });

  describe("when no experiment recorded the run", () => {
    /** @scenario "A settled trace whose run no experiment recorded folds no cost" */
    it("records nothing", async () => {
      const { handle, computeRunMetrics } = setup({ experimentId: null });

      await handle(SETTLED);

      expect(computeRunMetrics).not.toHaveBeenCalled();
    });
  });

  describe("when sending the run metrics fails", () => {
    /** @scenario "A failed run-metrics send is retried, not dropped" */
    it("throws so the queue redelivers the reaction", async () => {
      const failure = new Error("queue unavailable");
      const { handle } = setup({
        computeRunMetrics: async () => {
          throw failure;
        },
      });

      await expect(handle(SETTLED)).rejects.toBe(failure);
    });
  });
});
