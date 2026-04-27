import { describe, expect, it, vi } from "vitest";
import { ComputeRunMetricsCommand } from "../computeRunMetrics.command";
import type { ComputeRunMetricsDeps } from "../computeRunMetrics.command";
import type { ComputeRunMetricsCommandData } from "../../schemas/commands";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";

function makeDeps(overrides: Partial<ComputeRunMetricsDeps> = {}): ComputeRunMetricsDeps {
  return {
    traceSummaryStore: {
      get: vi.fn().mockResolvedValue(null),
      store: vi.fn().mockResolvedValue(undefined),
    },
    scheduleRetry: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeCommand(overrides: Partial<ComputeRunMetricsCommandData> = {}): {
  tenantId: string;
  data: ComputeRunMetricsCommandData;
} {
  return {
    tenantId: "tenant-1",
    data: {
      tenantId: "tenant-1",
      scenarioRunId: "run-1",
      traceId: "trace-1",
      retryCount: 0,
      occurredAt: Date.now(),
      ...overrides,
    },
  };
}

function makeTraceSummary(overrides: Partial<TraceSummaryData> = {}): TraceSummaryData {
  return {
    traceId: "trace-1",
    spanCount: 3,
    totalDurationMs: 4000,
    computedIOSchemaVersion: "2025-12-18",
    computedInput: null,
    computedOutput: null,
    timeToFirstTokenMs: null,
    timeToLastTokenMs: null,
    tokensPerSecond: null,
    containsErrorStatus: false,
    containsOKStatus: true,
    errorMessage: null,
    models: [],
    totalCost: 0.003,
    tokensEstimated: false,
    totalPromptTokenCount: null,
    totalCompletionTokenCount: null,
    outputFromRootSpan: false,
    outputSpanEndTimeMs: 0,
    blockedByGuardrail: false,
    topicId: null,
    subTopicId: null,
    annotationIds: [],
    attributes: {},
    scenarioRoleCosts: { Agent: 0.003 },
    scenarioRoleLatencies: { Agent: 4000 },
    scenarioRoleSpans: {},
    spanCosts: {},
    lastEventOccurredAt: 0,
    occurredAt: 1000,
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  };
}

describe("ComputeRunMetricsCommand", () => {
  describe("when trace summary exists but has no metrics yet", () => {
    it("schedules a deferred retry instead of silently returning", async () => {
      const deps = makeDeps({
        traceSummaryStore: {
          get: vi.fn().mockResolvedValue(
            makeTraceSummary({
              totalCost: null,
              scenarioRoleCosts: {},
              scenarioRoleLatencies: {},
            }),
          ),
          store: vi.fn(),
        },
      });

      const handler = new ComputeRunMetricsCommand(deps);
      const cmd = makeCommand({ retryCount: 0 });

      const events = await handler.handle(cmd as any);

      expect(events).toEqual([]);
      expect(deps.scheduleRetry).toHaveBeenCalledWith(
        expect.objectContaining({
          retryCount: 1,
          traceId: "trace-1",
          scenarioRunId: "run-1",
        }),
      );
    });

    it("gives up after MAX_RETRIES", async () => {
      const deps = makeDeps({
        traceSummaryStore: {
          get: vi.fn().mockResolvedValue(
            makeTraceSummary({ totalCost: null, scenarioRoleCosts: {}, scenarioRoleLatencies: {} }),
          ),
          store: vi.fn(),
        },
      });

      const handler = new ComputeRunMetricsCommand(deps);
      const cmd = makeCommand({ retryCount: 3 });

      const events = await handler.handle(cmd as any);

      expect(events).toEqual([]);
      expect(deps.scheduleRetry).not.toHaveBeenCalled();
    });
  });

  describe("when trace summary exists with metrics", () => {
    it("emits a metrics_computed event", async () => {
      const deps = makeDeps({
        traceSummaryStore: {
          get: vi.fn().mockResolvedValue(
            makeTraceSummary({
              totalCost: 0.003,
              scenarioRoleCosts: { Agent: 0.003 },
              scenarioRoleLatencies: { Agent: 4000 },
            }),
          ),
          store: vi.fn(),
        },
      });

      const handler = new ComputeRunMetricsCommand(deps);
      const cmd = makeCommand();

      const events = await handler.handle(cmd as any);

      expect(events).toHaveLength(1);
      expect(events[0]!.data).toMatchObject({
        scenarioRunId: "run-1",
        traceId: "trace-1",
        totalCost: 0.003,
        roleCosts: { Agent: 0.003 },
        roleLatencies: { Agent: 4000 },
      });
    });
  });

  describe("when ECST payload is provided", () => {
    it("emits event directly without reading store", async () => {
      const deps = makeDeps();

      const handler = new ComputeRunMetricsCommand(deps);
      const cmd = makeCommand({
        metrics: {
          totalCost: 0.005,
          roleCosts: { User: 0.002 },
          roleLatencies: { User: 1000 },
        },
      });

      const events = await handler.handle(cmd as any);

      expect(events).toHaveLength(1);
      expect(deps.traceSummaryStore.get).not.toHaveBeenCalled();
      expect(events[0]!.data).toMatchObject({
        totalCost: 0.005,
        roleCosts: { User: 0.002 },
      });
    });
  });
});
