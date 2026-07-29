import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import { SPAN_RECEIVED_EVENT_TYPE } from "../../../schemas/constants";
import type { SpanReceivedEvent } from "../../../schemas/events";
import type { OtlpSpan } from "../../../schemas/otlp";
import type { NormalizedSpan } from "../../../schemas/spans";
import {
  NormalizedSpanKind,
  NormalizedStatusCode,
} from "../../../schemas/spans";
import { TraceSummaryFoldProjection } from "../../traceSummary.foldProjection";

const traceSummaryProjection = new TraceSummaryFoldProjection({
  store: { store: async () => {}, get: async () => null },
});

export function createInitState(): TraceSummaryData {
  return traceSummaryProjection.init();
}

export function createTestSpan(
  overrides: Partial<NormalizedSpan> = {},
): NormalizedSpan {
  return {
    id: "span-1",
    traceId: "trace-1",
    spanId: "span-1",
    tenantId: "tenant-1",
    parentSpanId: "parent-1",
    parentTraceId: null,
    parentIsRemote: null,
    sampled: true,
    startTimeUnixMs: 1000,
    endTimeUnixMs: 2000,
    durationMs: 1000,
    name: "test-span",
    kind: NormalizedSpanKind.INTERNAL,
    resourceAttributes: {},
    spanAttributes: {},
    events: [],
    links: [],
    statusMessage: null,
    statusCode: NormalizedStatusCode.UNSET,
    instrumentationScope: { name: "test", version: null },
    droppedAttributesCount: 0 as const,
    droppedEventsCount: 0 as const,
    droppedLinksCount: 0 as const,
    cost: null,
    nonBilledCost: null,
    ...overrides,
  };
}

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
  statusCode?: number | null;
}

/**
 * A real `span_received` event carrying a wire-shaped OTLP span, so a test can
 * drive a trace fold through its own dispatch (`projection.apply`) instead of
 * reaching past the normalization pipeline into `applySpanToAnalytics`.
 *
 * Defaults describe one two-second `llm-call` root span on a single trace; every
 * field a test needs to vary is an option.
 */
export function createSpanReceivedEvent(
  options: TestSpanReceivedEventOptions = {},
): SpanReceivedEvent {
  const traceId = options.traceId ?? "aaaa0000000000000000000000000001";
  const spanId = options.spanId ?? "bbbb000000000001";
  const span = {
    traceId,
    spanId,
    parentSpanId: options.parentSpanId ?? null,
    name: options.name ?? "llm-call",
    kind: 1,
    // 1_700_000_000_500 ms — deliberately off a minute boundary so the rollup's
    // bucket flooring is observable.
    startTimeUnixNano: options.startTimeUnixNano ?? "1700000000500000000",
    endTimeUnixNano: options.endTimeUnixNano ?? "1700000002500000000",
    attributes: Object.entries(options.attributes ?? {}).map(([k, v]) =>
      otlpAttr(k, v),
    ),
    events: [],
    links: [],
    status: { code: options.statusCode ?? null, message: null },
    flags: null,
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  } as unknown as OtlpSpan;

  const resource = options.resourceAttributes
    ? {
        attributes: Object.entries(options.resourceAttributes).map(([k, v]) =>
          otlpAttr(k, v),
        ),
        droppedAttributesCount: 0,
      }
    : null;

  return {
    id: options.eventId ?? "evt-1",
    type: SPAN_RECEIVED_EVENT_TYPE,
    tenantId: options.tenantId ?? "tenant-1",
    aggregateId: traceId,
    ...(options.occurredAt === undefined
      ? {}
      : { occurredAt: options.occurredAt }),
    data: {
      span,
      resource,
      instrumentationScope: null,
      piiRedactionLevel: "DISABLED",
    },
    metadata: { spanId, traceId },
  } as unknown as SpanReceivedEvent;
}
