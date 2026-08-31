import { EventUtils } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type { TraceCanonicalisationService } from "@langwatch/trace-contract";
import { ATTR_KEYS } from "@langwatch/trace-contract";
import { SpanKind } from "@opentelemetry/api";
import crypto from "crypto";
import { getLangWatchTracer } from "langwatch";
import type { OtlpInstrumentationScope, OtlpResource, OtlpSpan } from "@langwatch/trace-contract";
import type {
  NormalizedAttributes,
  NormalizedEvent,
  NormalizedSpan,
} from "@langwatch/trace-contract";
import { TraceRequestUtils } from "./otlp-trace-request.rules";
import { SpanRecordIdentity } from "./span-record-identity.rules";

export class SpanNormalizationPipelineService {
  private readonly logger = createLogger(
    "langwatch:trace-processing:span-normalization-pipeline-service",
  );
  private readonly tracer = getLangWatchTracer(
    "langwatch.trace-processing.span-normalization-pipeline-service",
  );

  constructor(private readonly traceCanonicalisation: TraceCanonicalisationService) {}

  normalizeSpanReceived(
    tenantId: string,
    otlpSpan: OtlpSpan,
    otlpResource: OtlpResource | null,
    otlpInstrumentationScope: OtlpInstrumentationScope | null,
  ): NormalizedSpan {
    return this.tracer.withActiveSpan(
      "SpanNormalizationPipelineService.normalizeSpanReceived",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": tenantId,
          "trace.id": TraceRequestUtils.normalizeOtlpId(otlpSpan.traceId),
          "span.id": TraceRequestUtils.normalizeOtlpId(otlpSpan.spanId),
        },
      },
      (span) => {
        EventUtils.validateTenantId(
          { tenantId },
          "SpanNormalizationPipelineService.normalizeSpanReceived",
        );

        const normalizedSpan = this.decodeOtlpSpan(
          tenantId,
          otlpSpan,
          otlpResource,
          otlpInstrumentationScope,
        );

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

  private decodeOtlpSpan(
    tenantId: string,
    otlpSpan: OtlpSpan,
    otlpResource: OtlpResource | null,
    otlpInstrumentationScope: OtlpInstrumentationScope | null,
  ): NormalizedSpan {
    // decode span data
    const { traceId, spanId } = TraceRequestUtils.normalizeOtlpSpanIds(otlpSpan);
    const startTimeUnixNano = TraceRequestUtils.normalizeOtlpUnixNano(otlpSpan.startTimeUnixNano);
    const endTimeUnixNano = TraceRequestUtils.normalizeOtlpUnixNano(otlpSpan.endTimeUnixNano);
    const startTimeUnixMs = TraceRequestUtils.convertUnixNanoToUnixMs(startTimeUnixNano);
    const endTimeUnixMs = TraceRequestUtils.convertUnixNanoToUnixMs(endTimeUnixNano);
    const durationMs = Math.max(0, endTimeUnixMs - startTimeUnixMs);
    const parentAndTraceContext = TraceRequestUtils.normalizeOtlpParentAndTraceContext(
      otlpSpan.parentSpanId,
      otlpSpan.traceState,
      otlpSpan.flags,
    );

    return {
      id: SpanRecordIdentity.generateDeterministicSpanRecordIdFromData(
        tenantId,
        traceId,
        spanId,
        startTimeUnixMs,
      ),
      tenantId,
      traceId,
      spanId,
      parentSpanId: parentAndTraceContext.spanId,
      parentTraceId: parentAndTraceContext.traceId,
      parentIsRemote: parentAndTraceContext.isRemote,
      // sampled: default to true, as we are on the collector end
      sampled: parentAndTraceContext.isSampled ?? true,

      startTimeUnixMs,
      endTimeUnixMs,
      durationMs,

      name: otlpSpan.name,
      kind: TraceRequestUtils.normalizeOtlpSpanKind(otlpSpan.kind),

      instrumentationScope: {
        name: otlpInstrumentationScope?.name ?? "unknown",
        version: otlpInstrumentationScope?.version ?? null,
      },

      statusCode: TraceRequestUtils.normalizeOtlpStatusCode(otlpSpan.status.code),
      statusMessage: otlpSpan.status.message ?? null,

      resourceAttributes: TraceRequestUtils.normalizeOtlpAttributes(otlpResource?.attributes ?? []),
      spanAttributes: TraceRequestUtils.normalizeOtlpAttributes(otlpSpan.attributes),

      events: this.decodeEvents(otlpSpan),
      links: this.decodeLinks(otlpSpan),

      droppedAttributesCount: 0,
      droppedEventsCount: 0,
      droppedLinksCount: 0,

      // Cost is derived later (in the span-storage projection) from this span's
      // tokens × pricing — normalization has no pricing context. Initialise to
      // null so the span is schema-valid the moment it's built; the projection
      // overwrites both before the span is stored.
      cost: null,
      nonBilledCost: null,
    };
  }

  private decodeEvents(otlpSpan: OtlpSpan): NormalizedEvent[] {
    return otlpSpan.events
      .filter((event) => Boolean(event))
      .map((event) => ({
        name: event.name,
        timeUnixMs: TraceRequestUtils.convertUnixNanoToUnixMs(
          TraceRequestUtils.normalizeOtlpUnixNano(event.timeUnixNano),
        ),
        attributes: TraceRequestUtils.normalizeOtlpAttributes(event.attributes),
      }));
  }

  private decodeLinks(otlpSpan: OtlpSpan): NormalizedSpan["links"] {
    return otlpSpan.links
      .filter((link) => Boolean(link))
      .map((link) => ({
        traceId: TraceRequestUtils.normalizeOtlpId(link.traceId),
        spanId: TraceRequestUtils.normalizeOtlpId(link.spanId),
        attributes: TraceRequestUtils.normalizeOtlpAttributes(link.attributes),
      }));
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
        const result = this.traceCanonicalisation.canonicalizeSpanAttributes({
          spanAttributes: normalizedSpan.spanAttributes,
          events: normalizedSpan.events,
          span: normalizedSpan,
        });

        span.setAttributes({
          applied_rules: result.appliedRules,
        });
        this.logger.debug(
          {
            appliedRules: result.appliedRules,
          },
          "Canonicalized span attributes",
        );

        return result;
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
    if (!Array.isArray(raw)) return;

    span.spanAttributes[ATTR_KEYS.LANGWATCH_RAG_CONTEXTS] = raw.map((context) => {
      if (!context || typeof context !== "object" || Array.isArray(context)) return context;
      const entry: Record<string, unknown> = context;
      if ("document_id" in entry && entry.document_id) return entry;
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

  /** Mirrors `extractChunkTextualContent` from collector/rag.ts. */
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
