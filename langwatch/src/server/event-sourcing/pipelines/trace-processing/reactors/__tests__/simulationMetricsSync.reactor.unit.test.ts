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
    tokensEstimated: false,
    totalPromptTokenCount: 100,
    totalCompletionTokenCount: 50,
    outputFromRootSpan: true,
    outputSpanEndTimeMs: 1000,
    blockedByGuardrail: false,
    topicId: null,
    subTopicId: null,
    hasAnnotation: null,
    attributes: {},
    scenarioRoleCosts: { Agent: 0.001 },
    scenarioRoleLatencies: { Agent: 500 },
    scenarioRoleSpans: {},
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

describe("simulationMetricsSync reactor (trace-side ECST publisher)", () => {
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
    it("dispatches computeRunMetrics with ECST payload", async () => {
      const deps = createDeps();
      const reactor = createSimulationMetricsSyncReactor(deps);

      const foldState = createTraceSummaryState({
        attributes: { "scenario.run_id": "run-1" },
        scenarioRoleCosts: { Agent: 0.001 },
        scenarioRoleLatencies: { Agent: 500 },
        totalCost: 0.001,
      });

      await reactor.handle(createSpanReceivedEvent(), {
        tenantId: TEST_TENANT_ID,
        aggregateId: "trace-1",
        foldState,
      });

      expect(deps.computeRunMetrics).toHaveBeenCalledWith({
        tenantId: TEST_TENANT_ID,
        scenarioRunId: "run-1",
        traceId: "trace-1",
        metrics: {
          totalCost: 0.001,
          roleCosts: { Agent: 0.001 },
          roleLatencies: { Agent: 500 },
        },
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

  describe("when trace has no role costs or total cost", () => {
    it("skips without dispatching", async () => {
      const deps = createDeps();
      const reactor = createSimulationMetricsSyncReactor(deps);

      const foldState = createTraceSummaryState({
        attributes: { "scenario.run_id": "run-1" },
        scenarioRoleCosts: {},
        scenarioRoleLatencies: {},
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
        scenarioRoleCosts: { Agent: 0.001 },
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

  describe("when totalCost is zero but scenarioRoleCosts exist", () => {
    it("dispatches computeRunMetrics", async () => {
      const deps = createDeps();
      const reactor = createSimulationMetricsSyncReactor(deps);

      const foldState = createTraceSummaryState({
        attributes: { "scenario.run_id": "run-1" },
        scenarioRoleCosts: { Agent: 0.0 },
        scenarioRoleLatencies: { Agent: 500 },
        totalCost: 0,
      });

      await reactor.handle(createSpanReceivedEvent(), {
        tenantId: TEST_TENANT_ID,
        aggregateId: "trace-1",
        foldState,
      });

      // scenarioRoleCosts has an entry, even though value is 0, so dispatch happens
      expect(deps.computeRunMetrics).toHaveBeenCalledTimes(1);
    });
  });
});
