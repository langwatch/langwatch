import crypto from "crypto";

import { EventUtils } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type {
  TraceCanonicalisationService,
  OtlpInstrumentationScope,
  OtlpResource,
  OtlpSpan,
  NormalizedAttributes,
  NormalizedEvent,
  NormalizedSpan,
} from "@langwatch/trace-contract";
import { ATTR_KEYS } from "@langwatch/trace-contract";
import { decodeOtlpSpan, normalizeOtlpId } from "@langwatch/trace-contract/otlp-decoding";
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
   * Gives every RAG context entry a `document_id`, deriving one from the
   * chunk's own content where the SDK sent none. Mutates the span's
   * attributes in place, and writes back under the canonical key.
   */
  enrichRagContextIds(span: NormalizedSpan): void {
    const raw =
      span.spanAttributes[ATTR_KEYS.LANGWATCH_RAG_CONTEXTS] ??
      span.spanAttributes[ATTR_KEYS.LANGWATCH_RAG_CONTEXTS_LEGACY];
    if (!Array.isArray(raw)) {
      return;
    }

    span.spanAttributes[ATTR_KEYS.LANGWATCH_RAG_CONTEXTS] = raw.map((context) => {
      if (!context || typeof context !== "object" || Array.isArray(context)) {
        return context;
      }

      const entry: Record<string, unknown> = context;
      if ("document_id" in entry && entry.document_id) {
        return entry;
      }

      return {
        ...entry,
        document_id: SpanNormalizationPipelineService.documentIdFor(
          entry.content !== undefined ? entry.content : context,
        ),
      };
    });
  }

  /**
   * The id a RAG chunk gets when it arrived without one: a hash of its own
   * text, so the same chunk seen twice is the same document both times.
   */
  static documentIdFor(content: unknown): string {
    return crypto
      .createHash("md5")
      .update(SpanNormalizationPipelineService.chunkText(content))
      .digest("hex");
  }

  /**
   * The ingest pipeline's own chunk flattening, close to but NOT the same as
   * `@langwatch/trace-contract`'s `extractChunkTextualContent`: that one answers `""` for a
   * parsed primitive, this one answers the original string.
   */
  private static chunkText(object: unknown): string {
    let content = object;
    if (typeof content === "string") {
      try {
        content = JSON.parse(content);
      } catch {
        return (object as string).trim();
      }
    }

    if (Array.isArray(content)) {
      return content
        .map((item) => SpanNormalizationPipelineService.chunkText(item))
        .filter((text) => text)
        .join("\n")
        .trim();
    }

    if (typeof content === "object" && content !== null) {
      return JSON.stringify(content);
    }

    // Parsed to a primitive (number, boolean, etc.) — use the original string
    return String(object).trim();
  }
}
