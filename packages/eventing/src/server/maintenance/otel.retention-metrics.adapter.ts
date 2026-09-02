import { counter, type CounterHandle } from "@langwatch/observability/metrics";
import { ProcessRetentionMetricsPort, type RetentionFamily } from "./retention-metrics.port";

/**
 * The two series names, pinned because two processes write them.
 *
 * The App writes them through its own `prom-client` registry; a worker
 * composed from packages writes them over OTLP. They are the same sweep
 * counters and they carry the same `family` label on purpose — an operator
 * asking "did retention run for the inbox" must not have to know which
 * process ran it.
 */
export const PROCESS_RETENTION_SWEPT_ROWS_METRIC_NAME =
  "process_manager_retention_swept_rows_total";
export const PROCESS_RETENTION_FAILURES_METRIC_NAME = "process_manager_retention_failures_total";

/**
 * Process-manager retention sweep counts, pushed over OTLP.
 *
 * The failure counter is separate from the swept-rows counter for the reason
 * the App's own comment gives: without it, a family that fails every hour and
 * a family with nothing to sweep report the same zero, and silent retention
 * failure is the exact incident this sweep exists to prevent.
 */
export class OtelProcessRetentionMetricsAdapter extends ProcessRetentionMetricsPort {
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
