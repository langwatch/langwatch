import type { CanonicalSpan } from "~/server/event-sourcing/trace-processing/schema";
import { DEFAULT_PII_REDACTION_LEVEL } from "~/server/event-sourcing/trace-processing/schema";
import {
  CanonicalizeSpanAttributesService,
  canonicalizeSpan,
} from "../canonicalisation";
import { SpanNormalizationPipelineService } from "../span-normalization.service";
import type { RecordSpanCommandData } from "./recordSpanCommand";

/**
 * The step between the ingest seam and the `recordSpan` command: decode the
 * OTLP envelope, canonicalise it, dispatch the flat `CanonicalSpan` the command
 * accepts (ADR-105 decision 7 puts that trust boundary upstream of the command).
 *
 * It lives here rather than inline in the composition root because it is the
 * only correct way to reach the command: handing the envelope over verbatim
 * leaves `spanReceived`'s `(d) => d.traceId` resolver reading an absent field —
 * the envelope carries it at `d.span.traceId` — so the event commits with an
 * empty `AggregateId` and neither aggregate-scoped fold can key a row.
 */
export function createCanonicalSpanRecorder({
  recordSpan,
}: {
  recordSpan: (span: CanonicalSpan) => Promise<void>;
}): (data: RecordSpanCommandData) => Promise<void> {
  const normalization = new SpanNormalizationPipelineService(
    new CanonicalizeSpanAttributesService(),
  );

  return async (data) => {
    const span = canonicalizeSpan({
      normalized: normalization.normalizeSpanReceived(
        data.tenantId,
        data.span,
        data.resource,
        data.instrumentationScope,
      ),
      piiRedactionLevel: data.piiRedactionLevel ?? DEFAULT_PII_REDACTION_LEVEL,
      occurredAt: data.occurredAt,
      acceptedAt: Date.now(),
    });

    await recordSpan(span);
  };
}
