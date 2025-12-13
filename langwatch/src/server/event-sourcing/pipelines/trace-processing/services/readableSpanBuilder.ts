import {
  type Attributes,
  type AttributeValue,
  type HrTime,
  type Link,
  type SpanContext,
  type SpanStatus,
  SpanStatusCode,
} from "@opentelemetry/api";
import type { InstrumentationScope } from "@opentelemetry/core";
import type {
  IInstrumentationScope,
  IResource,
  ISpan,
} from "@opentelemetry/otlp-transformer";
import { resourceFromAttributes } from "@opentelemetry/resources";
import type { ReadableSpan, TimedEvent } from "@opentelemetry/sdk-trace-base";
import type { DeepPartial } from "../../../../../utils/types";
import type { Span } from "../../../../tracer/types";
import {
  type Milliseconds,
  OtelConversionUtils,
} from "../utils/otelConversion.utils";
import { GenAIAttributeMapperService } from "./genAIAttributeMapperService";
import { LangWatchAttributeMapperService } from "./langWatchAttributeMapperService";

/**
 * OpenTelemetry status code constants
 */
const OTEL_STATUS_CODE_OK = 1;
const OTEL_STATUS_CODE_ERROR = 2;

/**
 * Builder for constructing OpenTelemetry ReadableSpan objects from LangWatch spans.
 *
 * Handles:
 * - Span context building
 * - Parent span context resolution
 * - Attribute merging and filtering
 * - Event and link mapping
 * - Status determination
 * - Resource and instrumentation scope building
 *
 * @example
 * ```typescript
 * const builder = new ReadableSpanBuilder();
 * const readableSpan = builder.buildReadableSpan(
 *   langWatchSpan,
 *   originalOtelSpan,
 *   resource,
 *   scope,
 *   traceId,
 *   threadId,
 * );
 * ```
 */
export class ReadableSpanBuilder {
  private readonly genAiMapper: GenAIAttributeMapperService;
  private readonly langWatchMapper: LangWatchAttributeMapperService;

  constructor(
    genAiMapper: GenAIAttributeMapperService = new GenAIAttributeMapperService(),
    langWatchMapper: LangWatchAttributeMapperService = new LangWatchAttributeMapperService(),
  ) {
    this.genAiMapper = genAiMapper;
    this.langWatchMapper = langWatchMapper;
  }

  /**
   * Builds a ReadableSpan from LangWatch span and original OTEL span data.
   *
   * @param langWatchSpan - The LangWatch span
   * @param originalOtelSpan - The original OTEL span data
   * @param originalResource - The original OTEL resource
   * @param scope - The instrumentation scope
   * @param traceId - The trace ID
   * @param threadId - Optional thread ID for conversation tracking
   * @returns A ReadableSpan conforming to OTEL SDK interface
   */
  buildReadableSpan(
    langWatchSpan: Span,
    originalOtelSpan: DeepPartial<ISpan>,
    originalResource: DeepPartial<IResource> | undefined,
    scope: DeepPartial<IInstrumentationScope> | undefined,
    traceId: string,
    threadId: string | undefined,
  ): ReadableSpan {
    // Extract timestamps
    const startTimeMs =
      OtelConversionUtils.unixNanoToMs(originalOtelSpan.startTimeUnixNano) ??
      (langWatchSpan.timestamps.started_at as Milliseconds);
    const endTimeMs =
      OtelConversionUtils.unixNanoToMs(originalOtelSpan.endTimeUnixNano) ??
      (langWatchSpan.timestamps.finished_at as Milliseconds);
    const startTimeHr = this.toHrTime(startTimeMs);
    const endTimeHr = this.toHrTime(endTimeMs);

    // Build attributes
    const genAiAttributes =
      langWatchSpan.type === "llm"
        ? this.genAiMapper.mapGenAiAttributes(langWatchSpan)
        : {};
    const langWatchAttributes =
      this.langWatchMapper.mapLangWatchAttributes(langWatchSpan);
    const originalAttributes = OtelConversionUtils.otelAttributesToRecord(
      originalOtelSpan.attributes,
    );

    const spanAttributes = this.mergeAndFilterAttributes(
      originalAttributes,
      langWatchAttributes,
      genAiAttributes,
      langWatchSpan,
      threadId,
    );

    // Map events and links
    const events = this.mapOtelEvents(originalOtelSpan.events);
    const links = this.mapOtelLinks(originalOtelSpan.links, traceId);

    // Build status and resource
    const status = this.determineSpanStatus(
      langWatchSpan.error,
      originalOtelSpan.status,
    );
    const resourceAttributes = this.buildResourceAttributes(originalResource);
    const otelResource = resourceFromAttributes(resourceAttributes);

    // Build contexts
    const spanTraceFlags = this.extractTraceFlags(originalOtelSpan);
    const spanContextObj = this.buildSpanContext(
      traceId,
      langWatchSpan.span_id,
      spanTraceFlags,
    );
    const parentSpanContext = this.buildParentSpanContext(
      langWatchSpan,
      originalOtelSpan,
      traceId,
      spanTraceFlags,
    );

    // Build instrumentation scope and calculate duration
    const instrumentationScope = this.buildInstrumentationScope(scope);
    const durationHr = this.calculateDuration(startTimeMs, endTimeMs);

    // Construct ReadableSpan
    return {
      name: langWatchSpan.name ?? originalOtelSpan.name ?? "unknown",
      kind: OtelConversionUtils.convertSpanKind(
        langWatchSpan.type,
        originalOtelSpan.kind,
      ),
      spanContext: () => spanContextObj,
      parentSpanContext,
      startTime: startTimeHr,
      endTime: endTimeHr,
      attributes: spanAttributes,
      events,
      links,
      status,
      resource: otelResource,
      instrumentationScope,
      duration: durationHr,
      ended: true,
      droppedAttributesCount: 0,
      droppedEventsCount: 0,
      droppedLinksCount: 0,
    };
  }

  /**
   * Converts milliseconds to HrTime format.
   */
  private toHrTime(ms: Milliseconds | undefined): HrTime {
    return OtelConversionUtils.msToUnixNano(ms) ?? [0, 0];
  }

  /**
   * Builds span context from trace ID and span ID.
   */
  private buildSpanContext(
    traceId: string,
    spanId: string,
    traceFlags: number,
  ): SpanContext {
    return {
      traceId,
      spanId,
      traceFlags,
    };
  }

  /**
   * Builds parent span context from LangWatch span or original OTEL span.
   */
  private buildParentSpanContext(
    langWatchSpan: Span,
    originalOtelSpan: DeepPartial<ISpan>,
    traceId: string,
    traceFlags: number,
  ): SpanContext | undefined {
    if (langWatchSpan.parent_id) {
      return this.buildSpanContext(
        traceId,
        langWatchSpan.parent_id,
        traceFlags,
      );
    }
    if (typeof originalOtelSpan.parentSpanId === "string") {
      return this.buildSpanContext(
        traceId,
        originalOtelSpan.parentSpanId,
        traceFlags,
      );
    }
    return undefined;
  }

  /**
   * Checks if a value is a primitive attribute value.
   */
  private isPrimitiveAttributeValue(
    value: unknown,
  ): value is string | number | boolean {
    return (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    );
  }

  /**
   * Checks if a value is a valid attribute value.
   */
  private isAttributeValue(value: unknown): value is AttributeValue {
    return (
      this.isPrimitiveAttributeValue(value) ||
      (Array.isArray(value) &&
        value.every((v) => this.isPrimitiveAttributeValue(v)))
    );
  }

  /**
   * Merges and filters attributes from multiple sources.
   */
  private mergeAndFilterAttributes(
    originalAttributes: Attributes,
    langWatchAttributes: Attributes,
    genAiAttributes: Attributes,
    langWatchSpan: Span,
    threadId: string | undefined,
  ): Attributes {
    const mergedAttributes: Record<string, AttributeValue | undefined> = {
      ...originalAttributes,
      ...langWatchAttributes,
      ...genAiAttributes,
    };

    // Remove langwatch.input and langwatch.output for LLM spans (replaced by gen_ai attributes)
    if (langWatchSpan.type === "llm") {
      mergedAttributes["langwatch.input"] = undefined;
      mergedAttributes["langwatch.output"] = undefined;
    }

    // Handle thread ID conversion to gen_ai.conversation.id
    if (threadId && typeof threadId === "string") {
      mergedAttributes["gen_ai.conversation.id"] = threadId;
    } else if (
      typeof mergedAttributes["langwatch.thread.id"] === "string" &&
      mergedAttributes["langwatch.thread.id"]
    ) {
      mergedAttributes["gen_ai.conversation.id"] =
        mergedAttributes["langwatch.thread.id"];
      mergedAttributes["langwatch.thread.id"] = undefined;
    }

    // Filter out undefined/null values and invalid attribute types
    const spanAttributes: Attributes = {};
    for (const [key, value] of Object.entries(mergedAttributes)) {
      if (value === undefined || value === null) continue;
      if (!this.isAttributeValue(value)) continue;
      spanAttributes[key] = value;
    }

    return spanAttributes;
  }

  /**
   * Maps OTEL events to TimedEvent format.
   */
  private mapOtelEvents(events: DeepPartial<ISpan>["events"]): TimedEvent[] {
    return (events ?? []).map((event) => {
      const eventTime = OtelConversionUtils.unixNanoToMs(event?.timeUnixNano);
      const hrTime = this.toHrTime(eventTime);
      return {
        name: event?.name ?? "",
        time: hrTime,
        attributes: OtelConversionUtils.otelAttributesToRecord(
          event?.attributes,
        ),
      };
    });
  }

  /**
   * Maps OTEL links to Link format.
   */
  private mapOtelLinks(
    links: DeepPartial<ISpan>["links"],
    traceId: string,
  ): Link[] {
    if (!links) return [];
    return links.map((link) => {
      if (!link) {
        return {
          context: {
            traceId,
            spanId: "",
            traceFlags: 0,
          },
          attributes: {},
        };
      }
      const linkWithFlags: typeof link & {
        traceFlags?: number;
        flags?: number;
      } = link;
      const linkTraceFlags =
        typeof linkWithFlags.traceFlags === "number"
          ? linkWithFlags.traceFlags
          : typeof linkWithFlags.flags === "number"
            ? linkWithFlags.flags
            : 0;
      const linkTraceId =
        typeof link.traceId === "string" ? link.traceId : traceId;
      const linkSpanId = typeof link.spanId === "string" ? link.spanId : "";
      const spanContext: SpanContext = {
        traceId: linkTraceId,
        spanId: linkSpanId,
        traceFlags: linkTraceFlags,
      };
      return {
        context: spanContext,
        attributes: OtelConversionUtils.otelAttributesToRecord(link.attributes),
      };
    });
  }

  /**
   * Builds instrumentation scope from OTEL scope.
   */
  private buildInstrumentationScope(
    scope: DeepPartial<IInstrumentationScope> | undefined,
  ): InstrumentationScope {
    return scope
      ? {
          name: scope.name ?? "",
          version: scope.version,
        }
      : {
          name: "",
        };
  }

  /**
   * Calculates duration in milliseconds and converts to HrTime.
   */
  private calculateDuration(
    startTime: Milliseconds | undefined,
    endTime: Milliseconds | undefined,
  ): HrTime {
    const durationMs =
      endTime !== undefined && startTime !== undefined
        ? ((endTime - startTime) as number)
        : 0;
    return [Math.floor(durationMs / 1000), (durationMs % 1000) * 1_000_000];
  }

  /**
   * Extracts trace flags from span with fallback support.
   */
  private extractTraceFlags(span: DeepPartial<ISpan>): number {
    const spanWithFlags: DeepPartial<ISpan> & {
      traceFlags?: number;
      flags?: number;
    } = span;

    return typeof spanWithFlags.traceFlags === "number"
      ? spanWithFlags.traceFlags
      : typeof spanWithFlags.flags === "number"
        ? spanWithFlags.flags
        : 0;
  }

  /**
   * Parses OpenTelemetry status code from various formats (number, string, enum).
   * Returns numeric code value or undefined if unparseable.
   */
  private parseOtelStatusCode(statusCode: unknown): number | undefined {
    if (typeof statusCode === "number") {
      return statusCode;
    }
    const codeStr = String(statusCode);
    if (codeStr.includes("ERROR")) {
      return OTEL_STATUS_CODE_ERROR;
    }
    if (codeStr.includes("OK")) {
      return OTEL_STATUS_CODE_OK;
    }
    return undefined;
  }

  /**
   * Determines the span status based on LangWatch span error and original OTEL status.
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
    } else if (originalOtelStatus?.code !== undefined) {
      const codeValue = this.parseOtelStatusCode(originalOtelStatus.code);
      if (codeValue === OTEL_STATUS_CODE_ERROR) {
        status = {
          code: SpanStatusCode.ERROR,
          message: originalOtelStatus?.message,
        };
      } else if (codeValue === OTEL_STATUS_CODE_OK) {
        status = {
          code: SpanStatusCode.OK,
        };
      }
    }

    return status;
  }

  /**
   * Builds resource attributes from original OTEL resource.
   */
  buildResourceAttributes(
    originalResource: DeepPartial<IResource> | undefined,
  ): Attributes {
    const resourceAttributes: Attributes = {};

    const attrs = originalResource?.attributes;
    if (!attrs) return resourceAttributes;

    for (const attr of attrs) {
      const key = attr?.key;
      if (!key) continue;

      const value = OtelConversionUtils.otelValueToJs(attr.value);
      if (!this.isAttributeValue(value)) continue;

      resourceAttributes[key] = value;
    }

    return resourceAttributes;
  }
}

export const readableSpanBuilder = new ReadableSpanBuilder();
