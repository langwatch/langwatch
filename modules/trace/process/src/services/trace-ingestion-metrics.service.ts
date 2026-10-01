import { counter, type CounterHandle } from "@langwatch/observability/metrics";

export const TRACE_INGESTION_SPANS_METRIC_NAME = "trace_ingestion_spans_total";
export const TRACE_INGESTION_OTLP_OPERATION = "otlp_traces";

/**
 * Span outcomes of an OTLP export, under main's series name and labels. Only
 * `dropped` and `failed` are rejections; dispatch does not prove queryability.
 */
export class TraceIngestionMetricsService {
  static create(): TraceIngestionMetricsService {
    return new TraceIngestionMetricsService(
      counter({
        name: TRACE_INGESTION_SPANS_METRIC_NAME,
        description:
          "OTLP collection span outcomes: collected means dispatched, failed means dispatch infrastructure failure, dropped means invalid or aged, deduped and filtered are intentional. Dispatch does not prove queryability.",
      }),
    );
  }

  private constructor(private readonly spans: CounterHandle) {}

  record(outcomes: Readonly<Record<string, number>>): void {
    for (const [outcome, count] of Object.entries(outcomes)) {
      this.spans.inc({ operation: TRACE_INGESTION_OTLP_OPERATION, outcome }, count);
    }
  }
}
