import { EventUtils } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { ATTR_KEYS } from "@langwatch/span-normalisation";
import type {
  TraceCanonicalisationService,
  OtlpInstrumentationScope,
  OtlpResource,
  OtlpSpan,
  NormalizedAttributes,
  NormalizedEvent,
  NormalizedSpan,
} from "@langwatch/trace-contract";
import {
  decodeOtlpSpan,
  deriveRagContextsWithIds,
  normalizeOtlpId,
  ragDocumentIdFor,
} from "@langwatch/trace-contract/otlp-decoding";
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";

export interface TraceSpanNormalization {
  normalizeSpanReceived(params: {
    tenantId: string;
    span: OtlpSpan;
    resource: OtlpResource | null;
    instrumentationScope: OtlpInstrumentationScope | null;
  }): NormalizedSpan;

  enrichRagContextIds(span: NormalizedSpan): void;
}

export class SpanNormalizationPipelineService implements TraceSpanNormalization {
  static create(
    traceCanonicalisation: TraceCanonicalisationService,
  ): SpanNormalizationPipelineService {
    return new SpanNormalizationPipelineService(traceCanonicalisation);
  }

  private readonly logger = createLogger(
    "langwatch:trace-processing:span-normalization-pipeline-service",
  );
  private readonly tracer = getLangWatchTracer(
    "langwatch.trace-processing.span-normalization-pipeline-service",
  );

  private constructor(private readonly traceCanonicalisation: TraceCanonicalisationService) {}

  normalizeSpanReceived({
    tenantId,
    span: otlpSpan,
    resource: otlpResource,
    instrumentationScope: otlpInstrumentationScope,
  }: {
    tenantId: string;
    span: OtlpSpan;
    resource: OtlpResource | null;
    instrumentationScope: OtlpInstrumentationScope | null;
  }): NormalizedSpan {
    return this.tracer.withActiveSpan(
      "SpanNormalizationPipelineService.normalizeSpanReceived",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": tenantId,
          "trace.id": normalizeOtlpId(otlpSpan.traceId),
          "span.id": normalizeOtlpId(otlpSpan.spanId),
        },
      },
      (span) => {
        EventUtils.validateTenantId(
          { tenantId },
          "SpanNormalizationPipelineService.normalizeSpanReceived",
        );

        const normalizedSpan = decodeOtlpSpan({
          tenantId,
          otlpSpan,
          otlpResource,
          otlpInstrumentationScope,
        });

        span.setAttributes({
          "span.record_id": normalizedSpan.id,
        });
        this.logger.debug(
          {
            tenantId,
            traceId: normalizedSpan.traceId,
            spanId: normalizedSpan.spanId,
            spanRecordId: normalizedSpan.id,
          },
          "Normalized span",
        );

        // canonicalize the span attributes
        const canonicalizedResult = this.canonicalizeSpanAttributes(normalizedSpan);
        normalizedSpan.spanAttributes = canonicalizedResult.attributes;
        normalizedSpan.events = canonicalizedResult.events;

        return normalizedSpan;
      },
    );
  }

  private canonicalizeSpanAttributes(normalizedSpan: NormalizedSpan): {
    attributes: NormalizedAttributes;
    events: NormalizedEvent[];
  } {
    const result = this.tracer.withActiveSpan(
      "SpanNormalizationPipelineService.canonicalizeSpanAttributes",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "span.record_id": normalizedSpan.id,
        },
      },
      (span) => {
        const canonicalized = this.traceCanonicalisation.canonicalizeSpanAttributes({
          spanAttributes: normalizedSpan.spanAttributes,
          events: normalizedSpan.events,
          span: normalizedSpan,
        });

        span.setAttributes({
          applied_rules: canonicalized.appliedRules,
        });
        this.logger.debug(
          {
            appliedRules: canonicalized.appliedRules,
          },
          "Canonicalized span attributes",
        );

        return canonicalized;
      },
    );

    return {
      attributes: result.attributes,
      events: result.events,
    };
  }

  /**
   * Gives every RAG context entry a `document_id` (trace-contract's
   * `deriveRagContextsWithIds`) and writes them back under the canonical key.
   */
  enrichRagContextIds(span: NormalizedSpan): void {
    const contexts = deriveRagContextsWithIds(span.spanAttributes);
    if (contexts === undefined) {
      return;
    }

    span.spanAttributes[ATTR_KEYS.LANGWATCH_RAG_CONTEXTS] = contexts;
  }

  /** The id a RAG chunk gets when it arrived without one; see `ragDocumentIdFor`. */
  static documentIdFor(content: unknown): string {
    return ragDocumentIdFor(content);
  }
}
