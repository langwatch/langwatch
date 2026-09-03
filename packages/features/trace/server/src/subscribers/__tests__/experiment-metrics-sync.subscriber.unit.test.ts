import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it, vi } from "vitest";
import type { TraceSummaryData } from "@langwatch/trace-contract";
import {
  SPAN_RECEIVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_VERSION_LATEST,
} from "@langwatch/trace-contract";
import type { SpanReceivedEvent } from "@langwatch/trace-contract";
import {
  createExperimentMetricsSyncHandler,
  type ExperimentMetricsSyncSubscriberDeps,
  hasExperimentCostMetrics,
} from "../experiment-metrics-sync.subscriber";

const TEST_TENANT_ID = createTenantId("tenant-1");

function createDeps(): ExperimentMetricsSyncSubscriberDeps & {
  computeExperimentRunMetrics: ReturnType<typeof vi.fn>;
  lookupExperimentId: ReturnType<typeof vi.fn>;
} {
  return {
    computeExperimentRunMetrics: vi.fn().mockResolvedValue(undefined),
    lookupExperimentId: vi.fn().mockResolvedValue("exp-1"),
  };
}

function createTraceSummaryState(overrides: Partial<TraceSummaryData> = {}): TraceSummaryData {
  return {
    traceId: "trace-1",
    traceName: "",
    spanCount: 2,
    totalDurationMs: 500,
    computedIOSchemaVersion: "2025-12-18",
    computedInput: null,
    computedOutput: null,
    timeToFirstTokenMs: null,
    timeToLastTokenMs: null,
    tokensPerSecond: null,
    containsErrorStatus: false,
    containsOKStatus: true,
    errorMessage: null,
    models: ["gpt-5-mini"],
    totalCost: 0.003,
    nonBilledCost: null,
    tokensEstimated: false,
    totalPromptTokenCount: 100,
    totalCompletionTokenCount: 50,
    outputFromRootSpan: true,
    outputSpanEndTimeMs: 1000,
    blockedByGuardrail: false,
    rootSpanType: null,
    containsAi: false,
    topicId: null,
    subTopicId: null,
    annotationIds: [],
    containsPrompt: false,
    selectedPromptId: null,
    selectedPromptSpanId: null,
    selectedPromptStartTimeMs: null,
    lastUsedPromptId: null,
    lastUsedPromptVersionNumber: null,
    lastUsedPromptVersionId: null,
    lastUsedPromptSpanId: null,
    lastUsedPromptStartTimeMs: null,
    attributes: {},
    LastEventOccurredAt: 0,
    occurredAt: 1000,
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  };
}

function createSpanReceivedEvent(): SpanReceivedEvent {
  return {
    id: "event-1",
    aggregateId: "trace-1",
    aggregateType: "trace",
    tenantId: TEST_TENANT_ID,
    createdAt: 1000,
    occurredAt: 1000,
    type: SPAN_RECEIVED_EVENT_TYPE,
    version: SPAN_RECEIVED_EVENT_VERSION_LATEST,
    data: {
      span: {} as any,
      resource: null,
      instrumentationScope: null,
      piiRedactionLevel: "DISABLED",
    },
    metadata: {
      spanId: "span-1",
      traceId: "trace-1",
    },
  };
}

describe("experimentMetricsSync subscriber (trace-side ECST publisher)", () => {
  // The 60s window / dedup wiring lives on the pipeline registration now —
  // see subscriberWiring.unit.test.ts.

  describe("when trace has evaluation.run_id attribute", () => {
    /** @scenario Trace metrics are published to experiment pipeline after stabilisation */
    /** @scenario evaluation.run_id is hoisted to trace-level attributes */
    it("dispatches computeExperimentRunMetrics with cost payload", async () => {
      const deps = createDeps();
      const subscriber = createExperimentMetricsSyncHandler(deps);

      const state = createTraceSummaryState({
        attributes: { "evaluation.run_id": "run-1" },
        totalCost: 0.003,
      });

      await subscriber(createSpanReceivedEvent(), {
        tenantId: TEST_TENANT_ID,
        aggregateId: "trace-1",
        state,
      });

      expect(deps.lookupExperimentId).toHaveBeenCalledWith(TEST_TENANT_ID, "run-1");
      expect(deps.computeExperimentRunMetrics).toHaveBeenCalledWith({
        tenantId: TEST_TENANT_ID,
        experimentId: "exp-1",
        runId: "run-1",
        traceId: "trace-1",
        totalCost: 0.003,
        occurredAt: expect.any(Number),
      });
    });
  });

  describe("when trace has no evaluation.run_id attribute", () => {
    /** @scenario Subscriber does not fire for traces without evaluation.run_id */
    it("skips without dispatching", async () => {
      const deps = createDeps();
      const subscriber = createExperimentMetricsSyncHandler(deps);

      const state = createTraceSummaryState({
        attributes: { "langwatch.origin": "sdk" },
      });

      await subscriber(createSpanReceivedEvent(), {
        tenantId: TEST_TENANT_ID,
        aggregateId: "trace-1",
        state,
      });

      expect(deps.computeExperimentRunMetrics).not.toHaveBeenCalled();
    });
  });

  describe("when trace has no cost data", () => {
    /** @scenario Subscriber does not fire when trace has no cost data */
    it("skips without dispatching when totalCost is null", async () => {
      const deps = createDeps();
      const subscriber = createExperimentMetricsSyncHandler(deps);

      const state = createTraceSummaryState({
        attributes: { "evaluation.run_id": "run-1" },
        totalCost: null,
      });

      await subscriber(createSpanReceivedEvent(), {
        tenantId: TEST_TENANT_ID,
        aggregateId: "trace-1",
        state,
      });

      expect(deps.computeExperimentRunMetrics).not.toHaveBeenCalled();
    });

    it("skips without dispatching when totalCost is zero", async () => {
      const deps = createDeps();
      const subscriber = createExperimentMetricsSyncHandler(deps);

      const state = createTraceSummaryState({
        attributes: { "evaluation.run_id": "run-1" },
        totalCost: 0,
      });

      await subscriber(createSpanReceivedEvent(), {
        tenantId: TEST_TENANT_ID,
        aggregateId: "trace-1",
        state,
      });

      expect(deps.computeExperimentRunMetrics).not.toHaveBeenCalled();
    });
  });

  describe("when experimentId lookup fails", () => {
    it("skips without dispatching", async () => {
      const deps = createDeps();
      deps.lookupExperimentId.mockResolvedValue(null);
      const subscriber = createExperimentMetricsSyncHandler(deps);

      const state = createTraceSummaryState({
        attributes: { "evaluation.run_id": "run-1" },
        totalCost: 0.003,
      });

      await subscriber(createSpanReceivedEvent(), {
        tenantId: TEST_TENANT_ID,
        aggregateId: "trace-1",
        state,
      });

      expect(deps.computeExperimentRunMetrics).not.toHaveBeenCalled();
    });
  });

  describe("when computeExperimentRunMetrics fails", () => {
    it("logs warning and does not throw", async () => {
      const deps = createDeps();
      deps.computeExperimentRunMetrics.mockRejectedValue(new Error("Dispatch error"));
      const subscriber = createExperimentMetricsSyncHandler(deps);

      const state = createTraceSummaryState({
        attributes: { "evaluation.run_id": "run-1" },
        totalCost: 0.003,
      });

      await expect(
        subscriber(createSpanReceivedEvent(), {
          tenantId: TEST_TENANT_ID,
          aggregateId: "trace-1",
          state,
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when deciding whether the trace has experiment cost metrics", () => {
    describe("when trace has evaluation.run_id and cost data", () => {
      it("returns true", () => {
        const state = createTraceSummaryState({
          attributes: { "evaluation.run_id": "run-1" },
          totalCost: 0.003,
        });

        expect(hasExperimentCostMetrics(state)).toBe(true);
      });
    });

    describe("when trace has no evaluation.run_id", () => {
      it("returns false", () => {
        const state = createTraceSummaryState({ attributes: {} });

        expect(hasExperimentCostMetrics(state)).toBe(false);
      });
    });

    describe("when trace has no cost data", () => {
      it("returns false", () => {
        const state = createTraceSummaryState({
          attributes: { "evaluation.run_id": "run-1" },
          totalCost: null,
        });

        expect(hasExperimentCostMetrics(state)).toBe(false);
      });
    });

    describe("when trace has exactly zero cost", () => {
      it("returns false", () => {
        const state = createTraceSummaryState({
          attributes: { "evaluation.run_id": "run-1" },
          totalCost: 0,
        });

        expect(hasExperimentCostMetrics(state)).toBe(false);
      });
    });
  });
});
