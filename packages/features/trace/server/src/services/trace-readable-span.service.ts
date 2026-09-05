import type { Attributes, HrTime, SpanContext, SpanStatus } from "@opentelemetry/api";
import { SpanKind, SpanStatusCode, TraceFlags } from "@opentelemetry/api";
import { emptyResource } from "@opentelemetry/resources";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { judgeSpanDigestFormatter } from "@langwatch/scenario";
import type { Span, SpanTypes } from "@langwatch/trace-contract";

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
 * Recursively flattens a nested params object into dot-notation OTEL attributes: primitives set
 * directly, plain objects recursed, arrays JSON-stringified, null and undefined skipped, and the
 * `_keys` field skipped as an indexing artifact.
 */
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
    if (key === "_keys") {
      continue;
    }

    if (value == null) {
      continue;
    }

    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
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
}

function buildAttributes(span: Span): Attributes {
  const attrs: Attributes = {};

  attrs["langwatch.span.type"] = span.type;
  assignIo({ attrs, value: span.input, messagesKey: "gen_ai.input.messages", plainKey: "input" });
  assignIo({
    attrs,
    value: span.output,
    messagesKey: "gen_ai.output.messages",
    plainKey: "output",
  });

  if ("model" in span && span.model) {
    attrs["gen_ai.request.model"] = span.model;
  }

  if ("vendor" in span && span.vendor) {
    attrs["gen_ai.system"] = span.vendor;
  }

  assignParams({ attrs, params: span.params });
  assignMetrics({ attrs, metrics: span.metrics });
  if ("contexts" in span && span.contexts) {
    attrs["retrieval.documents"] = JSON.stringify(span.contexts);
  }

  return attrs;
}

/** One side of the conversation, under the messages key when it is a chat and `input`/`output` otherwise. */
function assignIo({
  attrs,
  value,
  messagesKey,
  plainKey,
}: {
  attrs: Attributes;
  value: Span["input"] | Span["output"];
  messagesKey: string;
  plainKey: string;
}): void {
  if (!value) {
    return;
  }

  if (value.type === "chat_messages") {
    attrs[messagesKey] = JSON.stringify(value.value);

    return;
  }

  if (value.type === "json") {
    attrs[plainKey] = JSON.stringify(value.value);

    return;
  }

  if (value.type === "text" || value.type === "raw") {
    attrs[plainKey] = value.value;
  }
}

/** The named request parameters, plus everything else the span carried, flattened. */
function assignParams({ attrs, params }: { attrs: Attributes; params: Span["params"] }): void {
  if (!params) {
    return;
  }

  if (params.temperature != null) {
    attrs["gen_ai.request.temperature"] = params.temperature;
  }

  if (params.max_tokens != null) {
    attrs["gen_ai.request.max_tokens"] = params.max_tokens;
  }

  if (params.top_p != null) {
    attrs["gen_ai.request.top_p"] = params.top_p;
  }

  flattenParams({ params, prefix: "", attrs });
}

/** The token counts and cost, each only when the span reported it. */
function assignMetrics({ attrs, metrics }: { attrs: Attributes; metrics: Span["metrics"] }): void {
  if (!metrics) {
    return;
  }

  if (metrics.prompt_tokens != null) {
    attrs["gen_ai.usage.prompt_tokens"] = metrics.prompt_tokens;
  }

  if (metrics.completion_tokens != null) {
    attrs["gen_ai.usage.completion_tokens"] = metrics.completion_tokens;
  }

  if (metrics.cost != null) {
    attrs["gen_ai.usage.cost"] = metrics.cost;
  }
}

function buildStatus(span: Span): SpanStatus {
  if (span.error) {
    return { code: SpanStatusCode.ERROR, message: span.error.message };
  }

  return { code: SpanStatusCode.OK };
}

export class TraceReadableSpanService {
  static create(): TraceReadableSpanService {
    return new TraceReadableSpanService();
  }

  /**
   * A whole trace's spans rendered as the one readable digest a judge reads. The formatter is the
   * scenario judge's, because the digest a judge is shown and the digest an evaluator is shown
   * have to be the same text — a second renderer would grade one thing and display another.
   */
  static formatSpansDigest(spans: Span[]): Promise<string> {
    const readableSpans = spans.map(TraceReadableSpanService.langwatchSpanToReadableSpan);

    return Promise.resolve(judgeSpanDigestFormatter.format(readableSpans));
  }

  static langwatchSpanToReadableSpan(span: Span): ReadableSpan {
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
}
