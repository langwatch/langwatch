import { counter, type CounterHandle } from "@langwatch/observability/metrics";

import { ProcessRetentionMetrics, type RetentionFamily } from "./retention-metrics.port.ts";

/**
 * Two series names pinned because both App and worker processes write them.
 * Same label ensures operators need not know which process ran retention.
 */
export const PROCESS_RETENTION_SWEPT_ROWS_METRIC_NAME =
  "process_manager_retention_swept_rows_total";
export const PROCESS_RETENTION_FAILURES_METRIC_NAME = "process_manager_retention_failures_total";

/**
 * Process-manager retention sweep counts, pushed over OTLP. The failure
 * counter is kept separate from swept-rows so a failing family can't hide
 * behind one with nothing to sweep — both would otherwise report zero.
 */
export class OtelProcessRetentionMetricsAdapter extends ProcessRetentionMetrics {
  static create(): OtelProcessRetentionMetricsAdapter {
    return new OtelProcessRetentionMetricsAdapter(
      counter({
        name: PROCESS_RETENTION_SWEPT_ROWS_METRIC_NAME,
        description: "Rows deleted by the process-manager retention sweep",
      }),
      counter({
        name: PROCESS_RETENTION_FAILURES_METRIC_NAME,
        description: "Retention sweep runs that failed for one family",
      }),
    );
  }

  private constructor(
    private readonly sweptRows: CounterHandle,
    private readonly failures: CounterHandle,
  ) {
    super();
  }

  /**
   * A zero-row sweep records nothing, matching the App's counter exactly.
   * Incrementing by zero would still create the series, so the two processes
   * would disagree about whether a family that has swept nothing yet exists.
   */
  recordSweptRows(family: RetentionFamily, rows: number): void {
    if (rows > 0) this.sweptRows.inc({ family }, rows);
  }

  recordFailure(family: RetentionFamily): void {
    this.failures.inc({ family }, 1);
  }
}
