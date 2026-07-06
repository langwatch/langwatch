import { describe, expect, it } from "vitest";
import type {
  EvaluatorResultEvent,
  ExperimentRunCompletedEvent,
  ExperimentRunStartedEvent,
  TargetResultEvent,
  TraceMetricsComputedEvent,
} from "../../schemas/events";
import { ExperimentAnalyticsFoldProjection } from "../experimentAnalytics.foldProjection";
import { ExperimentRunStateFoldProjection } from "../experimentRunState.foldProjection";

/**
 * ADR-034 Phase 7 parity contract — slim fold reuses the same per-event
 * semantics as `ExperimentRunStateFoldProjection` for the shared fields.
 */

const TENANT = "proj-exp-parity";

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
    id: `evt-t-${error}-${cost}`,
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

function makeEvaluator(score: number, passed: boolean): EvaluatorResultEvent {
  return {
    type: "lw.experiment_run.evaluator_result",
    id: `evt-e-${score}`,
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

function makeCompleted(): ExperimentRunCompletedEvent {
  return {
    type: "lw.experiment_run.completed",
    id: "evt-c",
    tenantId: TENANT,
    aggregateId: "run-1",
    occurredAt: 3_000,
    data: {
      runId: "run-1",
      experimentId: "exp-1",
      finishedAt: 3_000,
      stoppedAt: null,
    },
  } as unknown as ExperimentRunCompletedEvent;
}

describe("experimentAnalytics fold — parity vs experimentRunState fold", () => {
  it("agrees on every shared field after a full lifecycle", () => {
    const slim = new ExperimentAnalyticsFoldProjection({
      store: { store: async () => {}, get: async () => null },
    });
    const runFold = new ExperimentRunStateFoldProjection({
      store: { store: async () => {}, get: async () => null },
    });

    let slimState = slim.init();
    let runState = runFold.init();
    const events = [
      makeStarted(),
      makeTarget(false, 0.1),
      makeTarget(true, 0.05),
      makeTarget(false, 0.2),
      makeEvaluator(0.8, true),
      makeEvaluator(0.6, false),
      makeTraceMetrics("trace-1", 0.5),
      makeTraceMetrics("trace-1", 0.7),
      makeTraceMetrics("trace-2", 0.3),
      makeCompleted(),
    ] as const;

    for (const e of events) {
      switch (e.type) {
        case "lw.experiment_run.started":
          slimState = slim.handleExperimentRunStarted(e, slimState);
          runState = runFold.handleExperimentRunStarted(e, runState);
          break;
        case "lw.experiment_run.target_result":
          slimState = slim.handleExperimentRunTargetResult(e, slimState);
          runState = runFold.handleExperimentRunTargetResult(e, runState);
          break;
        case "lw.experiment_run.evaluator_result":
          slimState = slim.handleExperimentRunEvaluatorResult(e, slimState);
          runState = runFold.handleExperimentRunEvaluatorResult(e, runState);
          break;
        case "lw.experiment_run.trace_metrics_computed":
          slimState = slim.handleExperimentRunTraceMetricsComputed(
            e,
            slimState,
          );
          runState = runFold.handleExperimentRunTraceMetricsComputed(
            e,
            runState,
          );
          break;
        case "lw.experiment_run.completed":
          slimState = slim.handleExperimentRunCompleted(e, slimState);
          runState = runFold.handleExperimentRunCompleted(e, runState);
          break;
      }
    }

    expect(slimState.runId).toBe(runState.RunId);
    expect(slimState.experimentId).toBe(runState.ExperimentId);
    expect(slimState.workflowVersionId).toBe(runState.WorkflowVersionId);
    expect(slimState.total).toBe(runState.Total);
    expect(slimState.progress).toBe(runState.Progress);
    expect(slimState.completedCount).toBe(runState.CompletedCount);
    expect(slimState.failedCount).toBe(runState.FailedCount);
    expect(slimState.totalCost).toBe(runState.TotalCost);
    expect(slimState.totalDurationMs).toBe(runState.TotalDurationMs);
    expect(slimState.avgScoreBps).toBe(runState.AvgScoreBps);
    expect(slimState.passRateBps).toBe(runState.PassRateBps);
    expect(slimState.finishedAt).toBe(runState.FinishedAt);
    expect(slimState.stoppedAt).toBe(runState.StoppedAt);
  });
});
