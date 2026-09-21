import type { Span as OtelSpan } from "@opentelemetry/api";
import { traceIngestionSpansTotal } from "./trace-ingestion.metrics";
import type {
  SpanIngestionResult,
  TraceRequestCollectionResult,
} from "./trace-request-collection.service";

/**
 * Cap the error message we surface in `partialSuccess.errorMessage` so a single
 * bad batch with hundreds of malformed spans cannot blow the response size or
 * swallow the actionable prefix in a wall of repeated text. The OTLP spec lets
 * receivers truncate `partialSuccess.errorMessage` arbitrarily; we keep the
 * first few distinct errors verbatim and append "+N more" if there are more.
 */
const MAX_DISTINCT_ERRORS_IN_RESPONSE = 5;
const MAX_SINGLE_ERROR_CHARS = 500;

function truncateError(msg: string): string {
  if (msg.length <= MAX_SINGLE_ERROR_CHARS) return msg;
  return `${msg.slice(0, MAX_SINGLE_ERROR_CHARS - 3)}...`;
}

/**
 * Build a bounded error message from the per-span error list. De-duplicates
 * first because a misconfigured SDK will often produce the same parse error
 * for every span in a batch, then truncates each individual error and caps the
 * count. The result is what callers see in `partialSuccess.errorMessage`.
 *
 * Exported so the bounding contract can be unit-tested without a tRPC client.
 */
export function buildBoundedErrorMessage(errors: string[]): string {
  // Preserve insertion order while de-duplicating. A batch that fails the same
  // way 200 times should still surface one entry, not 200.
  const seen = new Set<string>();
  const distinct: string[] = [];
  for (const e of errors) {
    if (!seen.has(e)) {
      seen.add(e);
      distinct.push(e);
    }
  }
  if (distinct.length === 0) return "";
  const shown = distinct
    .slice(0, MAX_DISTINCT_ERRORS_IN_RESPONSE)
    .map(truncateError);
  const remaining = distinct.length - shown.length;
  if (remaining > 0) {
    return `${shown.join("; ")}; +${remaining} more`;
  }
  return shown.join("; ");
}

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
  // Per-reason breakdown of rejected spans (issue #5898 acceptance
  // criterion 5). The set of keys is closed (validation/age/queue) so a
  // numeric counter per key is enough — no need for a Map.
  private rejectedByValidation = 0;
  private rejectedByAge = 0;
  private rejectedByQueue = 0;
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
        if (result.dropReason === "validation") this.rejectedByValidation++;
        else if (result.dropReason === "age") this.rejectedByAge++;
        break;
      case "deduped":
        this.deduped++;
        break;
      case "filtered":
        this.filtered++;
        break;
      case "failed":
        this.failed++;
        if (result.dropReason === "queue") this.rejectedByQueue++;
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
    // Rejected-span breakdown by rejection reason. Emitted as separate
    // attributes so dashboards can sum any slice without parsing a JSON
    // blob, and so the existing `spans.ingestion.drops`/`failures`
    // attributes stay back-compatible.
    span.setAttribute(
      "spans.ingestion.rejected.by_reason.validation",
      this.rejectedByValidation,
    );
    span.setAttribute(
      "spans.ingestion.rejected.by_reason.age",
      this.rejectedByAge,
    );
    span.setAttribute(
      "spans.ingestion.rejected.by_reason.queue",
      this.rejectedByQueue,
    );
  }

  toResult(): TraceRequestCollectionResult {
    return {
      // Filtered spans are intentionally not stored (coding-agent infra
      // noise), so they are NOT rejections.
      rejectedSpans: this.dropped + this.failed,
      ingestionFailures: this.failed,
      ingestionFailureMessage: this.failureErrors.join("; "),
      errorMessage: buildBoundedErrorMessage(this.errors),
    };
  }
}
