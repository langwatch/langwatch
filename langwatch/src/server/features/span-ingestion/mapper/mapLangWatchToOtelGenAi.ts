import type { ReadableSpan, TimedEvent } from "@opentelemetry/sdk-trace-base";
import {
  type IExportTraceServiceRequest,
  type ISpan,
  type IResource,
  type IInstrumentationScope,
  type IKeyValue,
  type IAnyValue,
  ESpanKind,
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
import type { TraceForCollection } from "../../../tracer/otel.traces";
import type { Span, RAGSpan } from "../../../tracer/types";
import type { DeepPartial } from "../../../../utils/types";
import type { SpanIngestionWriteRecord } from "../types";
import { createLogger } from "../../../../utils/logger";
import { getLangWatchTracer } from "langwatch";

const logger = createLogger("langwatch.span-ingestion.mapper");
const tracer = getLangWatchTracer("langwatch.span-ingestion.mapper");

/**
 * Type definition from @opentelemetry/resources for RawResourceAttribute
 * This is copied here to avoid `as unknown` type assertions
 */
type RawResourceAttribute = [
  string,
  AttributeValue | Promise<AttributeValue | undefined> | undefined,
];

/**
 * Maps LangWatch spans to OpenTelemetry ReadableSpan objects with GenAI semantic conventions
 */
export function mapLangWatchSpansToOtelReadableSpans(
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
          const originalOtelSpan = findOriginalOtelSpan(
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

          const resourceSpan = findResourceSpanForSpan(
            traceRequest,
            originalOtelSpan,
          );
          const scopeSpan = findScopeSpanForSpan(
            traceRequest,
            originalOtelSpan,
          );

          const readableSpan = buildReadableSpan(
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
 * Finds the original OTEL span from the trace request by matching spanId and traceId
 */
function findOriginalOtelSpan(
  traceRequest: DeepPartial<IExportTraceServiceRequest>,
  spanId: string,
  traceId: string,
): DeepPartial<ISpan> | undefined {
  for (const resourceSpan of traceRequest.resourceSpans ?? []) {
    for (const scopeSpan of resourceSpan?.scopeSpans ?? []) {
      for (const span of scopeSpan?.spans ?? []) {
        if (span?.spanId === spanId && span?.traceId === traceId) {
          return span;
        }
      }
    }
  }

  return void 0;
}

/**
 * Finds the resource span that contains the given span
 */
function findResourceSpanForSpan(
  traceRequest: DeepPartial<IExportTraceServiceRequest>,
  span: DeepPartial<ISpan>,
):
  | DeepPartial<
      NonNullable<IExportTraceServiceRequest["resourceSpans"]>[number]
    >
  | undefined {
  const resourceSpans = traceRequest.resourceSpans;
  if (!resourceSpans) return void 0;

  for (const resourceSpan of resourceSpans) {
    if (!resourceSpan) continue;
    for (const scopeSpan of resourceSpan?.scopeSpans ?? []) {
      if (scopeSpan?.spans?.some((s) => s?.spanId === span?.spanId)) {
        return resourceSpan;
      }
    }
  }

  return void 0;
}

/**
 * Finds the scope span that contains the given span
 */
function findScopeSpanForSpan(
  traceRequest: DeepPartial<IExportTraceServiceRequest>,
  span: DeepPartial<ISpan>,
):
  | DeepPartial<
      NonNullable<
        NonNullable<IExportTraceServiceRequest["resourceSpans"]>[number]
      >["scopeSpans"]
    >[number]
  | undefined {
  const resourceSpans = traceRequest.resourceSpans;
  if (!resourceSpans) return void 0;

  for (const resourceSpan of resourceSpans) {
    if (!resourceSpan) continue;
    for (const scopeSpan of resourceSpan?.scopeSpans ?? []) {
      if (scopeSpan?.spans?.some((s) => s?.spanId === span?.spanId)) {
        return scopeSpan;
      }
    }
  }

  return void 0;
}

/**
 * Converts Unix nanoseconds timestamp to milliseconds
 */
function unixNanoToMs(
  timestamp:
    | DeepPartial<{ low: number; high: number }>
    | number
    | string
    | undefined,
): number | undefined {
  if (timestamp === void 0 || timestamp === null) {
    return void 0;
  }

  if (typeof timestamp === "number") {
    return Math.round(timestamp / 1_000_000);
  }

  if (typeof timestamp === "string") {
    const num = parseInt(timestamp, 10);
    return isNaN(num) ? void 0 : Math.round(num / 1_000_000);
  }

  // Handle Long format (high/low bits)
  if (
    typeof timestamp === "object" &&
    timestamp !== null &&
    "high" in timestamp &&
    "low" in timestamp
  ) {
    const { high, low } = timestamp as { high: number; low: number };
    if (typeof high === "number" && typeof low === "number") {
      const value = (BigInt(high) << 32n) | (BigInt(low) & 0xffffffffn);
      return Math.round(Number(value) / 1_000_000);
    }
  }

  return void 0;
}

/**
 * Converts milliseconds timestamp to Unix nanoseconds (hrtime format)
 */
function msToUnixNano(
  timestamp: number | undefined,
): [number, number] | undefined {
  if (timestamp === void 0) {
    return void 0;
  }

  const nanoseconds = BigInt(timestamp) * 1_000_000n;
  const seconds = Number(nanoseconds / 1_000_000_000n);
  const nanos = Number(nanoseconds % 1_000_000_000n);

  return [seconds, nanos];
}

/**
 * Converts LangWatch span kind to OpenTelemetry SpanKind
 */
function convertSpanKind(
  langWatchType: Span["type"],
  originalKind: DeepPartial<ISpan>["kind"],
): SpanKind {
  // Try to preserve original kind if available
  if (originalKind !== void 0 && originalKind !== null) {
    if (originalKind === ESpanKind.SPAN_KIND_SERVER) {
      return SpanKind.SERVER;
    }
    if (originalKind === ESpanKind.SPAN_KIND_CLIENT) {
      return SpanKind.CLIENT;
    }
    if (originalKind === ESpanKind.SPAN_KIND_PRODUCER) {
      return SpanKind.PRODUCER;
    }
    if (originalKind === ESpanKind.SPAN_KIND_CONSUMER) {
      return SpanKind.CONSUMER;
    }
    if (originalKind === ESpanKind.SPAN_KIND_INTERNAL) {
      return SpanKind.INTERNAL;
    }
  }

  // Fallback to type-based mapping
  switch (langWatchType) {
    case "server":
      return SpanKind.SERVER;
    case "client":
      return SpanKind.CLIENT;
    case "producer":
      return SpanKind.PRODUCER;
    case "consumer":
      return SpanKind.CONSUMER;
    default:
      return SpanKind.INTERNAL;
  }
}

/**
 * Converts LangWatch span type to GenAI operation name
 */
function convertSpanTypeToGenAiOperationName(
  type: Span["type"],
): string | undefined {
  switch (type) {
    case "llm":
      return "chat";
    case "agent":
      return "invoke_agent";
    case "tool":
      return "execute_tool";
    case "rag":
      return "embeddings"; // RAG typically involves embeddings
    default:
      return void 0;
  }
}

/**
 * Maps LangWatch span attributes to GenAI semantic convention attributes
 */
function mapGenAiAttributes(langWatchSpan: Span): Attributes {
  const attributes: Attributes = {};

  // Map operation name
  const operationName = convertSpanTypeToGenAiOperationName(langWatchSpan.type);
  if (operationName) {
    attributes["gen_ai.operation.name"] = operationName;
  }

  // Map model (for LLM spans)
  if (
    langWatchSpan.type === "llm" &&
    "model" in langWatchSpan &&
    langWatchSpan.model
  ) {
    attributes["gen_ai.request.model"] = langWatchSpan.model;
    attributes["gen_ai.response.model"] = langWatchSpan.model;
  }

  // Map input (prompt)
  if (langWatchSpan.input) {
    if (langWatchSpan.input.type === "chat_messages") {
      attributes["gen_ai.prompt"] = JSON.stringify(langWatchSpan.input.value);
    } else if (langWatchSpan.input.type === "text") {
      attributes["gen_ai.prompt"] = langWatchSpan.input.value;
    } else if (langWatchSpan.input.type === "json") {
      attributes["gen_ai.prompt"] = JSON.stringify(langWatchSpan.input.value);
    }
  }

  // Map output (completion)
  if (langWatchSpan.output) {
    if (langWatchSpan.output.type === "chat_messages") {
      attributes["gen_ai.completion"] = JSON.stringify(
        langWatchSpan.output.value,
      );
    } else if (langWatchSpan.output.type === "text") {
      attributes["gen_ai.completion"] = langWatchSpan.output.value;
    } else if (langWatchSpan.output.type === "json") {
      attributes["gen_ai.completion"] = JSON.stringify(
        langWatchSpan.output.value,
      );
    }
  }

  // Map metrics
  if (langWatchSpan.metrics) {
    if (
      langWatchSpan.metrics.prompt_tokens !== void 0 &&
      langWatchSpan.metrics.prompt_tokens !== null
    ) {
      attributes["gen_ai.usage.input_tokens"] =
        langWatchSpan.metrics.prompt_tokens;
    }
    if (
      langWatchSpan.metrics.completion_tokens !== void 0 &&
      langWatchSpan.metrics.completion_tokens !== null
    ) {
      attributes["gen_ai.usage.output_tokens"] =
        langWatchSpan.metrics.completion_tokens;
    }
  }

  // Map parameters
  if (langWatchSpan.params) {
    if (
      langWatchSpan.params.temperature !== void 0 &&
      langWatchSpan.params.temperature !== null
    ) {
      attributes["gen_ai.request.temperature"] =
        langWatchSpan.params.temperature;
    }
    if (
      langWatchSpan.params.max_tokens !== void 0 &&
      langWatchSpan.params.max_tokens !== null
    ) {
      attributes["gen_ai.request.max_tokens"] = langWatchSpan.params.max_tokens;
    }
    if (
      langWatchSpan.params.top_p !== void 0 &&
      langWatchSpan.params.top_p !== null
    ) {
      attributes["gen_ai.request.top_p"] = langWatchSpan.params.top_p;
    }
    if (
      langWatchSpan.params.frequency_penalty !== void 0 &&
      langWatchSpan.params.frequency_penalty !== null
    ) {
      attributes["gen_ai.request.frequency_penalty"] =
        langWatchSpan.params.frequency_penalty;
    }
    if (
      langWatchSpan.params.presence_penalty !== void 0 &&
      langWatchSpan.params.presence_penalty !== null
    ) {
      attributes["gen_ai.request.presence_penalty"] =
        langWatchSpan.params.presence_penalty;
    }
    if (
      langWatchSpan.params.stop !== void 0 &&
      langWatchSpan.params.stop !== null
    ) {
      const stopSequences = Array.isArray(langWatchSpan.params.stop)
        ? langWatchSpan.params.stop
        : [langWatchSpan.params.stop];
      attributes["gen_ai.request.stop_sequences"] = stopSequences;
    }
    if (
      langWatchSpan.params.seed !== void 0 &&
      langWatchSpan.params.seed !== null
    ) {
      attributes["gen_ai.request.seed"] = langWatchSpan.params.seed;
    }
    if (
      langWatchSpan.params.n !== void 0 &&
      langWatchSpan.params.n !== null &&
      langWatchSpan.params.n !== 1
    ) {
      attributes["gen_ai.request.choice.count"] = langWatchSpan.params.n;
    }
  }

  // Map error
  if (langWatchSpan.error?.has_error) {
    attributes["error.type"] = langWatchSpan.error.message || "_OTHER";
  }

  return attributes;
}

/**
 * Maps LangWatch-specific attributes that don't have GenAI equivalents
 */
function mapLangWatchAttributes(langWatchSpan: Span): Attributes {
  const attributes: Attributes = {};

  // Preserve original span type
  attributes["langwatch.span.type"] = langWatchSpan.type;

  // Preserve RAG contexts
  if (langWatchSpan.type === "rag") {
    const ragSpan = langWatchSpan as RAGSpan;
    if (ragSpan.contexts && ragSpan.contexts.length > 0) {
      attributes["langwatch.rag.contexts"] = JSON.stringify(ragSpan.contexts);
    }
  }

  // Preserve any remaining params that weren't mapped to GenAI
  if (langWatchSpan.params) {
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

    const remainingParams: Attributes = {};
    for (const [key, value] of Object.entries(langWatchSpan.params)) {
      if (!genAiParams.has(key)) {
        remainingParams[key] = value;
      }
    }

    if (Object.keys(remainingParams).length > 0) {
      attributes["langwatch.params"] = JSON.stringify(remainingParams);
    }
  }

  return attributes;
}

/**
 * Converts OTEL IAnyValue to a JavaScript value
 * Note: Returns a broader type than AttributeValue because OTEL can have nested structures.
 * The caller should handle conversion to valid AttributeValue types when needed.
 */
function otelValueToJs(
  value: DeepPartial<IAnyValue> | undefined,
):
  | string
  | number
  | boolean
  | (string | number | boolean | null | undefined)[]
  | Record<string, string | number | boolean>
  | undefined {
  if (!value) return void 0;

  if (value.stringValue !== void 0 && value.stringValue !== null) {
    return value.stringValue;
  }
  if (value.boolValue !== void 0 && value.boolValue !== null) {
    return value.boolValue;
  }
  if (value.intValue !== void 0 && value.intValue !== null) {
    // Check if it's a Long object with toInt method
    if (
      typeof value.intValue === "object" &&
      value.intValue !== null &&
      "toInt" in value.intValue
    ) {
      const longObj = value.intValue as { toInt: () => number };
      if (typeof longObj.toInt === "function") {
        return longObj.toInt();
      }
    }
    return Number(value.intValue);
  }

  if (value.doubleValue !== void 0 && value.doubleValue !== null) {
    // Check if it's a Long object with toNumber method
    if (
      typeof value.doubleValue === "object" &&
      value.doubleValue !== null &&
      "toNumber" in value.doubleValue
    ) {
      const longObj = value.doubleValue as { toNumber: () => number };
      if (typeof longObj.toNumber === "function") {
        return longObj.toNumber();
      }
    }
    return Number(value.doubleValue);
  }

  if (value.arrayValue?.values) {
    const arrayValues = value.arrayValue.values
      .map(otelValueToJs)
      .filter(
        (v): v is string | number | boolean =>
          typeof v === "string" ||
          typeof v === "number" ||
          typeof v === "boolean",
      );
    return arrayValues;
  }
  if (value.kvlistValue?.values) {
    const result: Record<string, string | number | boolean> = {};
    for (const kv of value.kvlistValue.values ?? []) {
      if (kv?.key) {
        const kvValue = otelValueToJs(kv.value);
        // Only include primitive values in the result
        if (
          typeof kvValue === "string" ||
          typeof kvValue === "number" ||
          typeof kvValue === "boolean"
        ) {
          result[kv.key] = kvValue;
        }
      }
    }
    return result;
  }

  return void 0;
}

/**
 * Converts OTEL attributes to a flat record
 */
function otelAttributesToRecord(
  attributes: DeepPartial<IKeyValue[]> | undefined,
): Attributes {
  const result: Attributes = {};
  for (const attr of attributes ?? []) {
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
        result[attr.key] = value as AttributeValue;
      }
    }
  }
  return result;
}

/**
 * Builds a ReadableSpan from LangWatch span and original OTEL span data
 */
function buildReadableSpan(
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
  const startTimeHr = msToUnixNano(startTime);
  const endTimeHr = msToUnixNano(endTime);

  // Map GenAI attributes
  const genAiAttributes = mapGenAiAttributes(langWatchSpan);

  // Map LangWatch-specific attributes
  const langWatchAttributes = mapLangWatchAttributes(langWatchSpan);

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
  const events: TimedEvent[] = (originalOtelSpan.events ?? []).map((event) => {
    const eventTime = unixNanoToMs(event?.timeUnixNano);
    const hrTime: HrTime = eventTime ? msToUnixNano(eventTime)! : [0, 0];
    return {
      name: event?.name ?? "",
      time: hrTime,
      attributes: otelAttributesToRecord(event?.attributes),
    };
  });

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

  // Determine status
  let status: SpanStatus = {
    code: SpanStatusCode.OK,
  };

  if (langWatchSpan.error?.has_error) {
    status = {
      code: SpanStatusCode.ERROR,
      message: langWatchSpan.error.message,
    };
  } else if (originalOtelSpan.status?.code !== void 0) {
    const statusCode = originalOtelSpan.status.code;
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
        message: originalOtelSpan.status?.message,
      };
    } else if (codeValue === 1) {
      status = {
        code: SpanStatusCode.OK,
      };
    }
  }

  // Build resource attributes
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
