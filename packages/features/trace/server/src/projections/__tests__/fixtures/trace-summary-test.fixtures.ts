import { TraceCanonicalisationService } from "../../../services/trace-canonicalisation.service";
import { TraceIoExtractionAdapter } from "../../../adapters/trace-io-extraction.adapter";
import { TraceMediaReferenceAdapter } from "../../../adapters/trace-media-reference.adapter";
import { ModelCatalogTraceModelCostAdapter } from "../../../adapters/model-catalog.trace-model-cost.adapter";
import { TraceSpanNormalizationAdapter } from "../../../adapters/trace-span-normalization.adapter";
import { TraceProjectionRuntimeService } from "../../../services/trace-projection-runtime.service";
import { SPAN_RECEIVED_EVENT_TYPE } from "@langwatch/trace-contract";
import type { NormalizedSpan, OtlpSpan, SpanReceivedEvent } from "@langwatch/trace-contract";
import type { TraceSummaryData } from "@langwatch/trace-contract";

/**
 * The deterministic, no-I/O runtime the trace-summary fold projection folds
 * spans and log records through — every collaborator here is a pure adapter
 * over the canonicalisation pass, so a unit test never needs a database.
 */
export function createTestRuntime(): TraceProjectionRuntimeService {
  const canonicalisation = TraceCanonicalisationService.create();
  return TraceProjectionRuntimeService.create({
    canonicalisation,
    ioExtraction: TraceIoExtractionAdapter.create(canonicalisation),
    mediaReferences: TraceMediaReferenceAdapter.create(),
    modelCosts: ModelCatalogTraceModelCostAdapter.create(),
    spanNormalization: TraceSpanNormalizationAdapter.create(canonicalisation),
  });
}

/** The trace-summary fold's zeroed initial state, with timestamp fields. */
export function createInitState(): TraceSummaryData {
  return {
    traceId: "",
    spanCount: 0,
    totalDurationMs: 0,
    computedIOSchemaVersion: "2026-04-28",
    computedInput: null,
    computedOutput: null,
    timeToFirstTokenMs: null,
    timeToLastTokenMs: null,
    tokensPerSecond: null,
    containsErrorStatus: false,
    containsOKStatus: false,
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
    containsPrompt: false,
    selectedPromptId: null,
    selectedPromptSpanId: null,
    selectedPromptStartTimeMs: null,
    lastUsedPromptId: null,
    lastUsedPromptVersionNumber: null,
    lastUsedPromptVersionId: null,
    lastUsedPromptSpanId: null,
    lastUsedPromptStartTimeMs: null,
    topicId: null,
    subTopicId: null,
    annotationIds: [],
    traceName: "",
    rootSpanStartTimeMs: undefined,
    traceNameUserOverridden: false,
    traceNameFromFallback: false,
    rootMetadataFromFallback: false,
    attributes: {},
    storageAnchorMs: 0,
    occurredAt: 0,
    createdAt: 0,
    updatedAt: 0,
    LastEventOccurredAt: 0,
  } as unknown as TraceSummaryData;
}

/** A minimal normalized span, for span-fold tests that only care about a few fields. */
export function createTestSpan(overrides: {
  id?: string;
  spanId?: string;
  parentSpanId?: string | null;
  name?: string;
  startTimeUnixMs?: number;
  spanAttributes?: Record<string, unknown>;
}): NormalizedSpan {
  const spanId = overrides.spanId ?? overrides.id ?? "span-1";
  const startTimeUnixMs = overrides.startTimeUnixMs ?? 1000;
  return {
    traceId: "trace-1",
    spanId,
    parentSpanId: overrides.parentSpanId ?? null,
    name: overrides.name ?? "span",
    startTimeUnixMs,
    endTimeUnixMs: startTimeUnixMs + 100,
    spanAttributes: overrides.spanAttributes ?? {},
    resourceAttributes: {},
    events: [],
    status: {},
  } as unknown as NormalizedSpan;
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
 * reaching past the normalization pipeline into the fold's span handler.
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
  } as unknown as OtlpSpan;

  const resource = options.resourceAttributes
    ? {
        attributes: Object.entries(options.resourceAttributes).map(([k, v]) => otlpAttr(k, v)),
        droppedAttributesCount: 0,
      }
    : null;

  return {
    id: options.eventId ?? "evt-1",
    type: SPAN_RECEIVED_EVENT_TYPE,
    tenantId: options.tenantId ?? "tenant-1",
    aggregateId: traceId,
    ...(options.occurredAt === undefined ? {} : { occurredAt: options.occurredAt }),
    data: {
      span,
      resource,
      instrumentationScope: null,
      piiRedactionLevel: "DISABLED",
    },
    metadata: { spanId, traceId },
  } as unknown as SpanReceivedEvent;
}
