import { type HrTime, SpanKind } from "@opentelemetry/api";
import type {
  IExportTraceServiceRequest,
  IInstrumentationScope,
  IResource,
  ISpan,
} from "@opentelemetry/otlp-transformer";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { getLangWatchTracer } from "langwatch";
import { createLogger } from "../../../../../utils/logger";
import type { DeepPartial } from "../../../../../utils/types";
import type { TraceForCollection } from "../../../../tracer/otel.traces";
import type { Span } from "../../../../tracer/types";
import type { PureSpanData } from "../schemas/commands";
import { OtelConversionUtils } from "../utils/otelConversion.utils";
import { ReadableSpanBuilder } from "./readableSpanBuilder";

export type SpanIngestionWriteRecord = {
  readableSpan: ReadableSpan;
  tenantId: string;
};

/**
 * Service for mapping LangWatch spans to OpenTelemetry formats and job data.
 *
 * Orchestrates span processing by:
 * - Indexing trace requests for fast lookup
 * - Delegating span building to ReadableSpanBuilder
 * - Converting ReadableSpan to PureSpanData for storage
 *
 * @example
 * ```typescript
 * const mapper = new SpanProcessingMapperService();
 * const records = mapper.mapLangWatchSpansToOtelReadableSpans(trace, traceRequest, tenantId);
 * const spanData = mapper.mapReadableSpanToSpanData(records[0].readableSpan);
 * ```
 */
export class SpanProcessingMapperService {
  private readonly logger = createLogger(
    "langwatch:trace-processing:span-mapper",
  );
  private readonly tracer = getLangWatchTracer(
    "langwatch.trace-processing.span-mapper",
  );
  private readonly spanBuilder: ReadableSpanBuilder;

  constructor(spanBuilder: ReadableSpanBuilder = new ReadableSpanBuilder()) {
    this.spanBuilder = spanBuilder;
  }

  /**
   * Indexes the trace request for fast lookup of spans and their associated resource/scope.
   */
  private indexTraceRequest(
    traceRequest: DeepPartial<IExportTraceServiceRequest>,
  ):
    | Map<
        string,
        {
          span: DeepPartial<ISpan>;
          resource?: DeepPartial<IResource>;
          scope?: DeepPartial<IInstrumentationScope>;
        }
      >
    | undefined {
    const map = new Map<
      string,
      {
        span: DeepPartial<ISpan>;
        resource?: DeepPartial<IResource>;
        scope?: DeepPartial<IInstrumentationScope>;
      }
    >();

    for (const rs of traceRequest.resourceSpans ?? []) {
      const resource = rs?.resource;
      for (const ss of rs?.scopeSpans ?? []) {
        const scope = ss?.scope;
        for (const s of ss?.spans ?? []) {
          if (!s?.traceId || !s?.spanId) continue;
          map.set(`${s.traceId}:${s.spanId}`, { span: s, resource, scope });
        }
      }
    }

    return map;
  }

  /**
   * Converts HrTime [seconds, nanoseconds] to milliseconds
   */
  private hrTimeToMs(hrTime: HrTime): number {
    return hrTime[0] * 1000 + hrTime[1] / 1_000_000;
  }

  /**
   * Maps LangWatch spans to OpenTelemetry ReadableSpan objects with GenAI semantic conventions.
   *
   * @param trace - The trace for collection containing spans
   * @param traceRequest - The original OTEL trace request
   * @param tenantId - The tenant ID
   * @returns Array of SpanIngestionWriteRecord containing ReadableSpan and tenantId
   */
  mapLangWatchSpansToOtelReadableSpans(
    trace: TraceForCollection,
    traceRequest: DeepPartial<IExportTraceServiceRequest>,
    tenantId: string,
  ): SpanIngestionWriteRecord[] {
    return this.tracer.withActiveSpan(
      "mapLangWatchSpansToOtelReadableSpans",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "trace.id": trace.traceId,
          "spans.count": trace.spans.length,
        },
      },
      (span) => {
        const records: SpanIngestionWriteRecord[] = [];
        const traceIndex = this.indexTraceRequest(traceRequest);

        for (const langWatchSpan of trace.spans) {
          span.addEvent("processing span", {
            "span.id": langWatchSpan.span_id,
          });

          try {
            const indexed = traceIndex?.get(
              `${trace.traceId}:${langWatchSpan.span_id}`,
            );
            const originalOtelSpan = indexed?.span;

            if (!originalOtelSpan) {
              this.logger.error(
                {
                  spanId: langWatchSpan.span_id,
                  traceId: trace.traceId,
                },
                "Original OTEL span not found, skipping",
              );
              continue;
            }

            const readableSpan = this.spanBuilder.buildReadableSpan(
              langWatchSpan,
              originalOtelSpan,
              indexed?.resource,
              indexed?.scope,
              trace.traceId,
              trace.reservedTraceMetadata?.thread_id ?? undefined,
            );

            records.push({
              readableSpan,
              tenantId,
            });
          } catch (error) {
            this.logger.error(
              {
                error,
                spanId: langWatchSpan.span_id,
                traceId: trace.traceId,
              },
              "Error mapping LangWatch span to OTEL ReadableSpan",
            );

            // TODO: Continue processing other spans(?)
          }
        }

        return records;
      },
    );
  }

  /**
   * Converts a ReadableSpan to pure span data for command payloads.
   * Returns only user input data without any computed fields (id, aggregateId, tenantId).
   * This ensures events contain pure data that can be replayed with different processing logic.
   *
   * @param span - The ReadableSpan to convert
   * @returns PureSpanData for storage
   */
  mapReadableSpanToSpanData(span: ReadableSpan): PureSpanData {
    const spanContext = span.spanContext();
    const parentSpanContext = span.parentSpanContext;

    // Convert HrTime [seconds, nanoseconds] to milliseconds
    const startTimeUnixMs = this.hrTimeToMs(span.startTime);
    const endTimeUnixMs = this.hrTimeToMs(span.endTime);
    const durationMs = endTimeUnixMs - startTimeUnixMs;

    return {
      // Span context fields
      traceId: spanContext.traceId,
      spanId: spanContext.spanId,
      traceFlags: spanContext.traceFlags,
      traceState: spanContext.traceState?.serialize() ?? null,
      isRemote: spanContext.isRemote ?? false,

      // Parent span context
      parentSpanId: parentSpanContext?.spanId ?? null,

      // Basic span info
      name: span.name,
      kind: span.kind,
      startTimeUnixMs,
      endTimeUnixMs,

      // Attributes (already a plain object/record)
      attributes: OtelConversionUtils.filterUndefinedAttributes(
        span.attributes,
      ),

      // Events - convert TimedEvent[] to serializable format
      events: span.events.map((event) => ({
        name: event.name,
        timeUnixMs: this.hrTimeToMs(event.time),
        attributes: OtelConversionUtils.filterUndefinedAttributes(
          event.attributes,
        ),
      })),

      // Links - convert Link[] to serializable format
      links: span.links.map((link) => ({
        traceId: link.context.traceId,
        spanId: link.context.spanId,
        traceState: link.context.traceState?.serialize() ?? null,
        attributes: link.attributes
          ? OtelConversionUtils.filterUndefinedAttributes(link.attributes)
          : undefined,
      })),

      // Status
      status: {
        code: span.status.code,
        message: span.status.message ?? null,
      },

      // Resource data - filter undefined attributes
      resourceAttributes: OtelConversionUtils.filterUndefinedAttributes(
        span.resource.attributes,
      ),

      // Instrumentation scope
      instrumentationScope: {
        name: span.instrumentationScope.name,
        version: span.instrumentationScope.version ?? null,
      },

      // Additional metadata
      durationMs,
      ended: span.ended,
      droppedAttributesCount: span.droppedAttributesCount,
      droppedEventsCount: span.droppedEventsCount,
      droppedLinksCount: span.droppedLinksCount,
    };
  }

  /**
   * Determines the span status based on LangWatch span error and original OTEL status.
   * Delegates to ReadableSpanBuilder for implementation.
   *
   * @param langWatchError - The LangWatch error info
   * @param originalOtelStatus - The original OTEL status
   * @returns The determined span status
   */
  determineSpanStatus(
    langWatchError: Span["error"],
    originalOtelStatus: DeepPartial<ISpan>["status"],
  ) {
    return this.spanBuilder.determineSpanStatus(
      langWatchError,
      originalOtelStatus,
    );
  }

  /**
   * Builds resource attributes from original OTEL resource.
   * Delegates to ReadableSpanBuilder for implementation.
   *
   * @param originalResource - The original OTEL resource
   * @returns Attributes record
   */
  buildResourceAttributes(
    originalResource: DeepPartial<IResource> | undefined,
  ) {
    return this.spanBuilder.buildResourceAttributes(originalResource);
  }
}
