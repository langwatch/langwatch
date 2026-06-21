import { trimAttributesForAnalytics } from "~/server/event-sourcing/pipelines/trace-processing/projections/services/analytics-attribute-trim.service";
import {
  AbstractFoldProjection,
  type FoldEventHandlers,
} from "../../../projections/abstractFoldProjection";
import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import type {
  SimulationRunDeletedEvent,
  SimulationRunFinishedEvent,
  SimulationRunMetricsComputedEvent,
  SimulationRunQueuedEvent,
  SimulationRunStartedEvent,
} from "../schemas/events";
import {
  SimulationRunDeletedEventSchema,
  SimulationRunFinishedEventSchema,
  SimulationRunMetricsComputedEventSchema,
  SimulationRunQueuedEventSchema,
  SimulationRunStartedEventSchema,
} from "../schemas/events";

/**
 * ADR-034 Phase 7 — slim per-simulation-run fold projection.
 *
 * Writes to `simulation_analytics` (migration 00041) — a
 * `ReplacingMergeTree(UpdatedAt)` keyed on (TenantId, ScenarioRunId),
 * partitioned by `toYearWeek(OccurredAt)`, with a time-leading sort key
 * `(TenantId, OccurredAt, ScenarioRunId)` so analytics scans pull
 * contiguous granules.
 *
 * Mirrors the trace + eval slim's two invariants:
 *
 *   1. **Hoisted dimensions** are surfaced onto typed root-level columns
 *      (ScenarioId / BatchRunId / ScenarioSetId / Status / Verdict). They
 *      come straight from the simulation events themselves — the same
 *      source the `SimulationRunStateFoldProjection` reads from — so the
 *      slim row matches `simulation_runs` to the cent for the shared
 *      fields.
 *
 *   2. **Attributes map is TRIMMED** at write time via
 *      `trimAttributesForAnalytics` — the EXACT same trim service the
 *      trace / eval slim use.
 *
 * The slim fold's in-memory state (`SimulationAnalyticsData`) carries
 * ONLY the fields slim's handlers + the projection function read. Heavy
 * fields the `SimulationRunStateFoldProjection` maintains (Messages,
 * TraceIds, Reasoning, Error, MetCriteria, UnmetCriteria, TraceMetrics,
 * RoleCosts, RoleLatencies, Metadata, Name, Description) are intentionally
 * absent — the bytes for those are the whole reason slim exists.
 *
 * Re-fold safety (ADR-021/022): same state → same canonical projection →
 * same Version → ReplacingMergeTree collapses duplicates. No explicit
 * truncate, no settle, no signs.
 *
 * Skips:
 *   * `SimulationMessageSnapshotEvent` / `SimulationTextMessageStart` /
 *     `SimulationTextMessageEnd` — only affect dropped (Messages) fields.
 *   * `SimulationRunCancelRequestedEvent` — only affects a dropped
 *     CancellationRequestedAt bookkeeping field; the slim row's Status
 *     stays whatever the latest terminal event set.
 *   * `SimulationSetArchivedEvent` — operates on a different aggregate
 *     (the set), not the run.
 */

const simulationAnalyticsEvents = [
  SimulationRunQueuedEventSchema,
  SimulationRunStartedEventSchema,
  SimulationRunFinishedEventSchema,
  SimulationRunMetricsComputedEventSchema,
  SimulationRunDeletedEventSchema,
] as const;

/** Schema-snapshot version (calendar date). Bump when the slim fold's
 *  derivation rules or trim service contract change so older versions can
 *  be replaced via re-fold. */
export const SIMULATION_ANALYTICS_PROJECTION_VERSION_LATEST =
  "2026-06-20" as const;

/**
 * The slim row that lands in `simulation_analytics`. Field names align with
 * the ClickHouse column names (PascalCase mirrored on the camelCase record so
 * the repository's record literal is a 1:1 column mapping).
 *
 * Heavy artifacts intentionally absent (compared to `SimulationRunStateData`):
 *   - `Messages` (rich per-turn parallel arrays)
 *   - `TraceIds` (one-to-many; lives on simulation_runs)
 *   - `Reasoning` / `Error` / `MetCriteria` / `UnmetCriteria` (free text)
 *   - `Metadata` / `Name` / `Description` (free text)
 *   - `TraceMetrics` / `RoleCosts` / `RoleLatencies` (rich per-role/per-trace
 *     breakdown — slim carries the scalar `TotalCost` only)
 */
export interface SimulationAnalyticsRow {
  tenantId: string;
  scenarioRunId: string;
  /** Schema-snapshot version (the LWW dedup key counterpart). */
  version: string;
  /** The run's occurred-at (partition column + lead sort key). */
  occurredAtMs: number;
  createdAtMs: number;
  updatedAtMs: number;

  // Hoisted dimensions (typed root-level columns).
  scenarioId: string;
  batchRunId: string;
  scenarioSetId: string;
  status: string;
  verdict: string;

  // Metric scalars.
  durationMs: number;
  totalCost: number | null;

  // Trimmed Attributes map (post-trimAttributesForAnalytics).
  attributes: Record<string, string>;
}

/**
 * In-memory accumulator for the slim simulation fold. Carries ONLY the fields
 * slim's handlers + the projection function read/write.
 */
export interface SimulationAnalyticsData {
  // Keys
  scenarioRunId: string;
  scenarioId: string;
  batchRunId: string;
  scenarioSetId: string;

  // Hoisted dims
  status: string;
  verdict: string;

  // Metrics
  durationMs: number;
  totalCost: number | null;

  /**
   * Per-trace cost breakdown the legacy fold tracks (`TraceMetrics[traceId]
   * = totalCost`). Slim keeps the SCALAR `totalCost` on the row, but needs
   * the per-trace cache so re-delivered metrics events for the SAME traceId
   * replace (not accumulate) — matching the legacy fold's semantics so
   * `TotalCost` stays equal across the two folds. Not persisted to the slim
   * row; the breakdown lives only in the in-memory accumulator and is
   * rebuilt by replay.
   */
  traceCosts: Record<string, number>;

  // Attribute map (post-accumulation, pre-trim — trim runs at projection time)
  attributes: Record<string, string>;

  // Auto-managed by AbstractFoldProjection
  createdAt: number;
  updatedAt: number;
  LastEventOccurredAt: number;
}

/**
 * Project the in-memory slim state into the slim `SimulationAnalyticsRow`.
 * Pure: no I/O, no external state.
 */
export function projectSimulationAnalyticsStateToRow({
  state,
  tenantId,
  version,
}: {
  state: SimulationAnalyticsData;
  tenantId: string;
  version: string;
}): SimulationAnalyticsRow {
  const attrs = state.attributes ?? {};
  return {
    tenantId,
    scenarioRunId: state.scenarioRunId,
    version,
    occurredAtMs: state.LastEventOccurredAt,
    createdAtMs: state.createdAt,
    updatedAtMs: state.updatedAt,

    scenarioId: state.scenarioId,
    batchRunId: state.batchRunId,
    scenarioSetId: state.scenarioSetId,
    status: state.status,
    verdict: state.verdict,

    durationMs: Math.max(0, Math.round(state.durationMs)),
    totalCost: state.totalCost,

    attributes: trimAttributesForAnalytics(attrs),
  };
}

/**
 * Merge a passthrough event metadata bag into the slim attributes map.
 * Keys arrive as `Record<string, unknown>` so we coerce to string for the
 * CH `Map(String, String)` shape. Non-scalar values are dropped (the trim
 * service rejects them too).
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
 * Re-derive the terminal `Status` the legacy fold derives so the slim row's
 * `Status` matches `simulation_runs` for the same run. Mirror of
 * `handleSimulationRunFinished` in `simulationRunState.foldProjection.ts`.
 */
function deriveStatus(
  explicitStatus: string | undefined,
  verdict: string | null,
): string {
  if (explicitStatus) return explicitStatus.toUpperCase();
  if (verdict === "success") return "SUCCESS";
  if (verdict === "failure" || verdict === "inconclusive") return "FAILURE";
  return "FAILURE";
}

/**
 * Slim fold projection for simulations.
 *
 * Handlers mirror `SimulationRunStateFoldProjection`'s per-event logic for
 * the SHARED fields. The persisted shape is `SimulationAnalyticsRow` —
 * projected from `SimulationAnalyticsData` at write time by the store.
 */
export class SimulationAnalyticsFoldProjection
  extends AbstractFoldProjection<
    SimulationAnalyticsData,
    typeof simulationAnalyticsEvents,
    "createdAt",
    "updatedAt",
    "LastEventOccurredAt"
  >
  implements
    FoldEventHandlers<
      typeof simulationAnalyticsEvents,
      SimulationAnalyticsData
    >
{
  readonly name = "simulationAnalytics";
  readonly version = SIMULATION_ANALYTICS_PROJECTION_VERSION_LATEST;
  readonly store: FoldProjectionStore<SimulationAnalyticsData>;

  protected readonly events = simulationAnalyticsEvents;

  constructor(deps: { store: FoldProjectionStore<SimulationAnalyticsData> }) {
    super({
      createdAtKey: "createdAt",
      updatedAtKey: "updatedAt",
      LastEventOccurredAtKey: "LastEventOccurredAt",
    });
    this.store = deps.store;
  }

  protected initState() {
    return {
      scenarioRunId: "",
      scenarioId: "",
      batchRunId: "",
      scenarioSetId: "",
      status: "PENDING",
      verdict: "",
      durationMs: 0,
      totalCost: null,
      traceCosts: {},
      attributes: {},
    };
  }

  handleSimulationRunQueued(
    event: SimulationRunQueuedEvent,
    state: SimulationAnalyticsData,
  ): SimulationAnalyticsData {
    return {
      ...state,
      scenarioRunId: event.data.scenarioRunId,
      scenarioId: event.data.scenarioId,
      batchRunId: event.data.batchRunId,
      scenarioSetId: event.data.scenarioSetId,
      status: "QUEUED",
      attributes: mergeEventMetadata(state.attributes, event.metadata),
    };
  }

  handleSimulationRunStarted(
    event: SimulationRunStartedEvent,
    state: SimulationAnalyticsData,
  ): SimulationAnalyticsData {
    return {
      ...state,
      scenarioRunId: state.scenarioRunId || event.data.scenarioRunId,
      scenarioId: state.scenarioId || event.data.scenarioId,
      batchRunId: state.batchRunId || event.data.batchRunId,
      scenarioSetId: state.scenarioSetId || event.data.scenarioSetId,
      status: "IN_PROGRESS",
      attributes: mergeEventMetadata(state.attributes, event.metadata),
    };
  }

  handleSimulationRunFinished(
    event: SimulationRunFinishedEvent,
    state: SimulationAnalyticsData,
  ): SimulationAnalyticsData {
    const verdict = event.data.results?.verdict ?? null;
    return {
      ...state,
      scenarioRunId: state.scenarioRunId || event.data.scenarioRunId,
      status: deriveStatus(event.data.status, verdict),
      verdict: verdict ?? "",
      durationMs:
        typeof event.data.durationMs === "number" &&
        Number.isFinite(event.data.durationMs)
          ? Math.max(0, event.data.durationMs)
          : state.durationMs,
    };
  }

  handleSimulationRunMetricsComputed(
    event: SimulationRunMetricsComputedEvent,
    state: SimulationAnalyticsData,
  ): SimulationAnalyticsData {
    // Mirror the legacy fold's aggregation: TraceMetrics is keyed by
    // traceId, so a re-delivered MetricsComputed event for the SAME traceId
    // REPLACES the prior value (not accumulates). Recompute the bucket sum
    // from the per-trace map so values match `simulation_runs.TotalCost` to
    // the cent.
    const traceCosts = {
      ...state.traceCosts,
      [event.data.traceId]: event.data.totalCost,
    };
    let totalCost = 0;
    for (const c of Object.values(traceCosts)) totalCost += c;
    return {
      ...state,
      traceCosts,
      totalCost: totalCost > 0 ? Number(totalCost.toFixed(6)) : null,
    };
  }

  handleSimulationRunDeleted(
    event: SimulationRunDeletedEvent,
    state: SimulationAnalyticsData,
  ): SimulationAnalyticsData {
    // Soft-delete: bump OccurredAt via the base class but keep the analytical
    // row in place. Operators can choose to filter on a future deletedAt
    // column if needed; slim deliberately does not carry that bookkeeping.
    return {
      ...state,
      scenarioRunId: state.scenarioRunId || event.data.scenarioRunId,
    };
  }
}
