import { counter, type CounterHandle } from "@langwatch/observability/metrics";

/** Which subscriber wrote the match records: a settled trace or a settled evaluation. */
export type AutomationMatchRecordPath = "trace" | "evaluation";

/**
 * Match records written before any filter runs, labelled only by path, never by project:
 * modules/trace/specs/trace-ingestion-metrics.feature.
 */
export abstract class AutomationMatchRecordMetricsSink {
  abstract countRecorded(input: { path: AutomationMatchRecordPath; count: number }): void;
}

export const AUTOMATION_MATCH_RECORDS_METRIC_NAME = "automation_match_records_total";
export const AUTOMATION_MATCH_RECORDS_METRIC_DESCRIPTION =
  "Trigger match records written before any filter is evaluated";

/** Trigger match-record volume, pushed over OTLP. */
export class AutomationMatchRecordMetricsService extends AutomationMatchRecordMetricsSink {
  static create(): AutomationMatchRecordMetricsService {
    return new AutomationMatchRecordMetricsService(
      counter({
        name: AUTOMATION_MATCH_RECORDS_METRIC_NAME,
        description: AUTOMATION_MATCH_RECORDS_METRIC_DESCRIPTION,
      }),
    );
  }

  private constructor(private readonly records: CounterHandle) {
    super();
  }

  /** `inc(0)` moves nothing, and a trace that matched no trigger calls this every time. */
  countRecorded(input: { path: AutomationMatchRecordPath; count: number }): void {
    if (input.count > 0) this.records.inc({ path: input.path }, input.count);
  }
}
