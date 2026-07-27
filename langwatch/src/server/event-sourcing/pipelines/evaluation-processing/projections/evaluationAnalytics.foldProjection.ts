import { createLogger } from "@langwatch/observability";
import { trimAttributesForAnalytics } from "~/server/event-sourcing/pipelines/trace-processing/projections/services/analytics-attribute-trim.service";
import {
  AbstractFoldProjection,
  type FoldEventHandlers,
} from "../../../projections/abstractFoldProjection";
import type {
  FoldProjectionOptions,
  FoldProjectionStore,
} from "../../../projections/foldProjection.types";
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
 * Writes to `evaluation_analytics` (migration 00041) — a
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

const logger = createLogger(
  "langwatch:event-sourcing:evaluation-processing:evaluation-analytics-fold",
);

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
 * How far an evaluation's OccurredAt (the partition column) may sit from the
 * business time a read is anchored on. The scheduled→started→completed
 * lifecycle is usually seconds-minutes, but a late report can trail, so the
 * read-back window is ±7 days. Declared once, on the fold; the executor derives
 * `context.readWindow` from it and retries a windowed miss unwindowed.
 */
export const EVALUATION_ANALYTICS_READ_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

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

  // ── Read-back state (ADR-066, migration 00056) ─────────────────────────
  // Not analytics columns — the lifecycle operands DurationMs was derived
  // from. The row persisted the derived DurationMs but not startedAt/completedAt
  // themselves, so a `completed` event arriving after a cache miss could not
  // recompute a non-zero duration. Epoch ms; null (0 on the wire) = "not yet".
  startedAtMs: number | null;
  completedAtMs: number | null;
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

    // Read-back state (ADR-066) — the operands DurationMs is derived from.
    startedAtMs: state.startedAt,
    completedAtMs: state.completedAt,
  };
}

/**
 * Decode the fold's working state from its persisted `evaluation_analytics`
 * row — the `fromRow` inverse of {@link projectEvaluationAnalyticsStateToRow}
 * (ADR-066).
 *
 * This is a deserialize, NOT a rebuild. A rebuild replays the evaluation's
 * lifecycle events from `event_log`; this only maps the last committed slim
 * row's columns back into state, so `store.get()` returns the state Redis (or,
 * on a miss, ClickHouse) already holds. It derives nothing.
 *
 * The trimmed Attributes map is a faithful read-back for this fold: unlike the
 * trace fold, the eval fold never READS `state.attributes` — its handlers only
 * merge fresh event metadata IN (`mergeEventMetadata`) — so no derived value
 * depends on a key the trim might drop.
 *
 * Three state fields carry no persisted column and default here with no
 * correctness loss: `evaluatorId` (feeds no projected column; `evaluationId`,
 * always present as the key, drives the store's persistable-signal),
 * `scheduledAt` (never read for a derived value), and `costId` (future
 * plumbing; TotalCost/NonBilledCost stay null this phase). `LastEventOccurredAt`
 * reconstructs from OccurredAt — for this fold the partition column IS the
 * latest event time (`occurredAtMs: state.LastEventOccurredAt` on write).
 *
 * A pre-migration row (00056 columns absent) decodes with StartedAt/CompletedAt
 * null and an empty applied set — never a refold.
 */
export function evaluationAnalyticsStateFromRow(
  row: EvaluationAnalyticsRow,
): EvaluationAnalyticsData {
  // Unreachable for a same-version writer, but read-back is explicitly
  // mixed-deploy safe: a newer node can persist a status this build does not
  // know yet. Coercing keeps the delivery path total (never throw on a decode),
  // but the coercion is NOT self-healing — read-back never replays event_log, so
  // the next fold writes the downgrade over the real terminal state. Log it so
  // the mixed-deploy window is detectable rather than silent.
  const isKnownStatus = EVALUATION_STATUS_VALUES.has(
    row.status as EvaluationAnalyticsData["status"],
  );
  if (!isKnownStatus) {
    logger.warn(
      {
        tenantId: row.tenantId,
        evaluationId: row.evaluationId,
        status: row.status,
      },
      "evaluation_analytics read-back saw an unknown status; coercing to scheduled",
    );
  }
  const status: EvaluationAnalyticsData["status"] = isKnownStatus
    ? (row.status as EvaluationAnalyticsData["status"])
    : "scheduled";

  return {
    evaluationId: row.evaluationId,
    // Not persisted — feeds no projected column; re-populated by later events.
    evaluatorId: "",

    evaluatorType: row.evaluatorType,
    evaluatorName: row.evaluatorName,
    status,
    isGuardrail: row.isGuardrail,
    passed: row.passed,
    score: row.score,
    label: row.label,
    model: row.model,
    traceId: row.traceId,

    // Not read for any derived value — defaults, documented above.
    scheduledAt: null,
    startedAt: row.startedAtMs,
    completedAt: row.completedAtMs,

    costId: null,

    attributes: row.attributes,

    createdAt: row.createdAtMs,
    updatedAt: row.updatedAtMs,
    LastEventOccurredAt: row.occurredAtMs,
  };
}

/** The valid `status` union values, for the read-back guard. */
const EVALUATION_STATUS_VALUES: ReadonlySet<
  EvaluationAnalyticsData["status"]
> = new Set(["scheduled", "in_progress", "processed", "error", "skipped"]);

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

  /**
   * The store reads its own last committed state back (ADR-066): the row now
   * round-trips the lifecycle timestamps DurationMs is derived from (StartedAt /
   * CompletedAt, migration 00056), so `store.get()` returns the state and
   * nothing on the delivery path reads `event_log`.
   *
   * `refoldOnStoreMiss` is gone — there is no null-returning miss to refold; a
   * cache miss is a one-row ClickHouse read (windowed by `readWindow`, retried
   * unwindowed by the executor).
   *
   * `refoldOnOutOfOrder: false` — the derivation is order-insensitive: identity
   * and terminal fields are last-write-wins, lifecycle timestamps are set once
   * by their own stage, and DurationMs is computed from the loaded operands. A
   * late lifecycle event folds onto the loaded state in place; no history replay
   * derives anything. `eventOrdering: "acceptedAt"` keeps the accepted
   * transition order authoritative for LWW even under a backdated business time.
   */
  override options: FoldProjectionOptions = {
    eventOrdering: "acceptedAt",
    refoldOnOutOfOrder: false,
    readWindow: { widthMs: EVALUATION_ANALYTICS_READ_WINDOW_MS },
  };

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
