import type {
  Attributes,
  HrTime,
  SpanContext,
  SpanStatus,
} from "@opentelemetry/api";
import { SpanKind, SpanStatusCode, TraceFlags } from "@opentelemetry/api";
import { emptyResource } from "@opentelemetry/resources";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import type { Span, SpanTypes } from "./types";

function msToHrTime(ms: number): HrTime {
  const seconds = Math.trunc(ms / 1000);
  const nanoseconds = (ms % 1000) * 1_000_000;
  return [seconds, nanoseconds];
}

function hrTimeDuration(start: HrTime, end: HrTime): HrTime {
  let seconds = end[0]! - start[0]!;
  let nanoseconds = end[1]! - start[1]!;
  if (nanoseconds < 0) {
    seconds -= 1;
    nanoseconds += 1_000_000_000;
  }
  return [seconds, nanoseconds];
}

function spanTypeToKind(type: SpanTypes): SpanKind {
  switch (type) {
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
 * Recursively flattens a nested params object into dot-notation OTEL attributes.
 *
 * - Primitive values (string, number, boolean) are set directly
 * - Plain objects are recursed into
 * - Arrays are JSON.stringified
 * - null/undefined values are skipped
 * - The `_keys` field is skipped (indexing artifact)
 */
function assignFlattenedParam({
  key,
  value,
  prefix,
  attrs,
}: {
  key: string;
  value: unknown;
  prefix: string;
  attrs: Attributes;
}): void {
  const fullKey = prefix ? `${prefix}.${key}` : key;

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    attrs[fullKey] = value;
  } else if (Array.isArray(value)) {
    attrs[fullKey] = JSON.stringify(value);
  } else if (typeof value === "object") {
    flattenParams({
      params: value as Record<string, unknown>,
      prefix: fullKey,
      attrs,
    });
  }
}

function flattenParams({
  params,
  prefix,
  attrs,
}: {
  params: Record<string, unknown>;
  prefix: string;
  attrs: Attributes;
}): void {
  for (const [key, value] of Object.entries(params)) {
    if (key === "_keys") continue;
    if (value == null) continue;

    assignFlattenedParam({ key, value, prefix, attrs });
  }
}

function applyInputAttributes(span: Span, attrs: Attributes): void {
  if (!span.input) return;
  if (span.input.type === "chat_messages") {
    attrs["gen_ai.input.messages"] = JSON.stringify(span.input.value);
  } else if (span.input.type === "text") {
    attrs.input = span.input.value;
  } else if (span.input.type === "json") {
    attrs.input = JSON.stringify(span.input.value);
  } else if (span.input.type === "raw") {
    attrs.input = span.input.value;
  }
}

function applyOutputAttributes(span: Span, attrs: Attributes): void {
  if (!span.output) return;
  if (span.output.type === "chat_messages") {
    attrs["gen_ai.output.messages"] = JSON.stringify(span.output.value);
  } else if (span.output.type === "text") {
    attrs.output = span.output.value;
  } else if (span.output.type === "json") {
    attrs.output = JSON.stringify(span.output.value);
  } else if (span.output.type === "raw") {
    attrs.output = span.output.value;
  }
}

function applyLlmAttributes(span: Span, attrs: Attributes): void {
  if ("model" in span && span.model) {
    attrs["gen_ai.request.model"] = span.model;
  }
  if ("vendor" in span && span.vendor) {
    attrs["gen_ai.system"] = span.vendor;
  }
}

function applyParamsAttributes(span: Span, attrs: Attributes): void {
  if (!span.params) return;
  if (span.params.temperature != null)
    attrs["gen_ai.request.temperature"] = span.params.temperature;
  if (span.params.max_tokens != null)
    attrs["gen_ai.request.max_tokens"] = span.params.max_tokens;
  if (span.params.top_p != null)
    attrs["gen_ai.request.top_p"] = span.params.top_p;

  flattenParams({ params: span.params, prefix: "", attrs });
}

function applyMetricsAttributes(span: Span, attrs: Attributes): void {
  if (!span.metrics) return;
  if (span.metrics.prompt_tokens != null)
    attrs["gen_ai.usage.prompt_tokens"] = span.metrics.prompt_tokens;
  if (span.metrics.completion_tokens != null)
    attrs["gen_ai.usage.completion_tokens"] = span.metrics.completion_tokens;
  if (span.metrics.cost != null) attrs["gen_ai.usage.cost"] = span.metrics.cost;
}

function applyRagContextAttributes(span: Span, attrs: Attributes): void {
  if ("contexts" in span && span.contexts) {
    attrs["retrieval.documents"] = JSON.stringify(span.contexts);
  }
}

function buildAttributes(span: Span): Attributes {
  const attrs: Attributes = {};

  attrs["langwatch.span.type"] = span.type;

  applyInputAttributes(span, attrs);
  applyOutputAttributes(span, attrs);
  applyLlmAttributes(span, attrs);
  applyParamsAttributes(span, attrs);
  applyMetricsAttributes(span, attrs);
  applyRagContextAttributes(span, attrs);

  return attrs;
}

function buildStatus(span: Span): SpanStatus {
  if (span.error) {
    return { code: SpanStatusCode.ERROR, message: span.error.message };
  }
  return { code: SpanStatusCode.OK };
}

export async function formatSpansDigest(spans: Span[]): Promise<string> {
  const { judgeSpanDigestFormatter } = await import("@langwatch/scenario");
  const readableSpans = spans.map(langwatchSpanToReadableSpan);
  return judgeSpanDigestFormatter.format(readableSpans);
}

export function langwatchSpanToReadableSpan(span: Span): ReadableSpan {
  const startTime = msToHrTime(span.timestamps.started_at);
  const endTime = msToHrTime(span.timestamps.finished_at);
  const duration = hrTimeDuration(startTime, endTime);

  const spanCtx: SpanContext = {
    traceId: span.trace_id,
    spanId: span.span_id,
    traceFlags: TraceFlags.SAMPLED,
  };

  const parentSpanCtx: SpanContext | undefined = span.parent_id
    ? {
        traceId: span.trace_id,
        spanId: span.parent_id,
        traceFlags: TraceFlags.SAMPLED,
      }
    : undefined;

  const resource = emptyResource();

  return {
    name: span.name ?? "",
    kind: spanTypeToKind(span.type),
    spanContext: () => spanCtx,
    parentSpanContext: parentSpanCtx,
    startTime,
    endTime,
    status: buildStatus(span),
    attributes: buildAttributes(span),
    links: [],
    events: [],
    duration,
    ended: true,
    resource,
    instrumentationScope: { name: "langwatch" },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };
}
