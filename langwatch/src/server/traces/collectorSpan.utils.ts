import { ESpanKind } from "@opentelemetry/otlp-transformer-next/build/esm/trace/internal-types";
import { ATTR_KEYS } from "~/server/app-layer/traces/canonicalisation/extractors/_constants";
import type { OtlpKeyValue, OtlpResource, OtlpSpan } from "../event-sourcing/pipelines/trace-processing/schemas/otlp";
import type {
  CustomMetadata,
  ReservedTraceMetadata,
  Span,
  SpanTypes,
} from "../tracer/types";

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

function buildSpanAttributes(span: Span): OtlpKeyValue[] {
  const attrs: OtlpKeyValue[] = [];

  attrs.push(stringAttr(ATTR_KEYS.SPAN_TYPE, span.type));

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
    attrs.push(
      stringAttr(ATTR_KEYS.LANGWATCH_RAG_CONTEXTS, JSON.stringify(span.contexts)),
    );
  }

  if (span.metrics) {
    if (span.metrics.prompt_tokens != null) {
      attrs.push(doubleAttr(ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS, span.metrics.prompt_tokens));
    }
    if (span.metrics.completion_tokens != null) {
      attrs.push(doubleAttr(ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS, span.metrics.completion_tokens));
    }
    if (span.metrics.reasoning_tokens != null) {
      attrs.push(doubleAttr(ATTR_KEYS.GEN_AI_USAGE_REASONING_TOKENS, span.metrics.reasoning_tokens));
    }
    if (span.metrics.cache_read_input_tokens != null) {
      attrs.push(doubleAttr(ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS, span.metrics.cache_read_input_tokens));
    }
    if (span.metrics.cache_creation_input_tokens != null) {
      attrs.push(doubleAttr(ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS, span.metrics.cache_creation_input_tokens));
    }
    if (span.metrics.tokens_estimated != null) {
      attrs.push(boolAttr(ATTR_KEYS.LANGWATCH_TOKENS_ESTIMATED, span.metrics.tokens_estimated));
    }
    if (span.metrics.cost != null) {
      attrs.push(doubleAttr(ATTR_KEYS.LANGWATCH_SPAN_COST, span.metrics.cost));
    }
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

function buildResource({
  reservedTraceMetadata,
  customMetadata,
  expectedOutput,
}: {
  reservedTraceMetadata: ReservedTraceMetadata;
  customMetadata: CustomMetadata;
  expectedOutput?: string | null;
}): OtlpResource | null {
  const attrs: OtlpKeyValue[] = [];

  if (reservedTraceMetadata.thread_id) {
    attrs.push(stringAttr(ATTR_KEYS.LANGWATCH_THREAD_ID, reservedTraceMetadata.thread_id));
  }
  if (reservedTraceMetadata.user_id) {
    attrs.push(stringAttr(ATTR_KEYS.LANGWATCH_USER_ID, reservedTraceMetadata.user_id));
  }
  if (reservedTraceMetadata.customer_id) {
    attrs.push(stringAttr(ATTR_KEYS.LANGWATCH_CUSTOMER_ID, reservedTraceMetadata.customer_id));
  }
  if (reservedTraceMetadata.labels && reservedTraceMetadata.labels.length > 0) {
    attrs.push(stringAttr(ATTR_KEYS.LANGWATCH_LABELS, JSON.stringify(reservedTraceMetadata.labels)));
  }
  if (reservedTraceMetadata.sdk_version) {
    attrs.push(stringAttr("langwatch.sdk.version", reservedTraceMetadata.sdk_version));
  }
  if (reservedTraceMetadata.sdk_language) {
    attrs.push(stringAttr("langwatch.sdk.language", reservedTraceMetadata.sdk_language));
  }

  for (const [key, value] of Object.entries(customMetadata)) {
    if (value == null) continue;
    const attrKey = `langwatch.metadata.${key}`;
    if (typeof value === "string") {
      attrs.push(stringAttr(attrKey, value));
    } else if (typeof value === "number") {
      attrs.push(doubleAttr(attrKey, value));
    } else if (typeof value === "boolean") {
      attrs.push(boolAttr(attrKey, value));
    } else {
      attrs.push(stringAttr(attrKey, JSON.stringify(value)));
    }
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
  status: span.error
    ? { code: 2, message: span.error.message }
    : { code: 1 },
  droppedAttributesCount: 0,
  droppedEventsCount: 0,
  droppedLinksCount: 0,
});

export const CollectorSpanUtils = {
  convertSpanToOtlp,
  buildResource,
};
