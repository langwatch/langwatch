import { describe, expect, it } from "vitest";
import type {
  EvaluatorResultEvent,
  ExperimentRunCompletedEvent,
  ExperimentRunStartedEvent,
  TargetResultEvent,
  TraceMetricsComputedEvent,
} from "../../schemas/events";
import {
  EXPERIMENT_ANALYTICS_PROJECTION_VERSION_LATEST,
  ExperimentAnalyticsFoldProjection,
  projectExperimentAnalyticsStateToRow,
} from "../experimentAnalytics.foldProjection";

const TENANT = "proj-exp";

function makeStarted(): ExperimentRunStartedEvent {
  return {
    type: "lw.experiment_run.started",
    id: "evt-s",
    tenantId: TENANT,
    aggregateId: "run-1",
    occurredAt: 1_000,
    data: {
      runId: "run-1",
      experimentId: "exp-1",
      workflowVersionId: "wfv-1",
      total: 3,
      targets: [],
    },
  } as unknown as ExperimentRunStartedEvent;
}

function makeTarget(error: boolean, cost: number): TargetResultEvent {
  return {
    type: "lw.experiment_run.target_result",
    id: `evt-t-${Math.random()}`,
    tenantId: TENANT,
    aggregateId: "run-1",
    occurredAt: 2_000,
    data: {
      runId: "run-1",
      experimentId: "exp-1",
      index: 0,
      targetId: "tgt-1",
      entry: {},
      cost,
      duration: 500,
      error: error ? "boom" : null,
    },
  } as unknown as TargetResultEvent;
}

function makeEvaluator(
  score: number | null,
  passed: boolean | null,
): EvaluatorResultEvent {
  return {
    type: "lw.experiment_run.evaluator_result",
    id: `evt-e-${Math.random()}`,
    tenantId: TENANT,
    aggregateId: "run-1",
    occurredAt: 2_500,
    data: {
      runId: "run-1",
      experimentId: "exp-1",
      index: 0,
      targetId: "tgt-1",
      evaluatorId: "ev-1",
      status: "processed",
      score,
      passed,
    },
  } as unknown as EvaluatorResultEvent;
}

function makeTraceMetrics(
  traceId: string,
  totalCost: number,
): TraceMetricsComputedEvent {
  return {
    type: "lw.experiment_run.trace_metrics_computed",
    id: `evt-tm-${traceId}`,
    tenantId: TENANT,
    aggregateId: "run-1",
    occurredAt: 2_700,
    data: {
      runId: "run-1",
      experimentId: "exp-1",
      traceId,
      totalCost,
    },
  } as unknown as TraceMetricsComputedEvent;
}

function makeCompleted(
  finished: boolean,
  stopped: boolean,
): ExperimentRunCompletedEvent {
  return {
    type: "lw.experiment_run.completed",
    id: "evt-c",
    tenantId: TENANT,
    aggregateId: "run-1",
    occurredAt: 3_000,
    data: {
      runId: "run-1",
      experimentId: "exp-1",
      finishedAt: finished ? 3_000 : null,
      stoppedAt: stopped ? 3_000 : null,
    },
  } as unknown as ExperimentRunCompletedEvent;
}

describe("ExperimentAnalyticsFoldProjection", () => {
  describe("given a started → 2 targets → 1 evaluator → completed stream", () => {
    it("hoists dims and computes derived metrics", () => {
      const slim = new ExperimentAnalyticsFoldProjection({
        store: { store: async () => {}, get: async () => null },
      });
      let state = slim.init();
      state = slim.handleExperimentRunStarted(makeStarted(), state);
      state = slim.handleExperimentRunTargetResult(
        makeTarget(false, 0.1),
        state,
      );
      state = slim.handleExperimentRunTargetResult(
        makeTarget(true, 0.05),
        state,
      );
      state = slim.handleExperimentRunEvaluatorResult(
        makeEvaluator(0.8, true),
        state,
      );
      state = slim.handleExperimentRunCompleted(
        makeCompleted(true, false),
        state,
      );

      expect(state.runId).toBe("run-1");
      expect(state.experimentId).toBe("exp-1");
      expect(state.workflowVersionId).toBe("wfv-1");
      expect(state.total).toBe(3);
      expect(state.completedCount).toBe(1);
      expect(state.failedCount).toBe(1);
      expect(state.progress).toBe(2);
      expect(state.totalCost).toBeCloseTo(0.15, 5);
      expect(state.totalDurationMs).toBe(1000);
      expect(state.avgScoreBps).toBe(8000);
      expect(state.passRateBps).toBe(10000);
      expect(state.finishedAt).toBe(3_000);
      expect(state.stoppedAt).toBeNull();
    });
  });

  describe("when projected to a row", () => {
    it("emits completionMode='finished' on a finished run", () => {
      const slim = new ExperimentAnalyticsFoldProjection({
        store: { store: async () => {}, get: async () => null },
      });
      let state = slim.init();
      state = slim.handleExperimentRunStarted(makeStarted(), state);
      state = slim.handleExperimentRunCompleted(
        makeCompleted(true, false),
        state,
      );
      state = { ...state, LastEventOccurredAt: 9, createdAt: 1, updatedAt: 9 };
      const row = projectExperimentAnalyticsStateToRow({
        state,
        tenantId: TENANT,
        version: EXPERIMENT_ANALYTICS_PROJECTION_VERSION_LATEST,
      });
      expect(row.completionMode).toBe("finished");
    });

    it("emits completionMode='stopped' on a stopped run", () => {
      const slim = new ExperimentAnalyticsFoldProjection({
        store: { store: async () => {}, get: async () => null },
      });
      let state = slim.init();
      state = slim.handleExperimentRunStarted(makeStarted(), state);
      state = slim.handleExperimentRunCompleted(
        makeCompleted(false, true),
        state,
      );
      state = { ...state, LastEventOccurredAt: 9, createdAt: 1, updatedAt: 9 };
      const row = projectExperimentAnalyticsStateToRow({
        state,
        tenantId: TENANT,
        version: EXPERIMENT_ANALYTICS_PROJECTION_VERSION_LATEST,
      });
      expect(row.completionMode).toBe("stopped");
    });
  });

  describe("given trace_metrics_computed events for the same traceId", () => {
    it("replaces (not accumulates) the per-trace cost", () => {
      const slim = new ExperimentAnalyticsFoldProjection({
        store: { store: async () => {}, get: async () => null },
      });
      let state = slim.init();
      state = slim.handleExperimentRunTraceMetricsComputed(
        makeTraceMetrics("trace-1", 0.5),
        state,
      );
      state = slim.handleExperimentRunTraceMetricsComputed(
        makeTraceMetrics("trace-1", 0.9),
        state,
      );
      state = slim.handleExperimentRunTraceMetricsComputed(
        makeTraceMetrics("trace-2", 0.1),
        state,
      );
      expect(state.totalCost).toBeCloseTo(1.0, 5);
    });
  });
});
