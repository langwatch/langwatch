import { ESpanKind } from "@opentelemetry/otlp-transformer-next/build/esm/trace/internal-types";
import type {
  OtlpKeyValue,
  OtlpSpan,
} from "~/server/event-sourcing/pipelines/trace-processing/schemas/otlp.js";
import type {
  ElasticSearchSpan,
  ElasticSearchEvent,
  SpanTypes,
} from "~/server/tracer/types.js";

// ----------- helpers -----------

function msToNano(ms: number): string {
  return String(BigInt(ms) * 1_000_000n);
}

function stringAttr(key: string, value: string | null | undefined): OtlpKeyValue | null {
  if (value == null || value === "") return null;
  return { key, value: { stringValue: value } };
}

function numberAttr(key: string, value: number | null | undefined): OtlpKeyValue | null {
  if (value == null) return null;
  return { key, value: { doubleValue: value } };
}

function boolAttr(key: string, value: boolean | null | undefined): OtlpKeyValue | null {
  if (value == null) return null;
  return { key, value: { boolValue: value } };
}

function compact(attrs: (OtlpKeyValue | null)[]): OtlpKeyValue[] {
  return attrs.filter((a): a is OtlpKeyValue => a !== null);
}

// ----------- kind mapping -----------

const SPAN_KIND_MAP: Record<string, ESpanKind> = {
  server: ESpanKind.SPAN_KIND_SERVER,
  client: ESpanKind.SPAN_KIND_CLIENT,
  producer: ESpanKind.SPAN_KIND_PRODUCER,
  consumer: ESpanKind.SPAN_KIND_CONSUMER,
};

function mapSpanKind(type: SpanTypes): ESpanKind {
  return SPAN_KIND_MAP[type] ?? ESpanKind.SPAN_KIND_INTERNAL;
}

// ----------- I/O value handling -----------

function ioValueToRaw(io: { type: string; value: string } | null | undefined): string | null {
  if (!io) return null;
  return JSON.stringify({ type: io.type, value: io.value });
}

// ----------- main converter -----------

export function esSpanToOtlp(
  esSpan: ElasticSearchSpan,
  traceId: string,
): OtlpSpan {
  const startMs = esSpan.timestamps.started_at;
  const endMs = Math.max(esSpan.timestamps.finished_at, startMs);
  const startNano = msToNano(startMs);
  const endNano = msToNano(endMs);

  // Build attributes
  const attrs = compact([
    stringAttr("langwatch.span.type", esSpan.type),
    stringAttr("langwatch.input", ioValueToRaw(esSpan.input)),
    stringAttr("langwatch.output", ioValueToRaw(esSpan.output)),
    stringAttr("gen_ai.request.model", esSpan.model ?? null),
    stringAttr("gen_ai.system", esSpan.vendor ?? null),
    numberAttr("gen_ai.usage.input_tokens", esSpan.metrics?.prompt_tokens),
    numberAttr("gen_ai.usage.output_tokens", esSpan.metrics?.completion_tokens),
    numberAttr("langwatch.span.cost", esSpan.metrics?.cost),
    boolAttr("langwatch.tokens_estimated", esSpan.metrics?.tokens_estimated),
  ]);

  // Params → gen_ai.request.* attributes
  if (esSpan.params) {
    for (const [key, value] of Object.entries(esSpan.params)) {
      if (value == null) continue;
      // Skip typed wrapper objects that have no actual value (e.g. { type: "json" })
      if (typeof value === "object" && !Array.isArray(value) && "type" in value && !("value" in value)) {
        continue;
      }
      const attrKey = `gen_ai.request.${key}`;
      if (typeof value === "string") {
        attrs.push({ key: attrKey, value: { stringValue: value } });
      } else if (typeof value === "number") {
        attrs.push({ key: attrKey, value: { doubleValue: value } });
      } else if (typeof value === "boolean") {
        attrs.push({ key: attrKey, value: { boolValue: value } });
      } else {
        attrs.push({ key: attrKey, value: { stringValue: JSON.stringify(value) } });
      }
    }
  }

  // RAG contexts
  if (esSpan.contexts && esSpan.contexts.length > 0) {
    attrs.push({
      key: "langwatch.rag.contexts",
      value: { stringValue: JSON.stringify(esSpan.contexts) },
    });
  }

  // Build events list
  const events: OtlpSpan["events"] = [];
  if (esSpan.timestamps.first_token_at) {
    events.push({
      timeUnixNano: msToNano(esSpan.timestamps.first_token_at),
      name: "first_token",
      attributes: [],
    });
  }

  // Error handling
  const hasError = !!esSpan.error?.has_error;
  const statusCode = hasError ? 2 : 0;
  const statusMessage = hasError ? (esSpan.error?.message ?? null) : null;

  return {
    traceId,
    spanId: esSpan.span_id,
    traceState: null,
    parentSpanId: esSpan.parent_id ?? null,
    name: esSpan.name ?? esSpan.type,
    kind: mapSpanKind(esSpan.type),
    startTimeUnixNano: startNano,
    endTimeUnixNano: endNano,
    attributes: attrs,
    events,
    links: [],
    status: {
      code: statusCode,
      message: statusMessage,
    },
    flags: null,
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };
}

// ----------- ES event → OTLP span -----------

export function esEventToOtlpSpan(
  event: ElasticSearchEvent,
  traceId: string,
): OtlpSpan {
  const startNano = msToNano(event.timestamps.started_at);

  // Build attributes from metrics and event_details
  const attrs: OtlpKeyValue[] = [];
  if (event.metrics) {
    for (const { key, value } of event.metrics) {
      attrs.push({ key: `langwatch.event.metric.${key}`, value: { doubleValue: value } });
    }
  }
  if (event.event_details) {
    for (const { key, value } of event.event_details) {
      attrs.push({ key: `langwatch.event.detail.${key}`, value: { stringValue: value } });
    }
  }

  // Mark this as an event span
  attrs.push({ key: "langwatch.span.type", value: { stringValue: "event" } });

  return {
    traceId,
    spanId: event.event_id,
    traceState: null,
    parentSpanId: null,
    name: event.event_type,
    kind: ESpanKind.SPAN_KIND_INTERNAL,
    startTimeUnixNano: startNano,
    endTimeUnixNano: startNano, // Instant span
    attributes: attrs,
    events: [],
    links: [],
    status: { code: 0, message: null },
    flags: null,
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };
}
