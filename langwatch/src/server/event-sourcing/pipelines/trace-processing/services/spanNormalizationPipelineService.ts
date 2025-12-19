import {
  type NormalizedAttributes,
  type NormalizedEvent,
  type NormalizedSpan,
} from "../schemas/spans";
import {
  type OtlpInstrumentationScope,
  type OtlpResource,
  type OtlpSpan,
} from "../schemas/otlp";
import { TraceRequestUtils } from "../utils/traceRequest.utils";
import { IdUtils } from "../utils/id.utils";
import { CanonicalizeSpanAttributesService } from "../canonicalisation";
import { createLogger } from "~/utils/logger";
import { getLangWatchTracer } from "langwatch";
import { SpanKind } from "@opentelemetry/api";
import { EventUtils } from "~/server/event-sourcing/library";

export class SpanNormalizationPipelineService {
  private readonly canonicalizeSpanAttributesService =
    new CanonicalizeSpanAttributesService();
  private readonly logger = createLogger(
    "langwatch:trace-processing:span-normalization-pipeline-service",
  );
  private readonly tracer = getLangWatchTracer(
    "langwatch.trace-processing.span-normalization-pipeline-service",
  );

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
