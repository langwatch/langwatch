import { ESpanKind } from "@opentelemetry/otlp-transformer-next/build/esm/trace/internal-types.js";
import { ATTR_KEYS } from "@langwatch/trace-contract";
import type { OtlpKeyValue, OtlpResource, OtlpSpan } from "@langwatch/trace-contract";
import type {
  CustomMetadata,
  ReservedTraceMetadata,
  Span,
  SpanTypes,
} from "@langwatch/trace-contract";

function spanTypeToESpanKind(type: SpanTypes): ESpanKind {
  switch (type) {
    case "server":
      return ESpanKind.SPAN_KIND_SERVER;
    case "client":
      return ESpanKind.SPAN_KIND_CLIENT;
    case "producer":
      return ESpanKind.SPAN_KIND_PRODUCER;
    case "consumer":
      return ESpanKind.SPAN_KIND_CONSUMER;
    default:
      return ESpanKind.SPAN_KIND_INTERNAL;
  }
}

function stringAttr(key: string, value: string): OtlpKeyValue {
  return { key, value: { stringValue: value } };
}

function doubleAttr(key: string, value: number): OtlpKeyValue {
  return { key, value: { doubleValue: value } };
}

function boolAttr(key: string, value: boolean): OtlpKeyValue {
  return { key, value: { boolValue: value } };
}

function msToNanoString(ms: number): string {
  return String(ms * 1_000_000);
}

/** Every numeric usage metric a span carries, under its canonical attribute key. */
const SPAN_METRIC_ATTRIBUTES = [
  ["prompt_tokens", ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS],
  ["completion_tokens", ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS],
  ["reasoning_tokens", ATTR_KEYS.GEN_AI_USAGE_REASONING_TOKENS],
  ["cache_read_input_tokens", ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS],
  ["cache_creation_input_tokens", ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS],
  ["cost", ATTR_KEYS.LANGWATCH_SPAN_COST],
] as const;

function metricAttributes(metrics: NonNullable<Span["metrics"]>): OtlpKeyValue[] {
  const attrs: OtlpKeyValue[] = [];
  for (const [field, key] of SPAN_METRIC_ATTRIBUTES) {
    const value = metrics[field];
    if (value != null) {
      attrs.push(doubleAttr(key, value));
    }
  }

  if (metrics.tokens_estimated != null) {
    attrs.push(boolAttr(ATTR_KEYS.LANGWATCH_TOKENS_ESTIMATED, metrics.tokens_estimated));
  }

  return attrs;
}

/** The optional string-valued span fields, in the order the collector has always written them. */
function spanStringAttributes(span: Span): OtlpKeyValue[] {
  const attrs: OtlpKeyValue[] = [];

  if (span.input) {
    attrs.push(stringAttr(ATTR_KEYS.LANGWATCH_INPUT, JSON.stringify(span.input)));
  }

  if (span.output) {
    attrs.push(stringAttr(ATTR_KEYS.LANGWATCH_OUTPUT, JSON.stringify(span.output)));
  }

  if ("model" in span && span.model) {
    attrs.push(stringAttr(ATTR_KEYS.GEN_AI_REQUEST_MODEL, span.model));
  }

  if ("vendor" in span && span.vendor) {
    attrs.push(stringAttr(ATTR_KEYS.GEN_AI_SYSTEM, span.vendor));
  }

  if ("contexts" in span && span.contexts) {
    attrs.push(stringAttr(ATTR_KEYS.LANGWATCH_RAG_CONTEXTS, JSON.stringify(span.contexts)));
  }

  return attrs;
}

function buildSpanAttributes(span: Span): OtlpKeyValue[] {
  const attrs: OtlpKeyValue[] = [stringAttr(ATTR_KEYS.SPAN_TYPE, span.type)];

  attrs.push(...spanStringAttributes(span));

  if (span.metrics) {
    attrs.push(...metricAttributes(span.metrics));
  }

  if (span.params) {
    attrs.push(stringAttr(ATTR_KEYS.LANGWATCH_PARAMS, JSON.stringify(span.params)));
  }

  if (span.error) {
    attrs.push(boolAttr(ATTR_KEYS.ERROR_HAS_ERROR, true));
    attrs.push(stringAttr(ATTR_KEYS.ERROR_MESSAGE, span.error.message));
  }

  return attrs;
}

/** One custom metadata value, under the attribute type its JavaScript type implies. */
function customMetadataAttribute(attrKey: string, value: unknown): OtlpKeyValue {
  if (typeof value === "string") {
    return stringAttr(attrKey, value);
  }

  if (typeof value === "number") {
    return doubleAttr(attrKey, value);
  }

  if (typeof value === "boolean") {
    return boolAttr(attrKey, value);
  }

  return stringAttr(attrKey, JSON.stringify(value));
}

/** The reserved trace metadata, each field under its canonical resource attribute. */
function reservedMetadataAttributes(metadata: ReservedTraceMetadata): OtlpKeyValue[] {
  const attrs: OtlpKeyValue[] = [];

  const strings: [string | undefined | null, string][] = [
    [metadata.thread_id, ATTR_KEYS.LANGWATCH_THREAD_ID],
    [metadata.user_id, ATTR_KEYS.LANGWATCH_USER_ID],
    [metadata.customer_id, ATTR_KEYS.LANGWATCH_CUSTOMER_ID],
  ];
  for (const [value, key] of strings) {
    if (value) {
      attrs.push(stringAttr(key, value));
    }
  }

  if (metadata.labels && metadata.labels.length > 0) {
    attrs.push(stringAttr(ATTR_KEYS.LANGWATCH_LABELS, JSON.stringify(metadata.labels)));
  }

  if (metadata.sdk_version) {
    attrs.push(stringAttr("langwatch.sdk.version", metadata.sdk_version));
  }

  if (metadata.sdk_language) {
    attrs.push(stringAttr("langwatch.sdk.language", metadata.sdk_language));
  }

  return attrs;
}

function buildResource({
  reservedTraceMetadata,
  customMetadata,
  expectedOutput,
}: {
  reservedTraceMetadata: ReservedTraceMetadata;
  customMetadata: CustomMetadata;
  expectedOutput?: string | null;
}): OtlpResource | null {
  const attrs: OtlpKeyValue[] = reservedMetadataAttributes(reservedTraceMetadata);

  for (const [key, value] of Object.entries(customMetadata)) {
    if (value == null) {
      continue;
    }

    attrs.push(customMetadataAttribute(`langwatch.metadata.${key}`, value));
  }

  if (expectedOutput) {
    attrs.push(stringAttr("langwatch.expected_output", expectedOutput));
  }

  return attrs.length > 0 ? { attributes: attrs } : null;
}

const convertSpanToOtlp = (span: Span): OtlpSpan => ({
  traceId: span.trace_id,
  spanId: span.span_id,
  traceState: null,
  parentSpanId: span.parent_id ?? null,
  name: span.name ?? span.type,
  kind: spanTypeToESpanKind(span.type),
  startTimeUnixNano: msToNanoString(span.timestamps.started_at),
  endTimeUnixNano: msToNanoString(span.timestamps.finished_at),
  attributes: buildSpanAttributes(span),
  events: span.timestamps.first_token_at
    ? [
        {
          name: "first_token",
          timeUnixNano: msToNanoString(span.timestamps.first_token_at),
          attributes: [],
        },
      ]
    : [],
  links: [],
  status: span.error ? { code: 2, message: span.error.message } : { code: 1 },
  droppedAttributesCount: 0,
  droppedEventsCount: 0,
  droppedLinksCount: 0,
});

export class TraceCollectorSpanService {
  static create(): TraceCollectorSpanService {
    return new TraceCollectorSpanService();
  }

  static convertSpanToOtlp = convertSpanToOtlp;

  static buildResource = buildResource;
}
