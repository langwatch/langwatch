import { createTenantId } from "@langwatch/eventing";
import {
  SPAN_RECEIVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_VERSION_LATEST,
} from "@langwatch/trace-contract";
import type { OtlpSpan, SpanReceivedEvent } from "@langwatch/trace-contract";

/* Span-event builders for analytics' trace analytics folds, as trace's fold tests build them. */

/** Wall-clock milliseconds as the OTLP nanosecond string the wire carries. */
export function msToUnixNano(ms: number): string {
  return String(BigInt(Math.trunc(ms)) * 1_000_000n);
}

function otlpAttr(key: string, value: string | number | boolean) {
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { key, value: { intValue: String(value) } }
      : { key, value: { doubleValue: value } };
  }
  if (typeof value === "boolean") return { key, value: { boolValue: value } };
  return { key, value: { stringValue: value } };
}

export interface TestSpanReceivedEventOptions {
  eventId?: string;
  tenantId?: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string | null;
  name?: string;
  /** Business time of the event — what the fold checkpoints as its watermark. */
  occurredAt?: number;
  startTimeUnixNano?: string;
  endTimeUnixNano?: string;
  attributes?: Record<string, string | number | boolean>;
  resourceAttributes?: Record<string, string | number | boolean>;
  statusCode?: 0 | 1 | 2 | null;
}

/**
 * A real `span_received` event carrying a wire-shaped OTLP span, driving a
 * fold through its own dispatch instead of reaching past normalization.
 * Defaults: one two-second `llm-call` root span; every field is an option.
 */
export function createSpanReceivedEvent(
  options: TestSpanReceivedEventOptions = {},
): SpanReceivedEvent {
  const traceId = options.traceId ?? "aaaa0000000000000000000000000001";
  const spanId = options.spanId ?? "bbbb000000000001";
  const span: OtlpSpan = {
    traceId,
    spanId,
    parentSpanId: options.parentSpanId ?? null,
    name: options.name ?? "llm-call",
    kind: 1,
    // 1_700_000_000_500 ms — deliberately off a minute boundary so a rollup's
    // bucket flooring is observable.
    startTimeUnixNano: options.startTimeUnixNano ?? "1700000000500000000",
    endTimeUnixNano: options.endTimeUnixNano ?? "1700000002500000000",
    attributes: Object.entries(options.attributes ?? {}).map(([k, v]) => otlpAttr(k, v)),
    events: [],
    links: [],
    status: { code: options.statusCode ?? null, message: null },
    flags: null,
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };

  const resource = options.resourceAttributes
    ? {
        attributes: Object.entries(options.resourceAttributes).map(([k, v]) => otlpAttr(k, v)),
        droppedAttributesCount: 0,
      }
    : null;

  return {
    id: options.eventId ?? "evt-1",
    type: SPAN_RECEIVED_EVENT_TYPE,
    version: SPAN_RECEIVED_EVENT_VERSION_LATEST,
    tenantId: createTenantId(options.tenantId ?? "tenant-1"),
    aggregateId: traceId,
    aggregateType: "trace",
    createdAt: options.occurredAt ?? 0,
    occurredAt: options.occurredAt ?? 0,
    data: {
      span,
      resource,
      instrumentationScope: null,
      piiRedactionLevel: "DISABLED",
    },
    metadata: { spanId, traceId },
  };
}
