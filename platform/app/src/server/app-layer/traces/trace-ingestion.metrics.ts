import { Counter, register } from "prom-client";
import type { SpanIngestionStatus } from "./trace-request-collection.service";

register.removeSingleMetric("trace_ingestion_spans_total");

export const traceIngestionSpansTotal = new Counter({
  name: "trace_ingestion_spans_total",
  help: "OTLP collection span outcomes: collected means dispatched, failed means dispatch infrastructure failure, dropped means invalid or aged, deduped and filtered are intentional. Dispatch does not prove queryability.",
  labelNames: ["operation", "outcome"] as const,
});

const outcomes: readonly SpanIngestionStatus[] = [
  "collected",
  "failed",
  "dropped",
  "deduped",
  "filtered",
];

for (const outcome of outcomes) {
  traceIngestionSpansTotal.inc({ operation: "otlp_traces", outcome }, 0);
}
