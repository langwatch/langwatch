import {
  AbstractMapProjection,
  type MapEventHandlers,
} from "../../../projections/abstractMapProjection";
import type { AppendStore } from "../../../projections/mapProjection.types";
import {
  type SimulationRunFinishedEvent,
  SimulationRunFinishedEventSchema,
} from "../schemas/events";

/**
 * One row emitted to `simulation_analytics_rollup` per terminal scenario
 * event (ADR-034 Phase 7 — scenarios mirror of the trace + eval rollup map
 * projections).
 *
 * Field names match the ClickHouse columns exactly (PascalCase on the
 * camelCase record) so the repository hands the record to `JSONEachRow`
 * without a second mapping layer. `BucketStart` is a JS `Date` floored to
 * the minute — the CH client serializes it as a `DateTime64(3)` literal.
 *
 * The map projection subscribes ONLY to `SimulationRunFinishedEvent`
 * (`lw.simulation_run.finished`) — the per-aggregate terminal event. Earlier
 * events (queued / started / message_snapshot / metrics_computed) do not
 * produce a rollup row; their state lands on the slim
 * `simulation_analytics` table.
 *
 * Each terminal event's payload carries:
 *   * `results.verdict` (`success` / `failure` / `inconclusive` / undefined)
 *   * `status` (explicit) or derived from verdict by the fold's logic; the
 *     map mirrors the same derivation so the rollup row's `Status` matches
 *     the slim row's terminal `Status` for the same run.
 *   * `durationMs` (the run's wall-clock duration, or 0 when absent).
 *
 * The map has no fold-state access, so dimensions only available on
 * earlier events (`ScenarioSetId`, `BatchRunId`, `ScenarioId`) are NOT on
 * the rollup. Those live on the slim table. Operators reading the rollup
 * get correct counts/sums for the additive metrics; per-set / per-batch
 * group-bys read the slim table.
 *
 * Idempotency / re-delivery: each insert is a separate row in the
 * AggregatingMergeTree; a rare retry over-counts the bucket by one
 * simulation's contribution. ADR-034 accepts that explicitly. Replay
 * rebuilds the rollup truncate-first rather than incrementing it.
 */
export interface SimulationAnalyticsRollupRow {
  /** Project id; multitenancy boundary. Always required. */
  tenantId: string;
  /** Minute bucket of the run's finishedAt (toStartOfMinute). */
  bucketStart: Date;
  /**
   * Scenario judgement verdict (`success` / `failure` / `inconclusive` / '').
   * `''` when the finished event carries no `results.verdict`.
   */
  verdict: string;
  /**
   * Terminal run status: `SUCCESS` / `FAILURE` / `ERROR` / ''. Derived the
   * same way the fold derives it (explicit `status` wins; otherwise verdict-
   * driven; `failure` / `inconclusive` collapse to `FAILURE`).
   */
  status: string;
  /** Always 1 (one row per terminal event). */
  runCount: number;
  /** 1 when `verdict === 'success'`, 0 otherwise. */
  successCount: number;
  /** 1 when `verdict === 'failure'`, 0 otherwise. */
  failureCount: number;
  /** 1 when `verdict === 'inconclusive'`, 0 otherwise. */
  inconclusiveCount: number;
  /** 1 when terminal `status === 'ERROR'`, 0 otherwise. */
  errorCount: number;
  /** Scenario wall-clock duration in ms (from the event payload). 0 when absent. */
  durationSum: number;
}

const simulationRollupEvents = [SimulationRunFinishedEventSchema] as const;

/** Floor a unix-ms timestamp to the minute boundary (toStartOfMinute equivalent). */
function toStartOfMinute(unixMs: number): Date {
  return new Date(Math.floor(unixMs / 60_000) * 60_000);
}

/**
 * Re-derive the terminal `Status` the slim fold derives so the rollup row's
 * `Status` matches the same scenario run's `Status` on the slim table. Mirror
 * of `handleSimulationRunFinished` in `simulationRunState.foldProjection.ts`.
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
 * Map projection that transforms terminal scenario-run events into per-event
 * rollup rows for `simulation_analytics_rollup` (ADR-034 Phase 7).
 */
export class SimulationAnalyticsRollupMapProjection
  extends AbstractMapProjection<
    SimulationAnalyticsRollupRow,
    typeof simulationRollupEvents
  >
  implements
    MapEventHandlers<
      typeof simulationRollupEvents,
      SimulationAnalyticsRollupRow
    >
{
  readonly name = "simulationAnalyticsRollup";
  readonly store: AppendStore<SimulationAnalyticsRollupRow>;
  protected readonly events = simulationRollupEvents;

  override options = {
    // Per-event parallelism — rollup rows are independent of each other and
    // of sibling scenarios on the same set (the rollup is dim-keyed, not
    // run-keyed).
    groupKeyFn: (event: { id: string }) => `simRollup:${event.id}`,
  };

  constructor(deps: { store: AppendStore<SimulationAnalyticsRollupRow> }) {
    super();
    this.store = deps.store;
  }

  mapSimulationRunFinished(
    event: SimulationRunFinishedEvent,
  ): SimulationAnalyticsRollupRow {
    const verdict = event.data.results?.verdict ?? null;
    const status = deriveStatus(event.data.status, verdict);
    return {
      tenantId: event.tenantId,
      bucketStart: toStartOfMinute(event.occurredAt),
      verdict: verdict ?? "",
      status,
      runCount: 1,
      successCount: verdict === "success" ? 1 : 0,
      failureCount: verdict === "failure" ? 1 : 0,
      inconclusiveCount: verdict === "inconclusive" ? 1 : 0,
      errorCount: status === "ERROR" ? 1 : 0,
      durationSum:
        typeof event.data.durationMs === "number" &&
        Number.isFinite(event.data.durationMs)
          ? Math.max(0, Math.round(event.data.durationMs))
          : 0,
    };
  }
}
