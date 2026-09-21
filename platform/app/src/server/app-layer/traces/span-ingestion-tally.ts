import type { Span as OtelSpan } from "@opentelemetry/api";
import { traceIngestionSpansTotal } from "./trace-ingestion.metrics";
import type {
  SpanIngestionResult,
  TraceRequestCollectionResult,
} from "./trace-request-collection.service";

/**
 * Intentional filtering is not rejection. Validation drops and infrastructure
 * dispatch failures are both rejected spans, but have opposite retry answers.
 */
export class SpanIngestionTally {
  private constructor() {}

  static create(): SpanIngestionTally {
    return new SpanIngestionTally();
  }

  private collected = 0;
  private dropped = 0;
  private deduped = 0;
  private filtered = 0;
  private failed = 0;
  private readonly errors: string[] = [];
  private readonly failureErrors: string[] = [];

  record(result: SpanIngestionResult): void {
    traceIngestionSpansTotal.inc({
      operation: "otlp_traces",
      outcome: result.status,
    });
    switch (result.status) {
      case "collected":
        this.collected++;
        break;
      case "dropped":
        this.dropped++;
        break;
      case "deduped":
        this.deduped++;
        break;
      case "filtered":
        this.filtered++;
        break;
      case "failed":
        this.failed++;
        if (result.error) {
          this.failureErrors.push(result.error);
        }
        break;
    }
    if (result.error) {
      this.errors.push(result.error);
    }
  }

  annotate(span: OtelSpan): void {
    span.setAttribute("spans.ingestion.successes", this.collected);
    span.setAttribute("spans.ingestion.failures", this.failed);
    span.setAttribute("spans.ingestion.drops", this.dropped);
    span.setAttribute("spans.ingestion.deduped", this.deduped);
    span.setAttribute("spans.ingestion.filtered", this.filtered);
  }

  toResult(): TraceRequestCollectionResult {
    return {
      // Filtered spans are intentionally not stored (coding-agent infra
      // noise), so they are NOT rejections.
      rejectedSpans: this.dropped + this.failed,
      ingestionFailures: this.failed,
      ingestionFailureMessage: this.failureErrors.join("; "),
      errorMessage: this.errors.join("; "),
    };
  }
}
