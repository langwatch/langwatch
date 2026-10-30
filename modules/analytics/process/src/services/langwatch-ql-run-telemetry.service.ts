/**
 * Counts every LangWatchQL run by caller and outcome, and records its time and the rows it read,
 * and logs a refused or failed one. Metric labels are the caller and the outcome only, never a
 * project, dashboard or widget id, so the series stay few.
 * @see modules/dashboard/specs/dashboards-telemetry.feature
 */

import type { LangWatchQLRunTelemetry } from "@langwatch/analytics-contract";
import { createLogger } from "@langwatch/observability";
import {
  counter,
  histogram,
  type CounterHandle,
  type HistogramHandle,
} from "@langwatch/observability/metrics";

import {
  langWatchQLFailureOutcome,
  langWatchQLTelemetryCaller,
  langWatchQLTelemetryFields,
  type LangWatchQLRunOutcome,
} from "../rules/langwatch-ql-run-telemetry.rules.ts";

const logger = createLogger("langwatch:analytics:lwql");

export class LangWatchQLRunTelemetryService {
  static create(): LangWatchQLRunTelemetryService {
    return new LangWatchQLRunTelemetryService(
      counter({
        name: "lwql_queries_total",
        description: "LangWatchQL runs by caller and outcome (ok, empty, or the error code)",
      }),
      histogram({
        name: "lwql_query_duration_seconds",
        description: "LangWatchQL run time, the database's plus hydration's, by caller",
      }),
      histogram({
        name: "lwql_rows_read",
        description: "Rows the database read for one LangWatchQL run, by caller",
      }),
    );
  }

  private constructor(
    private readonly runs: CounterHandle,
    private readonly duration: HistogramHandle,
    private readonly rowsRead: HistogramHandle,
  ) {}

  /** A run that answered: counted as ok or empty, with its time and the rows it read. */
  recordAnswered({
    telemetry,
    rowsReturned,
    rowsRead,
    elapsedMs,
  }: {
    telemetry: LangWatchQLRunTelemetry | undefined;
    rowsReturned: number;
    rowsRead: number;
    elapsedMs: number;
  }): LangWatchQLRunOutcome {
    const caller = langWatchQLTelemetryCaller(telemetry);
    const outcome = rowsReturned > 0 ? "ok" : "empty";
    this.runs.inc({ caller, outcome });
    this.duration.observe(elapsedMs / 1000, { caller });
    this.rowsRead.observe(rowsRead, { caller });
    return outcome;
  }

  /** A run refused or failed anywhere on its way: logged and counted under its error code. */
  recordFailed({
    telemetry,
    sql,
    error,
  }: {
    telemetry: LangWatchQLRunTelemetry | undefined;
    sql: string;
    error: unknown;
  }): void {
    const outcome = langWatchQLFailureOutcome(error);
    this.runs.inc({ caller: langWatchQLTelemetryCaller(telemetry), outcome });
    logger.info(
      { ...langWatchQLTelemetryFields({ telemetry, sql }), outcome },
      "LangWatchQL failed",
    );
  }
}
