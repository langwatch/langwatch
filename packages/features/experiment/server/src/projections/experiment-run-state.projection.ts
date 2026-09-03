import type { FoldProjectionStore, Projection } from "@langwatch/eventing";
import { AbstractFoldProjection, type FoldEventHandlers } from "@langwatch/eventing";
import { EXPERIMENT_RUN_PROJECTION_VERSIONS } from "../adapters/eventing.experiment-run-event-types.adapter";
import type {
  EvaluatorResultEvent,
  ExperimentRunCompletedEvent,
  ExperimentRunStartedEvent,
  TargetResultEvent,
  TraceMetricsComputedEvent,
} from "../adapters/eventing.experiment-run-events.adapter";
import {
  evaluatorResultEventSchema,
  experimentRunCompletedEventSchema,
  experimentRunStartedEventSchema,
  targetResultEventSchema,
  traceMetricsComputedEventSchema,
} from "../adapters/eventing.experiment-run-events.adapter";
import { normalizeDurationMs } from "../processes/experiment-run-duration.process";

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

  // Per-trace cost breakdown from ECST (Event-Carried State Transfer)
  TraceMetrics: Record<string, { totalCost: number }>;
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
  traceMetricsComputedEventSchema,
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

  /**
   * Order-insensitive fold: every handler is a counter (`CompletedCount++`),
   * a running sum (`TotalCost`/`TotalDurationMs`/`TotalScoreSum` +=), a
   * `Math.max` (`Total`), or a keyed map that last-write-wins per key
   * (`TraceMetrics[traceId]` subtract-old/add-new, `Targets` merged by id) —
   * so the state converges to the same value whichever order events are seen
   * in. A run's aggregate is dataset-scale (one targetResult per row + one
   * evaluatorResult per row×evaluator, thousands of events), so re-folding the
   * whole history on every out-of-order event is the same O(n²) amplification
   * that hit the trace folds — pure waste here since the result is identical.
   * See specs/trace-processing/hot-trace-fold-amplification.feature.
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
      TraceMetrics: {},
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

  /**
   * A cell the run produced moves every counter. A cell the run CARRIED from
   * the board moves none of them.
   *
   * Money and time belong to the run that spent them, and the carried cell was
   * paid for by an earlier run, so adding it here reports spend that did not
   * happen. `Total` counts the cells this run dispatched, so a carried cell
   * that incremented `CompletedCount` would report the run as more than
   * finished. The carried cell is still stored, and the results page draws it;
   * it just is not this run's work.
   */
  handleExperimentRunTargetResult(
    event: TargetResultEvent,
    state: ExperimentRunStateData,
  ): ExperimentRunStateData {
    if (event.data.carriedOver) {
      return {
        ...state,
        Targets: mergeTargetsJson(state.Targets, event.data.targets ?? []),
      };
    }

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
      TotalCost: totalCost,
      TotalDurationMs: totalDurationMs,
      Targets: mergeTargetsJson(state.Targets, event.data.targets ?? []),
    };
  }

  /**
   * A verdict counts toward what the run scored whether the run produced it or
   * carried it, because the run stands for the whole board. Its cost counts
   * only when the run produced it.
   */
  handleExperimentRunEvaluatorResult(
    event: EvaluatorResultEvent,
    state: ExperimentRunStateData,
  ): ExperimentRunStateData {
    let {
      TotalScoreSum: totalScoreSum,
      ScoreCount: scoreCount,
      PassedCount: passedCount,
      GradedCount: gradedCount,
      TotalCost: totalCost,
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

    // The verdict counts, its money does not. A carried verdict describes the
    // board the run stands for, so a reader comparing two columns sees both
    // sides; the money was spent by the run that produced it.
    if (event.data.cost != null && !event.data.carriedOver) {
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

  handleExperimentRunTraceMetricsComputed(
    event: TraceMetricsComputedEvent,
    state: ExperimentRunStateData,
  ): ExperimentRunStateData {
    const traceMetrics = {
      ...state.TraceMetrics,
      [event.data.traceId]: {
        totalCost: event.data.totalCost,
      },
    };

    // Recompute TotalCost from all trace metrics
    let totalCost = state.TotalCost ?? 0;
    // If this trace was already counted, subtract the old value
    const existingEntry = state.TraceMetrics[event.data.traceId];
    if (existingEntry) {
      totalCost -= existingEntry.totalCost;
    }
    totalCost += event.data.totalCost;

    return {
      ...state,
      TraceMetrics: traceMetrics,
      TotalCost: totalCost > 0 ? Number(totalCost.toFixed(6)) : null,
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
