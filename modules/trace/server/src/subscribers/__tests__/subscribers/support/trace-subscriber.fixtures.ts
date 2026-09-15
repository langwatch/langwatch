import type { TriggerContext } from "@langwatch/eventing";
import type {
  OtlpSpan,
  SpanReceivedEvent,
  TraceProcessingEvent,
  TraceSummaryData,
} from "@langwatch/trace-contract";

export const TENANT_ID = "tenant-1";
export const TRACE_ID = "trace-1";

/**
 * A fixed occurrence time. Redelivery contracts turn on whether a second
 * delivery of ONE event produces the same downstream identity, so nothing in
 * these fixtures may read the wall clock.
 */
export const OCCURRED_AT = 1_700_000_000_000;

export function createFoldState(overrides: Partial<TraceSummaryData> = {}): TraceSummaryData {
  return {
    traceId: TRACE_ID,
    traceName: "",
    spanCount: 1,
    totalDurationMs: 100,
    computedIOSchemaVersion: "2025-12-18",
    computedInput: "hello",
    computedOutput: "world",
    timeToFirstTokenMs: null,
    timeToLastTokenMs: null,
    tokensPerSecond: null,
    containsErrorStatus: false,
    containsOKStatus: true,
    errorMessage: null,
    models: [],
    totalCost: null,
    nonBilledCost: null,
    tokensEstimated: false,
    totalPromptTokenCount: null,
    totalCompletionTokenCount: null,
    outputFromRootSpan: false,
    outputSpanEndTimeMs: 0,
    blockedByGuardrail: false,
    rootSpanType: null,
    containsAi: false,
    topicId: null,
    subTopicId: null,
    annotationIds: [],
    containsPrompt: false,
    selectedPromptId: null,
    selectedPromptSpanId: null,
    selectedPromptStartTimeMs: null,
    lastUsedPromptId: null,
    lastUsedPromptVersionNumber: null,
    lastUsedPromptVersionId: null,
    lastUsedPromptSpanId: null,
    lastUsedPromptStartTimeMs: null,
    LastEventOccurredAt: 0,
    occurredAt: OCCURRED_AT,
    createdAt: OCCURRED_AT,
    updatedAt: OCCURRED_AT,
    attributes: { "langwatch.origin": "application" },
    ...overrides,
  };
}

export function createOtlpSpan(
  events: { name: string; payload: Record<string, unknown> }[] = [],
): OtlpSpan {
  return {
    traceId: "aaaa0000000000000000000000000001",
    spanId: "bbbb000000000001",
    parentSpanId: null,
    name: "main",
    kind: 1,
    startTimeUnixNano: "1700000000000000000",
    endTimeUnixNano: "1700000001000000000",
    attributes: [],
    events: events.map((event) => ({
      timeUnixNano: "1700000000500000000",
      name: event.name,
      attributes: [
        { key: "json_encoded_event", value: { stringValue: JSON.stringify(event.payload) } },
      ],
    })),
    links: [],
    status: { code: null, message: null },
    flags: null,
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  } as unknown as OtlpSpan;
}

export function createSpanReceivedEvent(
  span: OtlpSpan,
  overrides: Partial<SpanReceivedEvent> = {},
): SpanReceivedEvent {
  return {
    id: "event-1",
    aggregateId: TRACE_ID,
    aggregateType: "trace",
    tenantId: TENANT_ID,
    createdAt: OCCURRED_AT,
    occurredAt: OCCURRED_AT,
    type: "lw.obs.trace.span_received",
    version: 1,
    data: {
      span,
      resource: null,
      instrumentationScope: null,
      piiRedactionLevel: "STRICT",
    },
    metadata: { spanId: "span-1", traceId: TRACE_ID },
    ...overrides,
  } as unknown as SpanReceivedEvent;
}

export function createTraceEvent(
  type: string,
  overrides: Partial<TraceProcessingEvent> = {},
): TraceProcessingEvent {
  return {
    id: "event-1",
    aggregateId: TRACE_ID,
    aggregateType: "trace",
    tenantId: TENANT_ID,
    createdAt: OCCURRED_AT,
    occurredAt: OCCURRED_AT,
    type,
    version: 1,
    data: {},
    metadata: {},
    ...overrides,
  } as unknown as TraceProcessingEvent;
}

export function createContext<TState>(state: TState): TriggerContext<TState> {
  return {
    tenantId: TENANT_ID,
    aggregateId: TRACE_ID,
    state,
  } as TriggerContext<TState>;
}
