import { trimAttributesForAnalytics } from "~/server/event-sourcing/pipelines/trace-processing/projections/services/analytics-attribute-trim.service";
import {
  AbstractFoldProjection,
  type FoldEventHandlers,
} from "../../../projections/abstractFoldProjection";
import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import { normalizeDurationMs } from "../utils/duration.utils";
import type {
  EvaluatorResultEvent,
  ExperimentRunCompletedEvent,
  ExperimentRunStartedEvent,
  TargetResultEvent,
  TraceMetricsComputedEvent,
} from "../schemas/events";
import {
  evaluatorResultEventSchema,
  experimentRunCompletedEventSchema,
  experimentRunStartedEventSchema,
  targetResultEventSchema,
  traceMetricsComputedEventSchema,
} from "../schemas/events";

/**
 * ADR-034 Phase 7 — slim per-experiment-run fold projection.
 *
 * Writes to `experiment_analytics` (migration 00044) — a
 * `ReplacingMergeTree(UpdatedAt)` keyed on (TenantId, RunId), partitioned by
 * `toYearWeek(OccurredAt)`, with a time-leading sort key
 * `(TenantId, OccurredAt, RunId)` so analytics scans pull contiguous granules.
 *
 * Mirrors the trace + eval slim's two invariants:
 *
 *   1. **Hoisted dimensions** are surfaced onto typed root-level columns
 *      (ExperimentId / WorkflowVersionId / CompletionMode). They come straight
 *      from the experiment events themselves — the same source the
 *      `ExperimentRunStateFoldProjection` reads from — so the slim row
 *      matches `experiment_runs` to the cent for the shared fields.
 *
 *   2. **Attributes map is TRIMMED** at write time via
 *      `trimAttributesForAnalytics` — the EXACT same trim service the trace +
 *      eval slim use.
 *
 * The slim fold's in-memory state (`ExperimentAnalyticsData`) carries
 * ONLY the fields slim's handlers + the projection function read. Heavy
 * fields the `ExperimentRunStateFoldProjection` maintains (Targets JSON,
 * TotalScoreSum / ScoreCount / PassedCount / GradedCount raw counters,
 * per-trace TraceMetrics breakdown) are intentionally absent — the bytes
 * for the Targets blob are the whole reason slim exists, and the raw
 * counters are replaced on the slim row by the DERIVED `AvgScoreBps` /
 * `PassRateBps` that the legacy fold projects.
 *
 * Re-fold safety (ADR-021/022): same state → same canonical projection →
 * same Version → ReplacingMergeTree collapses duplicates. No explicit
 * truncate, no settle, no signs.
 */

const experimentAnalyticsEvents = [
  experimentRunStartedEventSchema,
  targetResultEventSchema,
  evaluatorResultEventSchema,
  traceMetricsComputedEventSchema,
  experimentRunCompletedEventSchema,
] as const;

/** Schema-snapshot version (calendar date). Bump when the slim fold's
 *  derivation rules or trim service contract change so older versions can
 *  be replaced via re-fold. */
export const EXPERIMENT_ANALYTICS_PROJECTION_VERSION_LATEST =
  "2026-06-20" as const;

/**
 * The slim row that lands in `experiment_analytics`. Field names align with
 * the ClickHouse column names (PascalCase mirrored on the camelCase record so
 * the repository's record literal is a 1:1 column mapping).
 *
 * Heavy artifacts intentionally absent (compared to `ExperimentRunStateData`):
 *   - `Targets` (per-row target JSON blob)
 *   - `TotalScoreSum` / `ScoreCount` / `PassedCount` / `GradedCount` (raw
 *     counters — slim carries the DERIVED `AvgScoreBps` / `PassRateBps` only)
 *   - `TraceMetrics` (per-trace cost breakdown — slim carries the scalar
 *     `TotalCost` only)
 */
export interface ExperimentAnalyticsRow {
  tenantId: string;
  runId: string;
  /** Schema-snapshot version (the LWW dedup key counterpart). */
  version: string;
  /** The run's occurred-at (partition column + lead sort key). */
  occurredAtMs: number;
  createdAtMs: number;
  updatedAtMs: number;

  // Hoisted dimensions (typed root-level columns).
  experimentId: string;
  workflowVersionId: string | null;
  completionMode: string;

  // Metric scalars.
  total: number;
  progress: number;
  completedCount: number;
  failedCount: number;
  totalCost: number | null;
  totalDurationMs: number | null;
  avgScoreBps: number | null;
  passRateBps: number | null;

  // Trimmed Attributes map (post-trimAttributesForAnalytics).
  attributes: Record<string, string>;
}

/**
 * In-memory accumulator for the slim experiment fold. Carries ONLY the fields
 * slim's handlers + the projection function read/write.
 */
export interface ExperimentAnalyticsData {
  // Keys
  runId: string;
  experimentId: string;
  workflowVersionId: string | null;

  // Lifecycle
  startedAt: number | null;
  finishedAt: number | null;
  stoppedAt: number | null;

  // Aggregated metrics (mirrored from the legacy fold's same-named fields)
  total: number;
  progress: number;
  completedCount: number;
  failedCount: number;
  totalCost: number | null;
  totalDurationMs: number | null;
  avgScoreBps: number | null;
  passRateBps: number | null;

  // Raw counters — needed so the slim fold matches the legacy fold's derived
  // values to the cent. Not persisted to the slim row; replaced on the row
  // by the derived `avgScoreBps` / `passRateBps`.
  totalScoreSum: number;
  scoreCount: number;
  passedCount: number;
  gradedCount: number;

  /**
   * Per-trace cost breakdown the legacy fold tracks. Slim keeps the SCALAR
   * `totalCost` on the row, but needs the per-trace cache so re-delivered
   * `TraceMetricsComputedEvent` for the SAME traceId replaces (not
   * accumulates) — matching the legacy fold's semantics so `TotalCost` stays
   * equal across the two folds. Not persisted to the slim row.
   */
  traceMetrics: Record<string, { totalCost: number }>;

  // Attribute map (post-accumulation, pre-trim — trim runs at projection time)
  attributes: Record<string, string>;

  // Auto-managed by AbstractFoldProjection
  createdAt: number;
  updatedAt: number;
  LastEventOccurredAt: number;
}

/**
 * Derive `CompletionMode` from the disjoint lifecycle timestamps. Mirrors the
 * rollup map projection's discrimination so the slim row's `CompletionMode`
 * matches the rollup row's for the same run.
 */
function deriveCompletionMode(
  finishedAt: number | null,
  stoppedAt: number | null,
): string {
  if (typeof finishedAt === "number") return "finished";
  if (typeof stoppedAt === "number") return "stopped";
  return "";
}

/**
 * Project the in-memory slim state into the slim `ExperimentAnalyticsRow`.
 * Pure: no I/O, no external state.
 */
export function projectExperimentAnalyticsStateToRow({
  state,
  tenantId,
  version,
}: {
  state: ExperimentAnalyticsData;
  tenantId: string;
  version: string;
}): ExperimentAnalyticsRow {
  const attrs = state.attributes ?? {};
  return {
    tenantId,
    runId: state.runId,
    version,
    occurredAtMs: state.LastEventOccurredAt,
    createdAtMs: state.createdAt,
    updatedAtMs: state.updatedAt,

    experimentId: state.experimentId,
    workflowVersionId: state.workflowVersionId,
    completionMode: deriveCompletionMode(state.finishedAt, state.stoppedAt),

    total: state.total,
    progress: state.progress,
    completedCount: state.completedCount,
    failedCount: state.failedCount,
    totalCost: state.totalCost,
    totalDurationMs: state.totalDurationMs,
    avgScoreBps: state.avgScoreBps,
    passRateBps: state.passRateBps,

    attributes: trimAttributesForAnalytics(attrs),
  };
}

/**
 * Merge a passthrough event metadata bag into the slim attributes map.
 */
function mergeEventMetadata(
  attributes: Record<string, string>,
  metadata: Record<string, unknown> | undefined,
): Record<string, string> {
  if (!metadata) return attributes;
  let merged = attributes;
  let copied = false;
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value === "string") {
      if (!copied) {
        merged = { ...merged };
        copied = true;
      }
      merged[key] = value;
      continue;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      if (!copied) {
        merged = { ...merged };
        copied = true;
      }
      merged[key] = String(value);
    }
  }
  return merged;
}

/**
 * Slim fold projection for experiments.
 *
 * Handlers mirror `ExperimentRunStateFoldProjection`'s per-event logic for
 * the SHARED fields. The persisted shape is `ExperimentAnalyticsRow` —
 * projected from `ExperimentAnalyticsData` at write time by the store.
 */
export class ExperimentAnalyticsFoldProjection
  extends AbstractFoldProjection<
    ExperimentAnalyticsData,
    typeof experimentAnalyticsEvents,
    "createdAt",
    "updatedAt",
    "LastEventOccurredAt"
  >
  implements
    FoldEventHandlers<
      typeof experimentAnalyticsEvents,
      ExperimentAnalyticsData
    >
{
  readonly name = "experimentAnalytics";
  readonly version = EXPERIMENT_ANALYTICS_PROJECTION_VERSION_LATEST;
  readonly store: FoldProjectionStore<ExperimentAnalyticsData>;

  protected readonly events = experimentAnalyticsEvents;

  constructor(deps: { store: FoldProjectionStore<ExperimentAnalyticsData> }) {
    super({
      createdAtKey: "createdAt",
      updatedAtKey: "updatedAt",
      LastEventOccurredAtKey: "LastEventOccurredAt",
    });
    this.store = deps.store;
  }

  protected initState() {
    return {
      runId: "",
      experimentId: "",
      workflowVersionId: null,
      startedAt: null,
      finishedAt: null,
      stoppedAt: null,
      total: 0,
      progress: 0,
      completedCount: 0,
      failedCount: 0,
      totalCost: null,
      totalDurationMs: null,
      avgScoreBps: null,
      passRateBps: null,
      totalScoreSum: 0,
      scoreCount: 0,
      passedCount: 0,
      gradedCount: 0,
      traceMetrics: {},
      attributes: {},
    };
  }

  handleExperimentRunStarted(
    event: ExperimentRunStartedEvent,
    state: ExperimentAnalyticsData,
  ): ExperimentAnalyticsData {
    return {
      ...state,
      runId: event.data.runId,
      experimentId: event.data.experimentId,
      workflowVersionId: event.data.workflowVersionId ?? null,
      total: Math.max(state.total, event.data.total),
      startedAt: state.startedAt ?? event.occurredAt,
      attributes: mergeEventMetadata(state.attributes, event.metadata),
    };
  }

  handleExperimentRunTargetResult(
    event: TargetResultEvent,
    state: ExperimentAnalyticsData,
  ): ExperimentAnalyticsData {
    let completedCount = state.completedCount;
    let failedCount = state.failedCount;

    if (event.data.error) {
      failedCount += 1;
    } else {
      completedCount += 1;
    }

    let totalCost = state.totalCost;
    if (event.data.cost != null) {
      totalCost = (totalCost ?? 0) + event.data.cost;
    }

    let totalDurationMs = state.totalDurationMs;
    const clampedDuration = normalizeDurationMs(event.data.duration);
    if (clampedDuration != null) {
      totalDurationMs = (totalDurationMs ?? 0) + clampedDuration;
    }

    const progress = completedCount + failedCount;

    return {
      ...state,
      runId: state.runId || event.data.runId,
      experimentId: state.experimentId || event.data.experimentId,
      completedCount,
      failedCount,
      progress,
      totalCost,
      totalDurationMs,
      attributes: mergeEventMetadata(state.attributes, event.metadata),
    };
  }

  handleExperimentRunEvaluatorResult(
    event: EvaluatorResultEvent,
    state: ExperimentAnalyticsData,
  ): ExperimentAnalyticsData {
    let {
      totalScoreSum,
      scoreCount,
      passedCount,
      gradedCount,
      totalCost,
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

    if (event.data.cost != null) {
      totalCost = (totalCost ?? 0) + event.data.cost;
    }

    const avgScoreBps =
      scoreCount > 0 ? Math.round(totalScoreSum / scoreCount) : null;
    const passRateBps =
      gradedCount > 0
        ? Math.round((passedCount / gradedCount) * 10000)
        : null;

    return {
      ...state,
      runId: state.runId || event.data.runId,
      experimentId: state.experimentId || event.data.experimentId,
      totalScoreSum,
      scoreCount,
      passedCount,
      gradedCount,
      totalCost,
      avgScoreBps,
      passRateBps,
      attributes: mergeEventMetadata(state.attributes, event.metadata),
    };
  }

  handleExperimentRunTraceMetricsComputed(
    event: TraceMetricsComputedEvent,
    state: ExperimentAnalyticsData,
  ): ExperimentAnalyticsData {
    // Mirror legacy fold semantics: replace per-trace cost on re-delivery
    // (not accumulate) so TotalCost matches `experiment_runs.TotalCost`.
    let totalCost = state.totalCost ?? 0;
    const existing = state.traceMetrics[event.data.traceId];
    if (existing) {
      totalCost -= existing.totalCost;
    }
    totalCost += event.data.totalCost;
    const traceMetrics = {
      ...state.traceMetrics,
      [event.data.traceId]: { totalCost: event.data.totalCost },
    };
    return {
      ...state,
      runId: state.runId || event.data.runId,
      experimentId: state.experimentId || event.data.experimentId,
      traceMetrics,
      totalCost: totalCost > 0 ? Number(totalCost.toFixed(6)) : null,
    };
  }

  handleExperimentRunCompleted(
    event: ExperimentRunCompletedEvent,
    state: ExperimentAnalyticsData,
  ): ExperimentAnalyticsData {
    return {
      ...state,
      runId: state.runId || event.data.runId,
      experimentId: state.experimentId || event.data.experimentId,
      finishedAt: event.data.finishedAt ?? null,
      stoppedAt: event.data.stoppedAt ?? null,
    };
  }
}
