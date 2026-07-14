import { describe, expect, it, vi } from "vitest";
import {
  createSimulationMetricsSyncReactor,
  type SimulationMetricsSyncReactorDeps,
} from "../simulationMetricsSync.reactor";
import { createTenantId } from "../../../../domain/tenantId";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import { SPAN_RECEIVED_EVENT_TYPE, SPAN_RECEIVED_EVENT_VERSION_LATEST } from "../../schemas/constants";
import type { SpanReceivedEvent } from "../../schemas/events";

const TEST_TENANT_ID = createTenantId("tenant-1");

function createDeps(): SimulationMetricsSyncReactorDeps & {
  computeRunMetrics: ReturnType<typeof vi.fn>;
} {
  return {
    computeRunMetrics: vi.fn().mockResolvedValue(undefined),
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
    totalCost: 0.001,
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

describe("simulationMetricsSync reactor (trace-side metrics publisher)", () => {
  describe("when reactor is created", () => {
    it("has dedup options with makeJobId, ttl, and delay", () => {
      const deps = createDeps();
      const reactor = createSimulationMetricsSyncReactor(deps);

      expect(reactor.options).toBeDefined();
      expect(reactor.options?.makeJobId).toBeTypeOf("function");
      expect(reactor.options?.ttl).toBe(60_000);
      expect(reactor.options?.delay).toBe(60_000);
    });
  });

  describe("when trace has scenario.run_id attribute", () => {
    it("dispatches computeRunMetrics in pull mode (role costs derived downstream)", async () => {
      const deps = createDeps();
      const reactor = createSimulationMetricsSyncReactor(deps);

      const foldState = createTraceSummaryState({
        attributes: { "scenario.run_id": "run-1" },
        totalCost: 0.001,
      });

      await reactor.handle(createSpanReceivedEvent(), {
        tenantId: TEST_TENANT_ID,
        aggregateId: "trace-1",
        foldState,
      });

      // No metrics carried: computeRunMetrics derives role cost/latency from
      // stored_spans, so the reactor only identifies the trace to compute.
      expect(deps.computeRunMetrics).toHaveBeenCalledWith({
        tenantId: TEST_TENANT_ID,
        scenarioRunId: "run-1",
        traceId: "trace-1",
        retryCount: 0,
        occurredAt: expect.any(Number),
      });
    });
  });

  describe("when trace has no scenario.run_id attribute", () => {
    it("skips without dispatching", async () => {
      const deps = createDeps();
      const reactor = createSimulationMetricsSyncReactor(deps);

      const foldState = createTraceSummaryState({
        attributes: { "langwatch.origin": "sdk" },
      });

      await reactor.handle(createSpanReceivedEvent(), {
        tenantId: TEST_TENANT_ID,
        aggregateId: "trace-1",
        foldState,
      });

      expect(deps.computeRunMetrics).not.toHaveBeenCalled();
    });
  });

  describe("when trace has no spans and no cost", () => {
    it("skips without dispatching", async () => {
      const deps = createDeps();
      const reactor = createSimulationMetricsSyncReactor(deps);

      const foldState = createTraceSummaryState({
        attributes: { "scenario.run_id": "run-1" },
        spanCount: 0,
        totalCost: null,
      });

      await reactor.handle(createSpanReceivedEvent(), {
        tenantId: TEST_TENANT_ID,
        aggregateId: "trace-1",
        foldState,
      });

      expect(deps.computeRunMetrics).not.toHaveBeenCalled();
    });
  });

  describe("when computeRunMetrics fails", () => {
    it("logs warning and does not throw", async () => {
      const deps = createDeps();
      deps.computeRunMetrics.mockRejectedValue(new Error("Dispatch error"));
      const reactor = createSimulationMetricsSyncReactor(deps);

      const foldState = createTraceSummaryState({
        attributes: { "scenario.run_id": "run-1" },
        totalCost: 0.001,
      });

      await expect(
        reactor.handle(createSpanReceivedEvent(), {
          tenantId: TEST_TENANT_ID,
          aggregateId: "trace-1",
          foldState,
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when deciding whether to react", () => {
    describe("when trace has scenario.run_id and data to aggregate", () => {
      it("returns true", () => {
        const reactor = createSimulationMetricsSyncReactor(createDeps());
        const foldState = createTraceSummaryState({
          attributes: { "scenario.run_id": "run-1" },
        });

        expect(
          reactor.shouldReact!(createSpanReceivedEvent(), {
            tenantId: TEST_TENANT_ID,
            aggregateId: "trace-1",
            foldState,
          }),
        ).toBe(true);
      });
    });

    describe("when trace has no scenario.run_id", () => {
      it("returns false", () => {
        const reactor = createSimulationMetricsSyncReactor(createDeps());
        const foldState = createTraceSummaryState({
          attributes: { "langwatch.origin": "sdk" },
        });

        expect(
          reactor.shouldReact!(createSpanReceivedEvent(), {
            tenantId: TEST_TENANT_ID,
            aggregateId: "trace-1",
            foldState,
          }),
        ).toBe(false);
      });
    });

    describe("when trace has no spans and no cost", () => {
      it("returns false", () => {
        const reactor = createSimulationMetricsSyncReactor(createDeps());
        const foldState = createTraceSummaryState({
          attributes: { "scenario.run_id": "run-1" },
          spanCount: 0,
          totalCost: null,
        });

        expect(
          reactor.shouldReact!(createSpanReceivedEvent(), {
            tenantId: TEST_TENANT_ID,
            aggregateId: "trace-1",
            foldState,
          }),
        ).toBe(false);
      });
    });
  });

  describe("when totalCost is zero but the trace has spans", () => {
    it("dispatches computeRunMetrics", async () => {
      const deps = createDeps();
      const reactor = createSimulationMetricsSyncReactor(deps);

      const foldState = createTraceSummaryState({
        attributes: { "scenario.run_id": "run-1" },
        spanCount: 2,
        totalCost: 0,
      });

      await reactor.handle(createSpanReceivedEvent(), {
        tenantId: TEST_TENANT_ID,
        aggregateId: "trace-1",
        foldState,
      });

      expect(deps.computeRunMetrics).toHaveBeenCalledTimes(1);
    });
  });
});
