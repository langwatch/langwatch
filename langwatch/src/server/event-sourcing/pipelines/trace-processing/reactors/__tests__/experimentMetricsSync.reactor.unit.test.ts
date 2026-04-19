import { describe, expect, it, vi } from "vitest";
import {
  createExperimentMetricsSyncReactor,
  type ExperimentMetricsSyncReactorDeps,
} from "../experimentMetricsSync.reactor";
import { createTenantId } from "../../../../domain/tenantId";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import { SPAN_RECEIVED_EVENT_TYPE, SPAN_RECEIVED_EVENT_VERSION_LATEST } from "../../schemas/constants";
import type { SpanReceivedEvent } from "../../schemas/events";

const TEST_TENANT_ID = createTenantId("tenant-1");

function createDeps(): ExperimentMetricsSyncReactorDeps & {
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
    tokensEstimated: false,
    totalPromptTokenCount: 100,
    totalCompletionTokenCount: 50,
    outputFromRootSpan: true,
    outputSpanEndTimeMs: 1000,
    blockedByGuardrail: false,
    topicId: null,
    subTopicId: null,
    annotationIds: [],
    attributes: {},
    scenarioRoleCosts: {},
    scenarioRoleLatencies: {},
    scenarioRoleSpans: {},
    lastEventOccurredAt: 0,
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

describe("experimentMetricsSync reactor (trace-side ECST publisher)", () => {
  describe("when reactor is created", () => {
    it("has dedup options with makeJobId, ttl, and delay", () => {
      const deps = createDeps();
      const reactor = createExperimentMetricsSyncReactor(deps);

      expect(reactor.options).toBeDefined();
      expect(reactor.options?.makeJobId).toBeTypeOf("function");
      expect(reactor.options?.ttl).toBe(60_000);
      expect(reactor.options?.delay).toBe(60_000);
    });
  });

  describe("when trace has evaluation.run_id attribute", () => {
    it("dispatches computeExperimentRunMetrics with cost payload", async () => {
      const deps = createDeps();
      const reactor = createExperimentMetricsSyncReactor(deps);

      const foldState = createTraceSummaryState({
        attributes: { "evaluation.run_id": "run-1" },
        totalCost: 0.003,
      });

      await reactor.handle(createSpanReceivedEvent(), {
        tenantId: TEST_TENANT_ID,
        aggregateId: "trace-1",
        foldState,
      });

      expect(deps.lookupExperimentId).toHaveBeenCalledWith(
        TEST_TENANT_ID,
        "run-1",
      );
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
    it("skips without dispatching", async () => {
      const deps = createDeps();
      const reactor = createExperimentMetricsSyncReactor(deps);

      const foldState = createTraceSummaryState({
        attributes: { "langwatch.origin": "sdk" },
      });

      await reactor.handle(createSpanReceivedEvent(), {
        tenantId: TEST_TENANT_ID,
        aggregateId: "trace-1",
        foldState,
      });

      expect(deps.computeExperimentRunMetrics).not.toHaveBeenCalled();
    });
  });

  describe("when trace has no cost data", () => {
    it("skips without dispatching when totalCost is null", async () => {
      const deps = createDeps();
      const reactor = createExperimentMetricsSyncReactor(deps);

      const foldState = createTraceSummaryState({
        attributes: { "evaluation.run_id": "run-1" },
        totalCost: null,
      });

      await reactor.handle(createSpanReceivedEvent(), {
        tenantId: TEST_TENANT_ID,
        aggregateId: "trace-1",
        foldState,
      });

      expect(deps.computeExperimentRunMetrics).not.toHaveBeenCalled();
    });

    it("skips without dispatching when totalCost is zero", async () => {
      const deps = createDeps();
      const reactor = createExperimentMetricsSyncReactor(deps);

      const foldState = createTraceSummaryState({
        attributes: { "evaluation.run_id": "run-1" },
        totalCost: 0,
      });

      await reactor.handle(createSpanReceivedEvent(), {
        tenantId: TEST_TENANT_ID,
        aggregateId: "trace-1",
        foldState,
      });

      expect(deps.computeExperimentRunMetrics).not.toHaveBeenCalled();
    });
  });

  describe("when experimentId lookup fails", () => {
    it("skips without dispatching", async () => {
      const deps = createDeps();
      deps.lookupExperimentId.mockResolvedValue(null);
      const reactor = createExperimentMetricsSyncReactor(deps);

      const foldState = createTraceSummaryState({
        attributes: { "evaluation.run_id": "run-1" },
        totalCost: 0.003,
      });

      await reactor.handle(createSpanReceivedEvent(), {
        tenantId: TEST_TENANT_ID,
        aggregateId: "trace-1",
        foldState,
      });

      expect(deps.computeExperimentRunMetrics).not.toHaveBeenCalled();
    });
  });

  describe("when computeExperimentRunMetrics fails", () => {
    it("logs warning and does not throw", async () => {
      const deps = createDeps();
      deps.computeExperimentRunMetrics.mockRejectedValue(new Error("Dispatch error"));
      const reactor = createExperimentMetricsSyncReactor(deps);

      const foldState = createTraceSummaryState({
        attributes: { "evaluation.run_id": "run-1" },
        totalCost: 0.003,
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
});
