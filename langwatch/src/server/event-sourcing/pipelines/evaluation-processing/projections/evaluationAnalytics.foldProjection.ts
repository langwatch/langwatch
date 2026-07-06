import { trimAttributesForAnalytics } from "~/server/event-sourcing/pipelines/trace-processing/projections/services/analytics-attribute-trim.service";
import {
  AbstractFoldProjection,
  type FoldEventHandlers,
} from "../../../projections/abstractFoldProjection";
import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import type {
  EvaluationCompletedEvent,
  EvaluationReportedEvent,
  EvaluationScheduledEvent,
  EvaluationStartedEvent,
} from "../schemas/events";
import {
  evaluationCompletedEventSchema,
  evaluationReportedEventSchema,
  evaluationScheduledEventSchema,
  evaluationStartedEventSchema,
} from "../schemas/events";

/**
 * ADR-034 Phase 6 — slim per-evaluation fold projection.
 *
 * Writes to `evaluation_analytics` (migration 00040) — a
 * `ReplacingMergeTree(UpdatedAt)` keyed on (TenantId, EvaluationId),
 * partitioned by `toYearWeek(OccurredAt)`, with a time-leading sort key
 * `(TenantId, OccurredAt, EvaluationId)` so analytics scans pull contiguous
 * granules.
 *
 * Mirrors the trace slim's two invariants:
 *
 *   1. **Hoisted dimensions** are surfaced onto typed root-level columns
 *      (EvaluatorType / EvaluatorName / Status / Passed / Score / Label /
 *      Model / TraceId / IsGuardrail). They come straight from the
 *      evaluation events themselves — the same source the
 *      `EvaluationRunFoldProjection` reads from — so the slim row matches
 *      `evaluation_runs` to the cent for the shared fields. The optional
 *      run-level dim columns (UserId / ConversationId / CustomerId / Origin)
 *      are kept Nullable and emitted as `null` from this projection;
 *      Phase 7 may lift them off the trace fold via a cross-pipeline read
 *      at write time, matching the eval alert reactor's pattern.
 *
 *   2. **Attributes map is TRIMMED** at write time via
 *      `trimAttributesForAnalytics` — the EXACT same trim service the trace
 *      slim uses (`metadata.*` ≤ 4 KiB, `langwatch.reserved.*` always kept,
 *      arbitrary keys kept iff ≤ 256 chars, payload keys dropped).
 *
 * The slim fold's in-memory state (`EvaluationAnalyticsData`) carries
 * ONLY the fields slim's handlers + the projection function read. Heavy
 * fields the `EvaluationRunFoldProjection` maintains (`inputs`,
 * `details`, `error`, `errorDetails`) are intentionally absent — the
 * bytes for those are the whole reason slim exists.
 *
 * Service / handler reuse: the eval pipeline does not have a separate
 * per-event service layer like the trace pipeline's `SpanCostService` /
 * `SpanTimingService` (the cost is stamped via the executeEvaluation
 * command, not derived from the event payload). The slim fold therefore
 * inlines the same field-extraction code the `EvaluationRunFoldProjection`
 * uses — the two projections compute identical values for the shared
 * fields by construction. A parity unit test
 * (`evaluationAnalytics.parity-vs-evaluation-run-state.unit.test.ts`)
 * locks this against drift.
 *
 * Re-fold safety (ADR-021/022): same state → same canonical projection →
 * same Version → ReplacingMergeTree collapses duplicates. No explicit
 * truncate, no settle, no signs.
 */

const evaluationAnalyticsEvents = [
  evaluationScheduledEventSchema,
  evaluationStartedEventSchema,
  evaluationCompletedEventSchema,
  evaluationReportedEventSchema,
] as const;

/** Schema-snapshot version (calendar date). Bump when the slim fold's
 *  derivation rules or trim service contract change so older versions can
 *  be replaced via re-fold. */
export const EVALUATION_ANALYTICS_PROJECTION_VERSION_LATEST =
  "2026-06-20" as const;

/**
 * The slim row that lands in `evaluation_analytics`. Field names align
 * with the ClickHouse column names (PascalCase mirrored on the camelCase
 * record so the repository's record literal is a 1:1 column mapping).
 *
 * Heavy artifacts intentionally absent (compared to `EvaluationRunData`):
 *   - `inputs` (free-form Record<string, unknown>)
 *   - `details` (free-text)
 *   - `error` / `errorDetails` (stack traces; bounded but heavy)
 *
 * What's kept: keys, OccurredAt bookkeeping, hoisted dim columns,
 * Passed/Score/Label/Status/Model/TraceId/IsGuardrail, derived DurationMs,
 * and the trimmed Attributes map.
 */
export interface EvaluationAnalyticsRow {
  tenantId: string;
  evaluationId: string;
  /** Schema-snapshot version (the LWW dedup key). */
  version: string;
  /** The eval's occurred-at (partition column + lead sort key). */
  occurredAtMs: number;
  createdAtMs: number;
  updatedAtMs: number;

  // Hoisted dimensions (typed root-level columns).
  evaluatorType: string;
  evaluatorName: string | null;
  status: string;
  isGuardrail: boolean;
  passed: boolean | null;
  score: number | null;
  label: string | null;
  model: string | null;
  traceId: string | null;
  userId: string | null;
  conversationId: string | null;
  customerId: string | null;
  origin: string | null;

  // Metric scalars.
  durationMs: number;
  totalCost: number | null;
  nonBilledCost: number | null;

  // Trimmed Attributes map (post-trimAttributesForAnalytics).
  attributes: Record<string, string>;
}

/**
 * In-memory accumulator for the slim eval fold. Carries ONLY the fields
 * slim's handlers + the projection function read/write.
 *
 * Drops the heavy fields the `EvaluationRunFoldProjection` maintains
 * (`inputs`, `details`, `error`, `errorDetails`).
 */
export interface EvaluationAnalyticsData {
  // Keys
  evaluationId: string;
  evaluatorId: string;

  // Hoisted dims
  evaluatorType: string;
  evaluatorName: string | null;
  status: "scheduled" | "in_progress" | "processed" | "error" | "skipped";
  isGuardrail: boolean;
  passed: boolean | null;
  score: number | null;
  label: string | null;
  model: string | null;
  traceId: string | null;

  // Lifecycle timestamps (drive DurationMs)
  scheduledAt: number | null;
  startedAt: number | null;
  completedAt: number | null;

  // Cost FK (slim does NOT chase Postgres for the amount; carried for
  //  future-proofing; the persisted row leaves TotalCost / NonBilledCost
  //  null in this phase).
  costId: string | null;

  // Attribute map (post-accumulation, pre-trim — trim runs at projection time)
  attributes: Record<string, string>;

  // Auto-managed by AbstractFoldProjection
  createdAt: number;
  updatedAt: number;
  LastEventOccurredAt: number;
}

/**
 * Project the in-memory slim state into the slim `EvaluationAnalyticsRow`.
 * Pure: no I/O, no external state.
 *
 * `occurredAt` is derived from `LastEventOccurredAt` so the partition
 * column always carries the latest event's timestamp (consistent with the
 * `_analytics` ORDER BY + `_analytics_rollup` BucketStart semantics).
 */
export function projectEvaluationAnalyticsStateToRow({
  state,
  tenantId,
  version,
}: {
  state: EvaluationAnalyticsData;
  tenantId: string;
  version: string;
}): EvaluationAnalyticsRow {
  const attrs = state.attributes ?? {};
  const durationMs =
    state.completedAt !== null && state.startedAt !== null
      ? Math.max(0, state.completedAt - state.startedAt)
      : 0;

  return {
    tenantId,
    evaluationId: state.evaluationId,
    version,
    occurredAtMs: state.LastEventOccurredAt,
    createdAtMs: state.createdAt,
    updatedAtMs: state.updatedAt,

    evaluatorType: state.evaluatorType,
    evaluatorName: state.evaluatorName,
    status: state.status,
    isGuardrail: state.isGuardrail,
    passed: state.passed,
    score: state.score,
    label: state.label,
    model: state.model,
    traceId: state.traceId,
    // Phase 6 leaves the trace-derived dim columns Null; a Phase 7
    // cross-pipeline hoist (mirroring the eval alert reactor) can fill them
    // without an additive schema change.
    userId: null,
    conversationId: null,
    customerId: null,
    origin: null,

    durationMs,
    // No cost-amount available off the event payload; the slim row stays
    // Null on the cost columns until eval cost is promoted onto the event
    // (or a Pg-cost-FK chase is added at fold time).
    totalCost: null,
    nonBilledCost: null,

    attributes: trimAttributesForAnalytics(attrs),
  };
}

/**
 * Merge a passthrough event metadata bag into the slim attributes map.
 * Keys arrive as `Record<string, unknown>` so we coerce to string for the
 * CH `Map(String, String)` shape. Anything non-stringifiable is dropped.
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
    // Drop non-scalar values — the trim service rejects them too.
  }
  return merged;
}

/**
 * Slim fold projection for evaluations.
 *
 * Handlers mirror `EvaluationRunFoldProjection`'s per-event logic for
 * the SHARED fields (status / score / passed / label / evaluatorType /
 * evaluatorName / traceId / isGuardrail / costId / scheduledAt / startedAt
 * / completedAt). The persisted shape is `EvaluationAnalyticsRow` —
 * projected from `EvaluationAnalyticsData` at write time by the store.
 */
export class EvaluationAnalyticsFoldProjection
  extends AbstractFoldProjection<
    EvaluationAnalyticsData,
    typeof evaluationAnalyticsEvents,
    "createdAt",
    "updatedAt",
    "LastEventOccurredAt"
  >
  implements
    FoldEventHandlers<typeof evaluationAnalyticsEvents, EvaluationAnalyticsData>
{
  readonly name = "evaluationAnalytics";
  readonly version = EVALUATION_ANALYTICS_PROJECTION_VERSION_LATEST;
  readonly store: FoldProjectionStore<EvaluationAnalyticsData>;

  protected readonly events = evaluationAnalyticsEvents;

  constructor(deps: { store: FoldProjectionStore<EvaluationAnalyticsData> }) {
    super({
      createdAtKey: "createdAt",
      updatedAtKey: "updatedAt",
      LastEventOccurredAtKey: "LastEventOccurredAt",
    });
    this.store = deps.store;
  }

  protected initState() {
    return {
      evaluationId: "",
      evaluatorId: "",
      evaluatorType: "",
      evaluatorName: null,
      status: "scheduled" as const,
      isGuardrail: false,
      passed: null,
      score: null,
      label: null,
      model: null,
      traceId: null,
      scheduledAt: null,
      startedAt: null,
      completedAt: null,
      costId: null,
      attributes: {},
    };
  }

  handleEvaluationScheduled(
    event: EvaluationScheduledEvent,
    state: EvaluationAnalyticsData,
  ): EvaluationAnalyticsData {
    return {
      ...state,
      evaluationId: event.data.evaluationId,
      evaluatorId: event.data.evaluatorId,
      evaluatorType: event.data.evaluatorType,
      evaluatorName: event.data.evaluatorName ?? null,
      traceId: event.data.traceId ?? null,
      isGuardrail: event.data.isGuardrail ?? false,
      status: "scheduled",
      scheduledAt: event.occurredAt,
      attributes: mergeEventMetadata(state.attributes, event.metadata),
    };
  }

  handleEvaluationStarted(
    event: EvaluationStartedEvent,
    state: EvaluationAnalyticsData,
  ): EvaluationAnalyticsData {
    return {
      ...state,
      evaluationId: state.evaluationId || event.data.evaluationId,
      evaluatorId: state.evaluatorId || event.data.evaluatorId,
      evaluatorType: state.evaluatorType || event.data.evaluatorType,
      evaluatorName: state.evaluatorName ?? event.data.evaluatorName ?? null,
      traceId: state.traceId ?? event.data.traceId ?? null,
      isGuardrail: event.data.isGuardrail ?? state.isGuardrail,
      status: "in_progress",
      startedAt: event.occurredAt,
      attributes: mergeEventMetadata(state.attributes, event.metadata),
    };
  }

  handleEvaluationCompleted(
    event: EvaluationCompletedEvent,
    state: EvaluationAnalyticsData,
  ): EvaluationAnalyticsData {
    return {
      ...state,
      evaluationId: state.evaluationId || event.data.evaluationId,
      status: event.data.status,
      score: typeof event.data.score === "number" ? event.data.score : null,
      passed: event.data.passed ?? null,
      label: event.data.label ?? null,
      completedAt: event.occurredAt,
      costId: event.data.costId ?? null,
      attributes: mergeEventMetadata(state.attributes, event.metadata),
    };
  }

  handleEvaluationReported(
    event: EvaluationReportedEvent,
    state: EvaluationAnalyticsData,
  ): EvaluationAnalyticsData {
    return {
      ...state,
      evaluationId: event.data.evaluationId,
      evaluatorId: event.data.evaluatorId,
      evaluatorType: event.data.evaluatorType,
      evaluatorName: event.data.evaluatorName ?? null,
      traceId: event.data.traceId ?? null,
      isGuardrail: event.data.isGuardrail ?? false,
      status: event.data.status,
      score: typeof event.data.score === "number" ? event.data.score : null,
      passed: event.data.passed ?? null,
      label: event.data.label ?? null,
      startedAt: event.occurredAt,
      completedAt: event.occurredAt,
      costId: event.data.costId ?? null,
      attributes: mergeEventMetadata(state.attributes, event.metadata),
    };
  }
}
