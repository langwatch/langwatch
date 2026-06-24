import {
  AbstractMapProjection,
  type MapEventHandlers,
} from "../../../projections/abstractMapProjection";
import type { AppendStore } from "../../../projections/mapProjection.types";
import {
  type SuiteRunItemCompletedEvent,
  SuiteRunItemCompletedEventSchema,
} from "../schemas/events";

/**
 * ADR-034 Phase 7 — suite analytics rollup row.
 *
 * The suite pipeline has no run-level terminal event; the slim fold derives
 * "this is the item that ended the run" from its state. The map projection
 * has no fold-state access, so it fires PER ITEM and lets ClickHouse merge
 * per-item rows into per-suite-run sums on the rollup table.
 *
 * Subscribes ONLY to `SuiteRunItemCompletedEvent` (`lw.suite_run.item_completed`).
 *
 * Each event's payload carries:
 *   * `batchRunId` (used as the suite-level group key on the rollup),
 *   * `verdict` (`success` / `failure` / `inconclusive` / undefined),
 *   * `status` (e.g. `SUCCESS` / `FAILURE` / `ERROR` / ...),
 *   * `durationMs`.
 */
export interface SuiteAnalyticsRollupRow {
  /** Project id; multitenancy boundary. Always required. */
  tenantId: string;
  /** Minute bucket of the item's completion (toStartOfMinute). */
  bucketStart: Date;
  /** Suite-level group key: the batchRunId every item event carries. */
  batchRunId: string;
  /** Item verdict (`success` / `failure` / `inconclusive` / ''). */
  verdict: string;
  /** Always 1 (one row per item event). */
  itemCount: number;
  /** 1 when verdict === 'success', 0 otherwise. */
  successCount: number;
  /** 1 when verdict === 'failure', 0 otherwise. */
  failureCount: number;
  /** 1 when verdict === 'inconclusive', 0 otherwise. */
  inconclusiveCount: number;
  /** 1 when status === 'ERROR', 0 otherwise. */
  errorCount: number;
  /** Item wall-clock duration in ms (from the event payload). 0 when absent. */
  durationSum: number;
}

const suiteRollupEvents = [SuiteRunItemCompletedEventSchema] as const;

function toStartOfMinute(unixMs: number): Date {
  return new Date(Math.floor(unixMs / 60_000) * 60_000);
}

/**
 * Map projection that transforms per-item completed events into rollup rows
 * for `suite_analytics_rollup` (ADR-034 Phase 7).
 */
export class SuiteAnalyticsRollupMapProjection
  extends AbstractMapProjection<
    SuiteAnalyticsRollupRow,
    typeof suiteRollupEvents
  >
  implements
    MapEventHandlers<typeof suiteRollupEvents, SuiteAnalyticsRollupRow>
{
  readonly name = "suiteAnalyticsRollup";
  readonly store: AppendStore<SuiteAnalyticsRollupRow>;
  protected readonly events = suiteRollupEvents;

  override options = {
    groupKeyFn: (event: { id: string }) => `suiteRollup:${event.id}`,
  };

  constructor(deps: { store: AppendStore<SuiteAnalyticsRollupRow> }) {
    super();
    this.store = deps.store;
  }

  mapSuiteRunItemCompleted(
    event: SuiteRunItemCompletedEvent,
  ): SuiteAnalyticsRollupRow {
    const verdict = event.data.verdict ?? "";
    const status = event.data.status ?? "";
    return {
      tenantId: event.tenantId,
      bucketStart: toStartOfMinute(event.occurredAt),
      batchRunId: event.data.batchRunId,
      verdict,
      itemCount: 1,
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
