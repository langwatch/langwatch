import crypto from "crypto";
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { EventUtils } from "../../event-sourcing/utils/event.utils";
import { createLogger } from "~/utils/logger/server";
import { CanonicalizeSpanAttributesService } from "./canonicalisation";
import { ATTR_KEYS } from "./canonicalisation/extractors/_constants";
import type {
  OtlpInstrumentationScope,
  OtlpResource,
  OtlpSpan,
} from "../../event-sourcing/pipelines/trace-processing/schemas/otlp";
import type {
  NormalizedAttributes,
  NormalizedEvent,
  NormalizedSpan,
} from "../../event-sourcing/pipelines/trace-processing/schemas/spans";
import { IdUtils } from "../../event-sourcing/pipelines/trace-processing/utils/id.utils";
import { TraceRequestUtils } from "../../event-sourcing/pipelines/trace-processing/utils/traceRequest.utils";

export class SpanNormalizationPipelineService {
  private readonly canonicalizeSpanAttributesService =
    new CanonicalizeSpanAttributesService();
  private readonly logger = createLogger(
    "langwatch:trace-processing:span-normalization-pipeline-service",
  );
  private readonly tracer = getLangWatchTracer(
    "langwatch.trace-processing.span-normalization-pipeline-service",
  );

  // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional - class uses dependency injection via private fields
  constructor() {}

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
        this.logger.info(
          {
            tenantId,
            traceId: normalizedSpan.traceId,
            spanId: normalizedSpan.spanId,
            spanRecordId: normalizedSpan.id,
          },
          "Normalized span",
        );

        // canonicalize the span attributes
        const canonicalizedResult =
          this.canonicalizeSpanAttributes(normalizedSpan);
        normalizedSpan.spanAttributes = canonicalizedResult.attributes;
        normalizedSpan.events = canonicalizedResult.events;

        // Enrich RAG contexts with document IDs
        enrichRagContextIds(normalizedSpan);

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
    const { traceId, spanId } =
      TraceRequestUtils.normalizeOtlpSpanIds(otlpSpan);
    const startTimeUnixNano = TraceRequestUtils.normalizeOtlpUnixNano(
      otlpSpan.startTimeUnixNano,
    );
    const endTimeUnixNano = TraceRequestUtils.normalizeOtlpUnixNano(
      otlpSpan.endTimeUnixNano,
    );
    const startTimeUnixMs =
      TraceRequestUtils.convertUnixNanoToUnixMs(startTimeUnixNano);
    const endTimeUnixMs =
      TraceRequestUtils.convertUnixNanoToUnixMs(endTimeUnixNano);
    const durationMs = endTimeUnixMs - startTimeUnixMs;
    const parentAndTraceContext =
      TraceRequestUtils.normalizeOtlpParentAndTraceContext(
        otlpSpan.parentSpanId,
        otlpSpan.traceState,
        otlpSpan.flags,
      );

    return {
      id: IdUtils.generateDeterministicSpanRecordIdFromData(
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

      statusCode: TraceRequestUtils.normalizeOtlpStatusCode(
        otlpSpan.status.code,
      ),
      statusMessage: otlpSpan.status.message ?? null,

      resourceAttributes: TraceRequestUtils.normalizeOtlpAttributes(
        otlpResource?.attributes ?? [],
      ),
      spanAttributes: TraceRequestUtils.normalizeOtlpAttributes(
        otlpSpan.attributes,
      ),

      events: otlpSpan.events
        .filter((e) => Boolean(e))
        .map((event) => {
          const timeUnixNano = TraceRequestUtils.normalizeOtlpUnixNano(
            event.timeUnixNano,
          );
          const attributes = TraceRequestUtils.normalizeOtlpAttributes(
            event.attributes,
          );

          // Debug: log event attributes
          this.logger.debug(
            {
              eventName: event.name,
              rawAttributes: JSON.stringify(event.attributes),
              normalizedAttributes: JSON.stringify(attributes),
            },
            "Normalized event attributes",
          );

          return {
            name: event.name,
            timeUnixMs: TraceRequestUtils.convertUnixNanoToUnixMs(timeUnixNano),
            attributes: attributes,
          };
        }),

      links: otlpSpan.links
        .filter((l) => Boolean(l))
        .map((link) => {
          const traceId = TraceRequestUtils.normalizeOtlpId(link.traceId);
          const spanId = TraceRequestUtils.normalizeOtlpId(link.spanId);
          const attributes = TraceRequestUtils.normalizeOtlpAttributes(
            link.attributes,
          );

          return { traceId, spanId, attributes };
        }),

      droppedAttributesCount: 0,
      droppedEventsCount: 0,
      droppedLinksCount: 0,
    };
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
        const result = this.canonicalizeSpanAttributesService.canonicalize(
          normalizedSpan.spanAttributes,
          normalizedSpan.events,
          normalizedSpan,
        );

        span.setAttributes({
          applied_rules: result.appliedRules,
        });
        this.logger.info(
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
}

/**
 * Extracts textual content from a RAG chunk content value.
 * Mirrors `extractChunkTextualContent` from collector/rag.ts.
 */
function extractChunkTextualContent(object: unknown): string {
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
      .map(extractChunkTextualContent)
      .filter((x) => x)
      .join("\n")
      .trim();
  }
  if (typeof content === "object" && content !== null) {
    return JSON.stringify(content);
  }
  return "";
}

/** @internal Exported for unit testing */
export function generateDocumentId(content: unknown): string {
  return crypto
    .createHash("md5")
    .update(extractChunkTextualContent(content))
    .digest("hex");
}

/**
 * Enriches RAG context entries that lack a `document_id` by generating
 * an MD5 hash from their content. Mutates the span attributes in-place.
 */
function enrichRagContextIds(span: NormalizedSpan): void {
  const raw =
    span.spanAttributes[ATTR_KEYS.LANGWATCH_RAG_CONTEXTS] ??
    span.spanAttributes[ATTR_KEYS.LANGWATCH_RAG_CONTEXTS_LEGACY];
  if (typeof raw !== "string") return;

  let contexts: unknown[];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    contexts = parsed;
  } catch {
    return;
  }

  const allMissingIds = contexts.every(
    (ctx) => !ctx || typeof ctx !== "object" || !("document_id" in ctx),
  );
  if (!allMissingIds) return;

  const enriched = contexts.filter(Boolean).map((ctx) => {
    const ctxObj = ctx as Record<string, unknown>;
    return {
      document_id: generateDocumentId(
        ctxObj.content !== undefined ? ctxObj.content : ctx,
      ),
      content: ctxObj.content !== undefined ? ctxObj.content : ctx,
    };
  });

  // Write back to the canonical attribute key
  span.spanAttributes[ATTR_KEYS.LANGWATCH_RAG_CONTEXTS] =
    JSON.stringify(enriched);
}
