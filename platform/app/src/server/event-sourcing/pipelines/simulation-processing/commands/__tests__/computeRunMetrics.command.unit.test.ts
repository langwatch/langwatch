import { describe, expect, it, vi } from "vitest";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { ComputeRunMetricsCommandData } from "../../schemas/commands";
import type { ComputeRunMetricsDeps } from "../computeRunMetrics.command";
import { ComputeRunMetricsCommand } from "../computeRunMetrics.command";

function makeDeps(
  overrides: Partial<ComputeRunMetricsDeps> = {},
): ComputeRunMetricsDeps {
  return {
    traceSummaryStore: {
      get: vi.fn().mockResolvedValue(null),
      store: vi.fn().mockResolvedValue(undefined),
    },
    scheduleRetry: vi.fn().mockResolvedValue(undefined),
    deriveScenarioRoleMetrics: vi
      .fn()
      .mockResolvedValue({ scenarioRoleCosts: {}, scenarioRoleLatencies: {} }),
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

function makeTraceSummary(
  overrides: Partial<TraceSummaryData> = {},
): TraceSummaryData {
  return {
    traceId: "trace-1",
    traceName: "",
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
    nonBilledCost: null,
    tokensEstimated: false,
    totalPromptTokenCount: null,
    totalCompletionTokenCount: null,
    outputFromRootSpan: false,
    outputSpanEndTimeMs: 0,
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

describe("ComputeRunMetricsCommand", () => {
  describe("when trace summary exists but has no metrics yet", () => {
    it("schedules a deferred retry instead of silently returning", async () => {
      const deps = makeDeps({
        traceSummaryStore: {
          get: vi.fn().mockResolvedValue(makeTraceSummary({ totalCost: null })),
          store: vi.fn(),
        },
        // No role cost derivable yet (spans not settled) and totalCost null.
        deriveScenarioRoleMetrics: vi.fn().mockResolvedValue({
          scenarioRoleCosts: {},
          scenarioRoleLatencies: {},
        }),
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

    /** @scenario "The pull ladder outlasts the trace-side settle debounce" */
    it("keeps retrying past the trace-side settle debounce", async () => {
      // The trace-side publisher waits 60s of quiet before publishing a
      // trace's metrics, so a ladder that gave up at 30s could never win the
      // race it exists to win.
      const deps = makeDeps({
        traceSummaryStore: {
          get: vi.fn().mockResolvedValue(makeTraceSummary({ totalCost: null })),
          store: vi.fn(),
        },
      });

      const handler = new ComputeRunMetricsCommand(deps);

      const events = await handler.handle(
        makeCommand({ retryCount: 3 }) as any,
      );

      expect(events).toEqual([]);
      expect(deps.scheduleRetry).toHaveBeenCalledWith(
        expect.objectContaining({ retryCount: 4 }),
      );
    });

    /** @scenario "A trace that reports no cost records the run as costless" */
    it("records the run as costless once the retries are exhausted", async () => {
      // A simulation trace can legitimately have spans with no cost and no
      // role timing — an SDK run whose agent executes on the customer's own
      // infrastructure and never reports LLM spans is the common case. That is
      // a fact to record, not a failure to retry forever and then log.
      const deps = makeDeps({
        traceSummaryStore: {
          get: vi.fn().mockResolvedValue(makeTraceSummary({ totalCost: null })),
          store: vi.fn(),
        },
      });

      const handler = new ComputeRunMetricsCommand(deps);

      const events = await handler.handle(
        makeCommand({ retryCount: 99 }) as any,
      );

      expect(deps.scheduleRetry).not.toHaveBeenCalled();
      expect(events).toHaveLength(1);
      expect(events[0]?.data).toEqual(
        expect.objectContaining({
          scenarioRunId: "run-1",
          traceId: "trace-1",
          totalCost: 0,
          roleCosts: {},
          roleLatencies: {},
        }),
      );
    });
  });

  describe("when the trace summary never arrives at all", () => {
    /** @scenario "A trace summary that never arrives emits nothing" */
    it("emits nothing and stops retrying", async () => {
      // Distinct from a trace that honestly reports no cost: a summary that
      // never appeared is a missing trace, and stays the one error worth
      // alerting on rather than being recorded as a costless run.
      const deps = makeDeps({
        traceSummaryStore: {
          get: vi.fn().mockResolvedValue(null),
          store: vi.fn(),
        },
      });

      const handler = new ComputeRunMetricsCommand(deps);

      const events = await handler.handle(
        makeCommand({ retryCount: 99 }) as any,
      );

      expect(events).toEqual([]);
      expect(deps.scheduleRetry).not.toHaveBeenCalled();
    });
  });

  describe("when trace summary exists with metrics", () => {
    it("emits a metrics_computed event with totalCost from the summary and role costs derived from spans", async () => {
      const deps = makeDeps({
        traceSummaryStore: {
          get: vi
            .fn()
            .mockResolvedValue(makeTraceSummary({ totalCost: 0.003 })),
          store: vi.fn(),
        },
        deriveScenarioRoleMetrics: vi.fn().mockResolvedValue({
          scenarioRoleCosts: { Agent: 0.003 },
          scenarioRoleLatencies: { Agent: 4000 },
        }),
      });

      const handler = new ComputeRunMetricsCommand(deps);
      const cmd = makeCommand();

      const events = await handler.handle(cmd as any);

      expect(deps.deriveScenarioRoleMetrics).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "tenant-1", traceId: "trace-1" }),
      );
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

  describe("when the scenario trace has role latency but no cost", () => {
    it("emits metrics with totalCost 0 instead of retrying forever", async () => {
      const deps = makeDeps({
        traceSummaryStore: {
          // Cost-free scenario trace: no totalCost, but role-bearing spans
          // with latency. The readiness check must not treat this as "empty".
          get: vi.fn().mockResolvedValue(makeTraceSummary({ totalCost: null })),
          store: vi.fn(),
        },
        deriveScenarioRoleMetrics: vi.fn().mockResolvedValue({
          scenarioRoleCosts: {},
          scenarioRoleLatencies: { Agent: 4000 },
        }),
      });

      const handler = new ComputeRunMetricsCommand(deps);
      const events = await handler.handle(makeCommand() as any);

      expect(deps.scheduleRetry).not.toHaveBeenCalled();
      expect(events).toHaveLength(1);
      expect(events[0]!.data).toMatchObject({
        totalCost: 0,
        roleCosts: {},
        roleLatencies: { Agent: 4000 },
      });
    });
  });

  describe("when ECST payload is provided", () => {
    it("emits event directly without reading store or deriving", async () => {
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
      expect(deps.deriveScenarioRoleMetrics).not.toHaveBeenCalled();
      expect(events[0]!.data).toMatchObject({
        totalCost: 0.005,
        roleCosts: { User: 0.002 },
      });
    });
  });
});
