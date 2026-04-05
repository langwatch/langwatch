import type { Projection } from "../../../";
import {
  AbstractFoldProjection,
  type FoldEventHandlers,
} from "../../../projections/abstractFoldProjection";
import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import { EXPERIMENT_RUN_PROJECTION_VERSIONS } from "../schemas/constants";
import type {
  ExperimentRunStartedEvent,
  TargetResultEvent,
  EvaluatorResultEvent,
  ExperimentRunCompletedEvent,
} from "../schemas/events";
import {
  experimentRunStartedEventSchema,
  targetResultEventSchema,
  evaluatorResultEventSchema,
  experimentRunCompletedEventSchema,
} from "../schemas/events";

/**
 * State data for an experiment run.
 * Matches the experiment_runs ClickHouse table schema.
 *
 * This is both the fold state and the stored data — one type, not two.
 * Handlers do all computation using simple counters (no Sets/arrays).
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
  CreatedAt: number;
  UpdatedAt: number;
  LastEventOccurredAt: number;
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

// Keep in sync with the Painless merge script in elasticsearchBatchEvaluation.repository.ts
function mergeTargetsJson(
  existingJson: string,
  incoming: Array<{ id: string; [k: string]: unknown }>,
): string {
  if (incoming.length === 0) return existingJson;

  let existing: Array<{ id: string; [k: string]: unknown }> = [];
  try {
    existing = JSON.parse(existingJson);
  } catch {
    // keep empty
  }

  const byId = new Map(existing.map((t) => [t.id, t]));
  for (const t of incoming) {
    byId.set(t.id, t);
  }

  return JSON.stringify(Array.from(byId.values()));
}

const experimentRunEvents = [
  experimentRunStartedEventSchema,
  targetResultEventSchema,
  evaluatorResultEventSchema,
  experimentRunCompletedEventSchema,
] as const;

/**
 * Type-safe fold projection for experiment run state.
 *
 * - `implements FoldEventHandlers` enforces a handler exists for every event schema
 * - Handler names derived from event type strings (e.g. `"lw.experiment_run.started"` -> `handleExperimentRunStarted`)
 * - `UpdatedAt` is auto-managed by the base class after each handler call
 */
export class ExperimentRunStateFoldProjection
  extends AbstractFoldProjection<ExperimentRunStateData, typeof experimentRunEvents>
  implements FoldEventHandlers<typeof experimentRunEvents, ExperimentRunStateData>
{
  readonly name = "experimentRunState";
  readonly version = EXPERIMENT_RUN_PROJECTION_VERSIONS.RUN_STATE;
  readonly store: FoldProjectionStore<ExperimentRunStateData>;

  protected readonly events = experimentRunEvents;

  constructor(deps: { store: FoldProjectionStore<ExperimentRunStateData> }) {
    super();
    this.store = deps.store;
  }

  protected initState() {
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

  handleExperimentRunStarted(
    event: ExperimentRunStartedEvent,
    state: ExperimentRunStateData,
  ): ExperimentRunStateData {
    return {
      ...state,
      RunId: event.data.runId,
      ExperimentId: event.data.experimentId,
      WorkflowVersionId: event.data.workflowVersionId ?? null,
      Total: Math.max(state.Total, event.data.total),
      Targets: mergeTargetsJson(state.Targets, event.data.targets ?? []),
      StartedAt: state.StartedAt ?? event.occurredAt,
    };
  }

  handleExperimentRunTargetResult(
    event: TargetResultEvent,
    state: ExperimentRunStateData,
  ): ExperimentRunStateData {
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
      Targets: mergeTargetsJson(state.Targets, event.data.targets ?? []),
    };
  }

  handleExperimentRunEvaluatorResult(
    event: EvaluatorResultEvent,
    state: ExperimentRunStateData,
  ): ExperimentRunStateData {
    let { TotalScoreSum: totalScoreSum, ScoreCount: scoreCount, PassedCount: passedCount, GradedCount: gradedCount, TotalCost: totalCost } = state;

    if (event.data.status === "processed") {
      if (event.data.score != null) {
        totalScoreSum += Math.round(event.data.score * 10000);
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

    const avgScoreBps = scoreCount > 0 ? Math.round(totalScoreSum / scoreCount) : null;
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

  handleExperimentRunCompleted(
    event: ExperimentRunCompletedEvent,
    state: ExperimentRunStateData,
  ): ExperimentRunStateData {
    return {
      ...state,
      FinishedAt: event.data.finishedAt ?? null,
      StoppedAt: event.data.stoppedAt ?? null,
    };
  }
}
