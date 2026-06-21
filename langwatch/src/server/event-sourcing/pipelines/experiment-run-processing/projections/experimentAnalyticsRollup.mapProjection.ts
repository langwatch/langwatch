import {
  AbstractMapProjection,
  type MapEventHandlers,
} from "../../../projections/abstractMapProjection";
import type { AppendStore } from "../../../projections/mapProjection.types";
import {
  type ExperimentRunCompletedEvent,
  experimentRunCompletedEventSchema,
} from "../schemas/events";

/**
 * One row emitted to `experiment_analytics_rollup` per terminal experiment-
 * run event (ADR-034 Phase 7 — experiments mirror of the trace + eval rollup
 * map projections).
 *
 * Subscribes ONLY to `ExperimentRunCompletedEvent`
 * (`lw.experiment_run.completed`) — the per-aggregate terminal event.
 *
 * Each terminal event's payload carries:
 *   * `experimentId` — the rollup's main group-by axis.
 *   * `finishedAt` / `stoppedAt` — disjoint lifecycle timestamps the rollup
 *     compresses into a `CompletionMode` enum (`finished` / `stopped` /
 *     `unknown`).
 *
 * The map has no fold-state access; rich state-derived metrics
 * (TotalCost / AvgScoreBps / PassRateBps / Total / Progress) live on the
 * slim `experiment_analytics` table instead — replays of intermediate
 * events update the slim row in place.
 *
 * Idempotency / re-delivery: each insert is a separate row in the
 * AggregatingMergeTree; a rare retry over-counts the bucket by one
 * experiment's contribution. ADR-034 accepts that explicitly.
 */
export interface ExperimentAnalyticsRollupRow {
  /** Project id; multitenancy boundary. Always required. */
  tenantId: string;
  /** Minute bucket of the run's completion (toStartOfMinute). */
  bucketStart: Date;
  /** Experiment id (the rollup's main group-by axis). */
  experimentId: string;
  /** `finished` / `stopped` / `unknown`. */
  completionMode: string;
  /** Always 1 (one row per terminal event). */
  runCount: number;
  /** 1 when completionMode === 'finished', 0 otherwise. */
  finishedCount: number;
  /** 1 when completionMode === 'stopped', 0 otherwise. */
  stoppedCount: number;
}

const experimentRollupEvents = [experimentRunCompletedEventSchema] as const;

function toStartOfMinute(unixMs: number): Date {
  return new Date(Math.floor(unixMs / 60_000) * 60_000);
}

/**
 * Derive `CompletionMode` from the disjoint lifecycle timestamps the
 * completed event payload carries. Mirror of the discrimination the slim
 * fold's projection applies.
 */
function deriveCompletionMode(
  finishedAt: number | null | undefined,
  stoppedAt: number | null | undefined,
): string {
  if (typeof finishedAt === "number") return "finished";
  if (typeof stoppedAt === "number") return "stopped";
  return "unknown";
}

/**
 * Map projection that transforms terminal experiment-run events into per-event
 * rollup rows for `experiment_analytics_rollup` (ADR-034 Phase 7).
 */
export class ExperimentAnalyticsRollupMapProjection
  extends AbstractMapProjection<
    ExperimentAnalyticsRollupRow,
    typeof experimentRollupEvents
  >
  implements
    MapEventHandlers<
      typeof experimentRollupEvents,
      ExperimentAnalyticsRollupRow
    >
{
  readonly name = "experimentAnalyticsRollup";
  readonly store: AppendStore<ExperimentAnalyticsRollupRow>;
  protected readonly events = experimentRollupEvents;

  override options = {
    groupKeyFn: (event: { id: string }) => `expRollup:${event.id}`,
  };

  constructor(deps: { store: AppendStore<ExperimentAnalyticsRollupRow> }) {
    super();
    this.store = deps.store;
  }

  mapExperimentRunCompleted(
    event: ExperimentRunCompletedEvent,
  ): ExperimentAnalyticsRollupRow {
    const completionMode = deriveCompletionMode(
      event.data.finishedAt,
      event.data.stoppedAt,
    );
    return {
      tenantId: event.tenantId,
      bucketStart: toStartOfMinute(event.occurredAt),
      experimentId: event.data.experimentId,
      completionMode,
      runCount: 1,
      finishedCount: completionMode === "finished" ? 1 : 0,
      stoppedCount: completionMode === "stopped" ? 1 : 0,
    };
  }
}
