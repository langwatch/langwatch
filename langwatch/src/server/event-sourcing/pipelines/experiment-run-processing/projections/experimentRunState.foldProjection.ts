import type { Projection } from "../../../";
import {
  AbstractFoldProjection,
  type FoldEventHandlers,
} from "../../../projections/abstractFoldProjection";
import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import { EXPERIMENT_RUN_PROJECTION_VERSIONS } from "../schemas/constants";
import type {
  EvaluatorResultEvent,
  ExperimentRunCompletedEvent,
  ExperimentRunStartedEvent,
  TargetResultEvent,
} from "../schemas/events";
import {
  evaluatorResultEventSchema,
  experimentRunCompletedEventSchema,
  experimentRunStartedEventSchema,
  targetResultEventSchema,
} from "../schemas/events";
import { normalizeDurationMs } from "../utils/duration.utils";

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

// Keep in sync with the target-merging logic in the ClickHouse experiment_runs projection store.
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
  extends AbstractFoldProjection<
    ExperimentRunStateData,
    typeof experimentRunEvents
  >
  implements
    FoldEventHandlers<typeof experimentRunEvents, ExperimentRunStateData>
{
  readonly name = "experimentRunState";
  readonly version = EXPERIMENT_RUN_PROJECTION_VERSIONS.RUN_STATE;
  readonly store: FoldProjectionStore<ExperimentRunStateData>;

  /**
   * Order-insensitive fold: every handler is a counter (`CompletedCount++`),
   * a running sum (`TotalDurationMs`/`TotalScoreSum` +=), a `Math.max`
   * (`Total`), or a keyed map that last-write-wins per key (`Targets` merged
   * by id) — so the state converges to the same value whichever order events
   * are seen in. A run's aggregate is dataset-scale (one targetResult per row
   * + one evaluatorResult per row×evaluator, thousands of events), so
   * re-folding the whole history on every out-of-order event is the same O(n²)
   * amplification that hit the trace folds — pure waste here since the result
   * is identical.
   * See specs/event-sourcing/hot-trace-fold-amplification.feature.
   *
   * Cost is deliberately absent. It used to be a running sum fed partly by a
   * per-trace map that was never persisted, which made the fold diverge on a
   * cache miss and again on replay. It is now summed from
   * `experiment_run_items` at read time — see ADR-061.
   */
  readonly options = { refoldOnOutOfOrder: false } as const;

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

    let totalDurationMs = state.TotalDurationMs;
    const clampedDuration = normalizeDurationMs(event.data.duration);
    if (clampedDuration != null) {
      totalDurationMs = (totalDurationMs ?? 0) + clampedDuration;
    }

    const progress = completedCount + failedCount;

    return {
      ...state,
      CompletedCount: completedCount,
      FailedCount: failedCount,
      Progress: progress,
      TotalDurationMs: totalDurationMs,
      Targets: mergeTargetsJson(state.Targets, event.data.targets ?? []),
    };
  }

  handleExperimentRunEvaluatorResult(
    event: EvaluatorResultEvent,
    state: ExperimentRunStateData,
  ): ExperimentRunStateData {
    let {
      TotalScoreSum: totalScoreSum,
      ScoreCount: scoreCount,
      PassedCount: passedCount,
      GradedCount: gradedCount,
    } = state;

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

    const avgScoreBps =
      scoreCount > 0 ? Math.round(totalScoreSum / scoreCount) : null;
    const passRateBps =
      gradedCount > 0 ? Math.round((passedCount / gradedCount) * 10000) : null;

    return {
      ...state,
      TotalScoreSum: totalScoreSum,
      ScoreCount: scoreCount,
      PassedCount: passedCount,
      GradedCount: gradedCount,
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
