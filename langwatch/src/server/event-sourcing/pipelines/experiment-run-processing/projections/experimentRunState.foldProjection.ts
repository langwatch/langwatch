import type { Projection } from "../../../";
import type { FoldProjectionDefinition, FoldProjectionStore } from "../../../projections/foldProjection.types";
import { EXPERIMENT_RUN_PROCESSING_EVENT_TYPES, EXPERIMENT_RUN_PROJECTION_VERSIONS } from "../schemas/constants";
import type { ExperimentRunProcessingEvent } from "../schemas/events";
import {
	isEvaluatorResultEvent,
	isExperimentRunCompletedEvent,
	isExperimentRunStartedEvent,
	isTargetResultEvent,
} from "../schemas/events";

/**
 * State data for an experiment run.
 * Matches the experiment_runs ClickHouse table schema.
 *
 * This is both the fold state and the stored data — one type, not two.
 * `apply()` does all computation using simple counters (no Sets/arrays).
 * Store is a dumb read/write layer.
 */
export interface ExperimentRunStateData {
  RunId: string;
  ExperimentId: string;
  WorkflowVersionId: string | null;
  Total: number;
  Progress: number;
  CompletedCount: number;
  FailedCount: number;
  TotalCost: number | null;
  TotalDurationMs: number | null;
  AvgScoreBps: number | null;
  PassRateBps: number | null;
  Targets: string;
  StartedAt: number | null;
  FinishedAt: number | null;
  StoppedAt: number | null;

  // Raw counters for incremental aggregation
  TotalScoreSum: number;
  ScoreCount: number;
  PassedCount: number;
  GradedCount: number;
}

export interface ExperimentRunState extends Projection<ExperimentRunStateData> {
  data: ExperimentRunStateData;
}

function init(): ExperimentRunStateData {
  return {
    RunId: "",
    ExperimentId: "",
    WorkflowVersionId: null,
    Total: 0,
    Progress: 0,
    CompletedCount: 0,
    FailedCount: 0,
    TotalCost: null,
    TotalDurationMs: null,
    AvgScoreBps: null,
    PassRateBps: null,
    Targets: "[]",
    StartedAt: null,
    FinishedAt: null,
    StoppedAt: null,
    TotalScoreSum: 0,
    ScoreCount: 0,
    PassedCount: 0,
    GradedCount: 0,
  };
}

function apply(
  state: ExperimentRunStateData,
  event: ExperimentRunProcessingEvent,
): ExperimentRunStateData {
  if (isExperimentRunStartedEvent(event)) {
    return {
      ...state,
      RunId: event.data.runId,
      ExperimentId: event.data.experimentId,
      WorkflowVersionId: event.data.workflowVersionId ?? null,
      Total: Math.max(state.Total, event.data.total),
      Targets: JSON.stringify(event.data.targets),
      StartedAt: state.StartedAt ?? event.occurredAt,
    };
  }

  if (isTargetResultEvent(event)) {
    let completedCount = state.CompletedCount;
    let failedCount = state.FailedCount;

    if (event.data.error) {
      failedCount += 1;
    } else {
      completedCount += 1;
    }

    let totalCost = state.TotalCost;
    if (event.data.cost != null) {
      totalCost = (totalCost ?? 0) + event.data.cost;
    }

    let totalDurationMs = state.TotalDurationMs;
    if (event.data.duration != null) {
      totalDurationMs = (totalDurationMs ?? 0) + event.data.duration;
    }

    const progress = completedCount + failedCount;

    return {
      ...state,
      CompletedCount: completedCount,
      FailedCount: failedCount,
      Progress: progress,
      TotalCost: totalCost,
      TotalDurationMs: totalDurationMs,
    };
  }

  if (isEvaluatorResultEvent(event)) {
    let { TotalScoreSum: totalScoreSum, ScoreCount: scoreCount, PassedCount: passedCount, GradedCount: gradedCount, TotalCost: totalCost } = state;

    if (event.data.status === "processed") {
      if (event.data.score != null) {
        totalScoreSum += event.data.score;
        scoreCount += 1;
      }
      if (event.data.passed != null) {
        gradedCount += 1;
        if (event.data.passed) passedCount += 1;
      }
    }

    if (event.data.cost != null) {
      totalCost = (totalCost ?? 0) + event.data.cost;
    }

    const avgScoreBps = scoreCount > 0 ? Math.round((totalScoreSum / scoreCount) * 10000) : null;
    const passRateBps = gradedCount > 0 ? Math.round((passedCount / gradedCount) * 10000) : null;

    return {
      ...state,
      TotalScoreSum: totalScoreSum,
      ScoreCount: scoreCount,
      PassedCount: passedCount,
      GradedCount: gradedCount,
      TotalCost: totalCost,
      AvgScoreBps: avgScoreBps,
      PassRateBps: passRateBps,
    };
  }

  if (isExperimentRunCompletedEvent(event)) {
    return {
      ...state,
      FinishedAt: event.data.finishedAt ?? null,
      StoppedAt: event.data.stoppedAt ?? null,
    };
  }

  return state;
}

/**
 * Creates FoldProjection definition for experiment run state.
 *
 * Fold state = stored data. Uses simple counters instead of Sets/arrays
 * so state round-trips through the store without loss.
 */
export function createExperimentRunStateFoldProjection(deps: {
  store: FoldProjectionStore<ExperimentRunStateData>;
}): FoldProjectionDefinition<ExperimentRunStateData, ExperimentRunProcessingEvent> {
  return {
    name: "experimentRunState",
    version: EXPERIMENT_RUN_PROJECTION_VERSIONS.RUN_STATE,
    eventTypes: EXPERIMENT_RUN_PROCESSING_EVENT_TYPES,
    init,
    apply,
    store: deps.store,
  };
}
