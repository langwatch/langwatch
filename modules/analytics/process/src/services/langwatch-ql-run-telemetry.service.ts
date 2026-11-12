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

/** The LangWatchQL run counter, histograms and failure log line; one instance per app. */
export class LangWatchQLRunTelemetryService {
  /** Declares the three instruments; their series are written on first use. */
  static create({ queryHashKey }: { queryHashKey: Uint8Array }): LangWatchQLRunTelemetryService {
    return new LangWatchQLRunTelemetryService({
      queryHashKey,
      runs: counter({
        name: "lwql_queries_total",
        description: "LangWatchQL runs by caller and outcome (ok, empty, or the error code)",
      }),
      duration: histogram({
        name: "lwql_query_duration_seconds",
        description: "LangWatchQL run time, the database's plus hydration's, by caller",
      }),
      rowsRead: histogram({
        name: "lwql_rows_read",
        description: "Rows the database read for one LangWatchQL run, by caller",
      }),
    });
  }

  private readonly queryHashKey: Uint8Array;
  private readonly runs: CounterHandle;
  private readonly duration: HistogramHandle;
  private readonly rowsRead: HistogramHandle;

  private constructor(parts: {
    queryHashKey: Uint8Array;
    runs: CounterHandle;
    duration: HistogramHandle;
    rowsRead: HistogramHandle;
  }) {
    this.queryHashKey = parts.queryHashKey;
    this.runs = parts.runs;
    this.duration = parts.duration;
    this.rowsRead = parts.rowsRead;
  }

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

  /** A run's own log-line fields: the caller, the widget's ids, and the keyed query hash. */
  fieldsFor({
    telemetry,
    sql,
  }: {
    telemetry: LangWatchQLRunTelemetry | undefined;
    sql: string;
  }): Readonly<Record<string, string>> {
    return langWatchQLTelemetryFields({ telemetry, sql, queryHashKey: this.queryHashKey });
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
    logger.info({ ...this.fieldsFor({ telemetry, sql }), outcome }, "LangWatchQL failed");
  }
}
