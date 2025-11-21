import type { ReadableSpan, TimedEvent } from "@opentelemetry/sdk-trace-base";
import {
  type IExportTraceServiceRequest,
  type ISpan,
  type IResource,
  type IInstrumentationScope,
} from "@opentelemetry/otlp-transformer";
import {
  SpanKind,
  SpanStatusCode,
  type SpanContext,
  type HrTime,
  type Link,
  type Attributes,
  type AttributeValue,
  type SpanStatus,
} from "@opentelemetry/api";
import type { Resource } from "@opentelemetry/resources";
import type { InstrumentationScope } from "@opentelemetry/core";
import type { TraceForCollection } from "../../../../tracer/otel.traces";
import type { Span, RAGSpan } from "../../../../tracer/types";
import type { DeepPartial } from "../../../../../utils/types";
import {
  unixNanoToMs,
  msToUnixNano,
  convertSpanKind,
  convertSpanTypeToGenAiOperationName,
  otelAttributesToRecord,
  otelValueToJs,
  type SpanType,
  type Milliseconds,
} from "../utils/otelConversions";
import { createLogger } from "../../../../../utils/logger";
import { getLangWatchTracer } from "langwatch";
import type { SpanData } from "../schemas/commands";

const logger = createLogger("langwatch:span-ingestion:mapper");
const tracer = getLangWatchTracer("langwatch.span-ingestion.mapper");

export type SpanIngestionWriteRecord = {
  readableSpan: ReadableSpan;
  tenantId: string;
};

/**
 * Type definition from @opentelemetry/resources for RawResourceAttribute
 * This is copied here to avoid `as unknown` type assertions
 */
type RawResourceAttribute = [
  string,
  AttributeValue | Promise<AttributeValue | undefined> | undefined,
];

/**
 * Service for mapping LangWatch spans to OpenTelemetry formats and job data.
 */
export class SpanProcessingMapperService {
  /**
   * Maps LangWatch spans to OpenTelemetry ReadableSpan objects with GenAI semantic conventions
   */
  mapLangWatchSpansToOtelReadableSpans(
    trace: TraceForCollection,
    traceRequest: DeepPartial<IExportTraceServiceRequest>,
    tenantId: string,
  ): SpanIngestionWriteRecord[] {
    return tracer.withActiveSpan(
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

        for (const langWatchSpan of trace.spans) {
          span.addEvent("processing span", {
            "span.id": langWatchSpan.span_id,
          });

          try {
            const originalOtelSpan = this.findOriginalOtelSpan(
              traceRequest,
              langWatchSpan.span_id,
              trace.traceId,
            );

            if (!originalOtelSpan) {
              logger.error(
                {
                  spanId: langWatchSpan.span_id,
                  traceId: trace.traceId,
                },
                "Original OTEL span not found, skipping",
              );
              continue;
            }

            const resourceSpan = this.findResourceSpanForSpan(
              traceRequest,
              originalOtelSpan,
            );
            const scopeSpan = this.findScopeSpanForSpan(
              traceRequest,
              originalOtelSpan,
            );

            const readableSpan = this.buildReadableSpan(
              langWatchSpan,
              originalOtelSpan,
              resourceSpan?.resource,
              scopeSpan?.scope,
              trace.traceId,
            );

            records.push({
              readableSpan,
              tenantId,
            });
          } catch (error) {
            logger.error(
              {
                error,
                spanId: langWatchSpan.span_id,
                traceId: trace.traceId,
              },
              "Error mapping LangWatch span to OTEL ReadableSpan",
            );

            // Continue processing other spans
          }
        }

        return records;
      },
    );
  }

  /**
   * Filters out undefined values from Attributes to match the expected type.
   */
  private filterUndefinedAttributes(
    attrs: Attributes | undefined,
  ): Record<
    string,
    string | number | boolean | string[] | number[] | boolean[]
  > {
    if (!attrs) return {};
    const result: Record<
      string,
      string | number | boolean | string[] | number[] | boolean[]
    > = {};
    for (const [key, value] of Object.entries(attrs)) {
      if (value !== undefined) {
        result[key] = value as
          | string
          | number
          | boolean
          | string[]
          | number[]
          | boolean[];
      }
    }
    return result;
  }

  /**
   * Converts a ReadableSpan to a JSON-serializable DTO for command payloads.
   * This mapping is critical for command serialization.
   * Note: id, aggregateId, and tenantId are set to placeholder values here.
   * They will be properly set when the command is processed (id is generated, aggregateId is traceId, tenantId comes from command).
   */
  mapReadableSpanToSpanData(span: ReadableSpan): SpanData {
    const spanContext = span.spanContext();
    const parentSpanContext = span.parentSpanContext;

    // Convert HrTime [seconds, nanoseconds] to milliseconds
    const startTimeUnixMs =
      span.startTime[0] * 1000 + span.startTime[1] / 1_000_000;
    const endTimeUnixMs = span.endTime[0] * 1000 + span.endTime[1] / 1_000_000;
    const durationMs = endTimeUnixMs - startTimeUnixMs;

    return {
      // Placeholder values - will be set properly when command is processed
      id: "", // Generated in repository
      aggregateId: spanContext.traceId, // Aggregate ID is the traceId
      tenantId: "", // Set from command

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
      attributes: this.filterUndefinedAttributes(span.attributes),

      // Events - convert TimedEvent[] to serializable format
      events: span.events.map((event) => ({
        name: event.name,
        timeUnixMs: event.time[0] * 1000 + event.time[1] / 1_000_000,
        attributes: this.filterUndefinedAttributes(event.attributes),
      })),

      // Links - convert Link[] to serializable format
      links: span.links.map((link) => ({
        traceId: link.context.traceId,
        spanId: link.context.spanId,
        traceState: link.context.traceState?.serialize() ?? null,
        attributes: link.attributes
          ? this.filterUndefinedAttributes(link.attributes)
          : undefined,
      })),

      // Status
      status: {
        code: span.status.code,
        message: span.status.message ?? null,
      },

      // Resource data - filter undefined attributes
      resourceAttributes: this.filterUndefinedAttributes(
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
   * Finds the original OTEL span from the trace request by matching spanId and traceId
   */
  private findOriginalOtelSpan(
    traceRequest: DeepPartial<IExportTraceServiceRequest>,
    spanId: string,
    traceId: string,
  ): DeepPartial<ISpan> | undefined {
    return traceRequest.resourceSpans
      ?.flatMap((resourceSpan) => resourceSpan?.scopeSpans ?? [])
      .flatMap((scopeSpan) => scopeSpan?.spans ?? [])
      .find((span) => span?.spanId === spanId && span?.traceId === traceId);
  }

  /**
   * Finds the resource span that contains the given span
   */
  private findResourceSpanForSpan(
    traceRequest: DeepPartial<IExportTraceServiceRequest>,
    span: DeepPartial<ISpan>,
  ):
    | DeepPartial<
        NonNullable<IExportTraceServiceRequest["resourceSpans"]>[number]
      >
    | undefined {
    return traceRequest.resourceSpans?.find((resourceSpan) =>
      resourceSpan?.scopeSpans?.some((scopeSpan) =>
        scopeSpan?.spans?.some((s) => s?.spanId === span?.spanId),
      ),
    );
  }

  /**
   * Finds the scope span that contains the given span
   */
  private findScopeSpanForSpan(
    traceRequest: DeepPartial<IExportTraceServiceRequest>,
    span: DeepPartial<ISpan>,
  ):
    | DeepPartial<
        NonNullable<
          NonNullable<IExportTraceServiceRequest["resourceSpans"]>[number]
        >["scopeSpans"]
      >[number]
    | undefined {
    return traceRequest.resourceSpans
      ?.flatMap((resourceSpan) => resourceSpan?.scopeSpans ?? [])
      .find((scopeSpan) =>
        scopeSpan?.spans?.some((s) => s?.spanId === span?.spanId),
      );
  }

  /**
   * Determines the span status based on LangWatch span error and original OTEL status
   */
  determineSpanStatus(
    langWatchError: Span["error"],
    originalOtelStatus: DeepPartial<ISpan>["status"],
  ): SpanStatus {
    let status: SpanStatus = {
      code: SpanStatusCode.OK,
    };

    if (langWatchError?.has_error) {
      status = {
        code: SpanStatusCode.ERROR,
        message: langWatchError.message,
      };
    } else if (originalOtelStatus?.code !== void 0) {
      const statusCode = originalOtelStatus.code;
      // Compare with numeric values - STATUS_CODE_ERROR = 2, STATUS_CODE_OK = 1
      let codeValue: number | undefined;
      if (typeof statusCode === "number") {
        codeValue = statusCode;
      } else {
        const codeStr = String(statusCode);
        if (codeStr.includes("ERROR")) {
          codeValue = 2;
        } else if (codeStr.includes("OK")) {
          codeValue = 1;
        }
      }
      if (codeValue === 2) {
        status = {
          code: SpanStatusCode.ERROR,
          message: originalOtelStatus?.message,
        };
      } else if (codeValue === 1) {
        status = {
          code: SpanStatusCode.OK,
        };
      }
    }

    return status;
  }

  /**
   * Builds resource attributes from original OTEL resource
   */
  buildResourceAttributes(
    originalResource: DeepPartial<IResource> | undefined,
  ): Attributes {
    const resourceAttributes: Attributes = {};
    if (originalResource?.attributes) {
      for (const attr of originalResource.attributes) {
        if (attr?.key) {
          const value = otelValueToJs(attr.value);
          // Only add valid AttributeValue types
          if (
            typeof value === "string" ||
            typeof value === "number" ||
            typeof value === "boolean" ||
            (Array.isArray(value) &&
              value.every(
                (v) =>
                  typeof v === "string" ||
                  typeof v === "number" ||
                  typeof v === "boolean" ||
                  v === null ||
                  v === void 0,
              ))
          ) {
            resourceAttributes[attr.key] = value as AttributeValue;
          }
        }
      }
    }
    return resourceAttributes;
  }

  /**
   * Builds a ReadableSpan from LangWatch span and original OTEL span data
   */
  private buildReadableSpan(
    langWatchSpan: Span,
    originalOtelSpan: DeepPartial<ISpan>,
    originalResource: DeepPartial<IResource> | undefined,
    scope: DeepPartial<IInstrumentationScope> | undefined,
    traceId: string,
  ): ReadableSpan {
    const startTime =
      unixNanoToMs(originalOtelSpan.startTimeUnixNano) ??
      langWatchSpan.timestamps.started_at;
    const endTime =
      unixNanoToMs(originalOtelSpan.endTimeUnixNano) ??
      langWatchSpan.timestamps.finished_at;

    // Convert to hrtime format [seconds, nanoseconds]
    const startTimeHr = startTime
      ? msToUnixNano(startTime as Milliseconds)
      : void 0;
    const endTimeHr = endTime ? msToUnixNano(endTime as Milliseconds) : void 0;

    // Map GenAI attributes
    const genAiAttributes = this.mapGenAiAttributes(langWatchSpan);

    // Map LangWatch-specific attributes
    const langWatchAttributes = this.mapLangWatchAttributes(langWatchSpan);

    // Get original OTEL attributes (excluding ones we're replacing)
    const originalAttributes = otelAttributesToRecord(
      originalOtelSpan.attributes,
    );

    // Merge attributes: GenAI first, then LangWatch, then original (original has lowest priority)
    const mergedAttributes = {
      ...originalAttributes,
      ...langWatchAttributes,
      ...genAiAttributes,
    };

    // Convert attributes to the format ReadableSpan expects
    const spanAttributes: Record<string, any> = {};
    for (const [key, value] of Object.entries(mergedAttributes)) {
      if (value !== void 0 && value !== null) {
        // ReadableSpan expects attributes as plain values
        spanAttributes[key] = value;
      }
    }

    // Convert events
    const events: TimedEvent[] = (originalOtelSpan.events ?? []).map(
      (event) => {
        const eventTime = unixNanoToMs(event?.timeUnixNano);
        const hrTime: HrTime = eventTime ? msToUnixNano(eventTime)! : [0, 0];
        return {
          name: event?.name ?? "",
          time: hrTime,
          attributes: otelAttributesToRecord(event?.attributes),
        };
      },
    );

    // Convert links
    const links: Link[] = (originalOtelSpan.links ?? []).map((link) => {
      const spanContext: SpanContext = {
        traceId: (link?.traceId as string) ?? traceId,
        spanId: (link?.spanId as string) ?? "",
        traceFlags: 0,
      };
      return {
        context: spanContext,
        attributes: otelAttributesToRecord(link?.attributes),
      };
    });

    // Determine status using extracted function
    const status = this.determineSpanStatus(
      langWatchSpan.error,
      originalOtelSpan.status,
    );

    // Build resource attributes using extracted function
    const resourceAttributes = this.buildResourceAttributes(originalResource);

    // Build span context
    const spanContextObj: SpanContext = {
      traceId: traceId,
      spanId: langWatchSpan.span_id,
      traceFlags: 0,
    };

    // Build parent span context if available
    const parentSpanContext: SpanContext | undefined = langWatchSpan.parent_id
      ? {
          traceId: traceId,
          spanId: langWatchSpan.parent_id,
          traceFlags: 0,
        }
      : originalOtelSpan.parentSpanId
        ? {
            traceId: traceId,
            spanId: originalOtelSpan.parentSpanId as string,
            traceFlags: 0,
          }
        : void 0;

    // Build resource - create a minimal Resource-compatible object
    const otelResource: Resource = {
      attributes: resourceAttributes,
      merge: (_other: Resource | null) => otelResource,
      getRawAttributes: (): RawResourceAttribute[] =>
        Object.entries(resourceAttributes).map(
          ([key, value]): RawResourceAttribute => [key, value],
        ),
    };

    // Build instrumentation scope
    const instrumentationScope: InstrumentationScope = scope
      ? {
          name: scope.name ?? "",
          version: scope.version,
        }
      : {
          name: "",
        };

    // Calculate duration
    const durationMs = endTime && startTime ? endTime - startTime : 0;
    const durationHr: HrTime = [
      Math.floor(durationMs / 1000),
      (durationMs % 1000) * 1_000_000,
    ];

    // Build ReadableSpan
    const readableSpan: ReadableSpan = {
      name: langWatchSpan.name ?? originalOtelSpan.name ?? "unknown",
      kind: convertSpanKind(langWatchSpan.type, originalOtelSpan.kind),
      spanContext: () => spanContextObj,
      parentSpanContext: parentSpanContext,
      startTime: (startTimeHr ?? [0, 0]) as HrTime,
      endTime: (endTimeHr ?? [0, 0]) as HrTime,
      attributes: spanAttributes,
      events: events,
      links: links,
      status: status,
      resource: otelResource,
      instrumentationScope: instrumentationScope,
      duration: durationHr,
      ended: true,
      droppedAttributesCount: 0,
      droppedEventsCount: 0,
      droppedLinksCount: 0,
    };

    return readableSpan;
  }

  // Attribute mapping functions using functional composition
  private mapOperationName(span: Span): Attributes {
    const operationName = convertSpanTypeToGenAiOperationName(
      span.type as SpanType,
    );
    return operationName ? { "gen_ai.operation.name": operationName } : {};
  }

  private mapModelAttributes(span: Span): Attributes {
    if (span.type === "llm" && "model" in span && span.model) {
      return {
        "gen_ai.request.model": span.model,
        "gen_ai.response.model": span.model,
      };
    }
    return {};
  }

  private mapInputAttributes(span: Span): Attributes {
    if (!span.input) return {};

    switch (span.input.type) {
      case "chat_messages":
        return { "gen_ai.prompt": JSON.stringify(span.input.value) };
      case "text":
        return { "gen_ai.prompt": span.input.value };
      case "json":
        return { "gen_ai.prompt": JSON.stringify(span.input.value) };
      case "evaluation_result":
      case "guardrail_result":
      case "list":
      case "raw":
      default:
        // For unsupported types, stringify the entire input
        return { "gen_ai.prompt": JSON.stringify(span.input) };
    }
  }

  private mapOutputAttributes(span: Span): Attributes {
    if (!span.output) return {};

    switch (span.output.type) {
      case "chat_messages":
        return { "gen_ai.completion": JSON.stringify(span.output.value) };
      case "text":
        return { "gen_ai.completion": span.output.value };
      case "json":
        return { "gen_ai.completion": JSON.stringify(span.output.value) };
      case "evaluation_result":
      case "guardrail_result":
      case "list":
      case "raw":
      default:
        // For unsupported types, stringify the entire output
        return { "gen_ai.completion": JSON.stringify(span.output) };
    }
  }

  private mapMetricsAttributes(span: Span): Attributes {
    if (!span.metrics) return {};

    const attributes: Attributes = {};
    const { prompt_tokens, completion_tokens } = span.metrics;

    if (prompt_tokens != null) {
      attributes["gen_ai.usage.input_tokens"] = prompt_tokens;
    }
    if (completion_tokens != null) {
      attributes["gen_ai.usage.output_tokens"] = completion_tokens;
    }

    return attributes;
  }

  private mapParamsAttributes(span: Span): Attributes {
    if (!span.params) return {};

    const attributes: Attributes = {};
    const params = span.params;

    // Direct mappings
    const paramMappings: Record<string, keyof typeof params> = {
      "gen_ai.request.temperature": "temperature",
      "gen_ai.request.max_tokens": "max_tokens",
      "gen_ai.request.top_p": "top_p",
      "gen_ai.request.frequency_penalty": "frequency_penalty",
      "gen_ai.request.presence_penalty": "presence_penalty",
      "gen_ai.request.seed": "seed",
    };

    for (const [attrKey, paramKey] of Object.entries(paramMappings)) {
      if (params[paramKey] != null) {
        attributes[attrKey] = params[paramKey];
      }
    }

    // Special handling for stop sequences
    if (params.stop != null) {
      const stopSequences = Array.isArray(params.stop)
        ? params.stop
        : [params.stop];
      attributes["gen_ai.request.stop_sequences"] = stopSequences;
    }

    // Special handling for choice count
    if (params.n != null && params.n !== 1) {
      attributes["gen_ai.request.choice.count"] = params.n;
    }

    return attributes;
  }

  private mapErrorAttributes(span: Span): Attributes {
    if (span.error?.has_error) {
      return { "error.type": span.error.message || "_OTHER" };
    }
    return {};
  }

  /**
   * Maps LangWatch span attributes to GenAI semantic convention attributes
   * Uses functional composition for better maintainability
   */
  private mapGenAiAttributes(langWatchSpan: Span): Attributes {
    return {
      ...this.mapOperationName(langWatchSpan),
      ...this.mapModelAttributes(langWatchSpan),
      ...this.mapInputAttributes(langWatchSpan),
      ...this.mapOutputAttributes(langWatchSpan),
      ...this.mapMetricsAttributes(langWatchSpan),
      ...this.mapParamsAttributes(langWatchSpan),
      ...this.mapErrorAttributes(langWatchSpan),
    };
  }

  // LangWatch-specific attribute mapping functions
  private mapSpanTypeAttribute(span: Span): Attributes {
    return {
      "langwatch.span.type": span.type,
    };
  }

  private mapRagContexts(span: Span): Attributes {
    if (span.type === "rag") {
      const ragSpan = span as RAGSpan;
      if (ragSpan.contexts && ragSpan.contexts.length > 0) {
        return { "langwatch.rag.contexts": JSON.stringify(ragSpan.contexts) };
      }
    }
    return {};
  }

  private mapRemainingParams(span: Span): Attributes {
    if (!span.params) return {};

    const genAiParams = new Set([
      "temperature",
      "max_tokens",
      "top_p",
      "frequency_penalty",
      "presence_penalty",
      "stop",
      "seed",
      "n",
    ]);

    const remainingParams = Object.entries(span.params)
      .filter(([key]) => !genAiParams.has(key))
      .reduce(
        (acc, [key, value]) => ({ ...acc, [key]: value }),
        {} as Attributes,
      );

    return Object.keys(remainingParams).length > 0
      ? { "langwatch.params": JSON.stringify(remainingParams) }
      : {};
  }

  /**
   * Maps LangWatch-specific attributes that don't have GenAI equivalents
   * Uses functional composition for better maintainability
   */
  private mapLangWatchAttributes(langWatchSpan: Span): Attributes {
    return {
      ...this.mapSpanTypeAttribute(langWatchSpan),
      ...this.mapRagContexts(langWatchSpan),
      ...this.mapRemainingParams(langWatchSpan),
    };
  }
}
