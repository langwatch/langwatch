import { describe, expect, it } from "vitest";
import { createTenantId } from "../../../../domain/tenantId";
import type { FoldProjectionStore } from "../../../../projections/foldProjection.types";
import {
	EXPERIMENT_RUN_EVENT_TYPES,
	EXPERIMENT_RUN_EVENT_VERSIONS,
} from "../../schemas/constants";
import type {
	EvaluatorResultEvent,
	ExperimentRunCompletedEvent,
	ExperimentRunProcessingEvent,
	ExperimentRunStartedEvent,
	TargetResultEvent,
	TraceMetricsComputedEvent,
} from "../../schemas/events";
import {
	ExperimentRunStateFoldProjection,
	type ExperimentRunStateData,
} from "../experimentRunState.foldProjection";

// Create a dummy store — only init/apply are tested, not persistence
const noopStore: FoldProjectionStore<ExperimentRunStateData> = {
  store: async () => {},
  get: async () => null,
};
const experimentRunStateFoldProjection = new ExperimentRunStateFoldProjection({ store: noopStore });

const TEST_TENANT_ID = createTenantId("tenant-1");

function createStartedEvent(
  overrides: Partial<ExperimentRunStartedEvent["data"]> = {},
): ExperimentRunStartedEvent {
  return {
    id: "event-1",
    aggregateId: "run-123",
    aggregateType: "experiment_run",
    tenantId: TEST_TENANT_ID,
    createdAt: 1000,
    occurredAt: 1000,
    type: EXPERIMENT_RUN_EVENT_TYPES.STARTED,
    version: EXPERIMENT_RUN_EVENT_VERSIONS.STARTED,
    data: {
      runId: "run-123",
      experimentId: "exp-1",
      total: 10,
      targets: [{ id: "target-1", name: "Target 1", type: "llm" }],
      ...overrides,
    },
  };
}

function createTargetResultEvent(
  overrides: Partial<TargetResultEvent["data"]> = {},
  eventOverrides: Partial<TargetResultEvent> = {},
): TargetResultEvent {
  return {
    id: "event-2",
    aggregateId: "run-123",
    aggregateType: "experiment_run",
    tenantId: TEST_TENANT_ID,
    createdAt: 2000,
    occurredAt: 2000,
    type: EXPERIMENT_RUN_EVENT_TYPES.TARGET_RESULT,
    version: EXPERIMENT_RUN_EVENT_VERSIONS.TARGET_RESULT,
    data: {
      runId: "run-123",
      experimentId: "exp-1",
      index: 0,
      targetId: "target-1",
      entry: { input: "test" },
      predicted: { output: "result" },
      ...overrides,
    },
    ...eventOverrides,
  };
}

function createEvaluatorResultEvent(
  overrides: Partial<EvaluatorResultEvent["data"]> = {},
  eventOverrides: Partial<EvaluatorResultEvent> = {},
): EvaluatorResultEvent {
  return {
    id: "event-3",
    aggregateId: "run-123",
    aggregateType: "experiment_run",
    tenantId: TEST_TENANT_ID,
    createdAt: 3000,
    occurredAt: 3000,
    type: EXPERIMENT_RUN_EVENT_TYPES.EVALUATOR_RESULT,
    version: EXPERIMENT_RUN_EVENT_VERSIONS.EVALUATOR_RESULT,
    data: {
      runId: "run-123",
      experimentId: "exp-1",
      index: 0,
      targetId: "target-1",
      evaluatorId: "eval-1",
      status: "processed",
      score: 0.8,
      ...overrides,
    },
    ...eventOverrides,
  };
}

function createCompletedEvent(
  overrides: Partial<ExperimentRunCompletedEvent["data"]> = {},
): ExperimentRunCompletedEvent {
  return {
    id: "event-4",
    aggregateId: "run-123",
    aggregateType: "experiment_run",
    tenantId: TEST_TENANT_ID,
    createdAt: 4000,
    occurredAt: 4000,
    type: EXPERIMENT_RUN_EVENT_TYPES.COMPLETED,
    version: EXPERIMENT_RUN_EVENT_VERSIONS.COMPLETED,
    data: {
      runId: "run-123",
      experimentId: "exp-1",
      finishedAt: 4000,
      ...overrides,
    },
  };
}

/**
 * Helper to fold a sequence of events through init() + apply().
 */
function foldEvents(events: ExperimentRunProcessingEvent[]): ExperimentRunStateData {
  let state = experimentRunStateFoldProjection.init();
  for (const event of events) {
    state = experimentRunStateFoldProjection.apply(state, event);
  }
  return state;
}

describe("experimentRunStateFoldProjection", () => {
  it("initializes run state from ExperimentRunStartedEvent", () => {
    const state = foldEvents([createStartedEvent()]);

    expect(state.RunId).toBe("run-123");
    expect(state.ExperimentId).toBe("exp-1");
    expect(state.Total).toBe(10);
    expect(state.CompletedCount).toBe(0);
    expect(state.FailedCount).toBe(0);
  });

  it("tracks progress from TargetResultEvent", () => {
    const state = foldEvents([
      createStartedEvent(),
      createTargetResultEvent({ index: 0 }),
      createTargetResultEvent({ index: 1 }, { id: "event-2b", createdAt: 2100 }),
    ]);

    expect(state.Progress).toBe(2);
    expect(state.CompletedCount).toBe(2);
    expect(state.FailedCount).toBe(0);
  });

  it("tracks failed results separately", () => {
    const state = foldEvents([
      createStartedEvent(),
      createTargetResultEvent({ index: 0 }),
      createTargetResultEvent(
        { index: 1, error: "Something went wrong" },
        { id: "event-2b", createdAt: 2100 },
      ),
    ]);

    expect(state.Progress).toBe(2);
    expect(state.CompletedCount).toBe(1);
    expect(state.FailedCount).toBe(1);
  });

  it("computes average score in basis points from EvaluatorResultEvents", () => {
    const state = foldEvents([
      createStartedEvent(),
      createTargetResultEvent(),
      createEvaluatorResultEvent({ score: 0.6 }),
      createEvaluatorResultEvent(
        { score: 0.8, evaluatorId: "eval-2" },
        { id: "event-3b", createdAt: 3100 },
      ),
      createEvaluatorResultEvent(
        { score: 1.0, evaluatorId: "eval-3" },
        { id: "event-3c", createdAt: 3200 },
      ),
    ]);

    // (0.6 + 0.8 + 1.0) / 3 = 0.8 → 8000 bps
    expect(state.AvgScoreBps).toBe(8000);
  });

  it("computes pass rate in basis points from evaluator results", () => {
    const state = foldEvents([
      createStartedEvent(),
      createTargetResultEvent(),
      createEvaluatorResultEvent({ passed: true }),
      createEvaluatorResultEvent(
        { passed: false, evaluatorId: "eval-2" },
        { id: "event-3b", createdAt: 3100 },
      ),
      createEvaluatorResultEvent(
        { passed: true, evaluatorId: "eval-3" },
        { id: "event-3c", createdAt: 3200 },
      ),
    ]);

    // 2/3 → 6667 bps (rounded)
    expect(state.PassRateBps).toBe(6667);
  });

  it("marks completion from ExperimentRunCompletedEvent", () => {
    const state = foldEvents([
      createStartedEvent(),
      createTargetResultEvent(),
      createCompletedEvent({ finishedAt: 5000 }),
    ]);

    expect(state.FinishedAt).toBe(5000);
    expect(state.StoppedAt).toBeNull();
  });

  it("marks stopped when stoppedAt is provided", () => {
    const state = foldEvents([
      createStartedEvent(),
      createCompletedEvent({ finishedAt: null, stoppedAt: 5000 }),
    ]);

    expect(state.FinishedAt).toBeNull();
    expect(state.StoppedAt).toBe(5000);
  });

  it("excludes skipped and error evaluator results from pass rate", () => {
    const state = foldEvents([
      createStartedEvent(),
      createTargetResultEvent(),
      createEvaluatorResultEvent({ passed: true }),
      createEvaluatorResultEvent(
        { passed: false, evaluatorId: "eval-2" },
        { id: "event-3b", createdAt: 3100 },
      ),
      createEvaluatorResultEvent(
        { status: "skipped", evaluatorId: "eval-3", score: undefined, passed: undefined },
        { id: "event-3c", createdAt: 3200 },
      ),
      createEvaluatorResultEvent(
        { status: "error", evaluatorId: "eval-4", score: undefined, passed: undefined },
        { id: "event-3d", createdAt: 3300 },
      ),
    ]);

    // Only 2 processed evaluators (1 passed, 1 failed), skipped/error excluded
    // 1/2 → 5000 bps
    expect(state.PassRateBps).toBe(5000);
  });

  it("excludes score-only evaluators from pass rate denominator", () => {
    const state = foldEvents([
      createStartedEvent(),
      createTargetResultEvent(),
      createEvaluatorResultEvent({ passed: true }),
      createEvaluatorResultEvent(
        { passed: false, evaluatorId: "eval-2" },
        { id: "event-3b", createdAt: 3100 },
      ),
      // Score-only evaluator with no passed value
      createEvaluatorResultEvent(
        { score: 0.9, passed: undefined, evaluatorId: "eval-3" },
        { id: "event-3c", createdAt: 3200 },
      ),
    ]);

    // pass rate: 1/2 → 5000 bps (score-only eval excluded from denominator)
    expect(state.PassRateBps).toBe(5000);
    // avg score still includes all 3: (0.8 + 0.8 + 0.9) / 3 ≈ 0.8333 → 8333 bps
    expect(state.AvgScoreBps).toBe(8333);
  });

  it("accumulates costs from target and evaluator results", () => {
    const state = foldEvents([
      createStartedEvent(),
      createTargetResultEvent({ cost: 0.01 }),
      createEvaluatorResultEvent({ cost: 0.005 }),
    ]);

    expect(state.TotalCost).toBeCloseTo(0.015, 5);
  });

  describe("when trace metrics arrive via ECST", () => {
    function createTraceMetricsEvent(
      overrides: Partial<TraceMetricsComputedEvent["data"]> = {},
      eventOverrides: Partial<TraceMetricsComputedEvent> = {},
    ): TraceMetricsComputedEvent {
      return {
        id: "event-metrics-1",
        aggregateId: "run-123",
        aggregateType: "experiment_run",
        tenantId: TEST_TENANT_ID,
        createdAt: 5000,
        occurredAt: 5000,
        type: EXPERIMENT_RUN_EVENT_TYPES.TRACE_METRICS_COMPUTED,
        version: EXPERIMENT_RUN_EVENT_VERSIONS.TRACE_METRICS_COMPUTED,
        data: {
          runId: "run-123",
          experimentId: "exp-1",
          traceId: "trace-abc",
          totalCost: 0.003,
          ...overrides,
        },
        ...eventOverrides,
      };
    }

    it("accumulates trace cost into TotalCost", () => {
      const state = foldEvents([
        createStartedEvent(),
        createTargetResultEvent(),
        createTraceMetricsEvent({ totalCost: 0.003 }),
      ]);

      expect(state.TotalCost).toBeCloseTo(0.003, 6);
    });

    it("accumulates multiple trace costs", () => {
      const state = foldEvents([
        createStartedEvent(),
        createTargetResultEvent(),
        createTraceMetricsEvent({ traceId: "trace-1", totalCost: 0.003 }),
        createTraceMetricsEvent(
          { traceId: "trace-2", totalCost: 0.002 },
          { id: "event-metrics-2", createdAt: 5100 },
        ),
      ]);

      expect(state.TotalCost).toBeCloseTo(0.005, 6);
    });

    it("stores per-trace breakdown in TraceMetrics", () => {
      const state = foldEvents([
        createStartedEvent(),
        createTraceMetricsEvent({ traceId: "trace-1", totalCost: 0.003 }),
        createTraceMetricsEvent(
          { traceId: "trace-2", totalCost: 0.002 },
          { id: "event-metrics-2", createdAt: 5100 },
        ),
      ]);

      expect(state.TraceMetrics["trace-1"]!.totalCost).toBe(0.003);
      expect(state.TraceMetrics["trace-2"]!.totalCost).toBe(0.002);
    });

    it("replaces existing trace cost on re-delivery (idempotent)", () => {
      const state = foldEvents([
        createStartedEvent(),
        createTraceMetricsEvent({ traceId: "trace-1", totalCost: 0.003 }),
        createTraceMetricsEvent(
          { traceId: "trace-1", totalCost: 0.004 },
          { id: "event-metrics-1b", createdAt: 5200 },
        ),
      ]);

      // Should use the latest cost, not double-count
      expect(state.TotalCost).toBeCloseTo(0.004, 6);
      expect(state.TraceMetrics["trace-1"]!.totalCost).toBe(0.004);
    });

    it("combines trace costs with inline target/evaluator costs", () => {
      const state = foldEvents([
        createStartedEvent(),
        createTargetResultEvent({ cost: 0.01 }),
        createEvaluatorResultEvent({ cost: 0.005 }),
        createTraceMetricsEvent({ totalCost: 0.003 }),
      ]);

      // 0.01 (target) + 0.005 (evaluator) + 0.003 (trace) = 0.018
      expect(state.TotalCost).toBeCloseTo(0.018, 5);
    });

    it("initializes TraceMetrics as empty", () => {
      const state = foldEvents([createStartedEvent()]);
      expect(state.TraceMetrics).toEqual({});
    });
  });
});
