import { createTenantId } from "@langwatch/eventing";
import {
  NormalizedSpanKind,
  SPAN_RECEIVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_VERSION_LATEST,
} from "@langwatch/trace-contract";
import type {
  NormalizedSpan,
  OtlpSpan,
  SpanReceivedEvent,
  TraceSummaryData,
} from "@langwatch/trace-contract";

import { ModelCatalogTraceModelCostAdapter } from "../../services/model-catalog.trace-model-cost.service.ts";
import { TraceProjectionRuntimeService } from "../../services/projection/trace-projection-runtime.service.ts";
import { TraceCanonicalisationService } from "../../services/trace-canonicalisation.service.ts";
import { TraceIoExtractionAdapter } from "../../services/trace-io-extraction-adapter.service.ts";
import { TraceMediaReferenceAdapter } from "../../services/trace-media-reference.service.ts";
import { TraceSpanNormalizationAdapter } from "../../services/trace-span-normalization-adapter.service.ts";

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
  };
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
    id: spanId,
    traceId: "trace-1",
    spanId,
    tenantId: "tenant-1",
    parentSpanId: overrides.parentSpanId ?? null,
    parentTraceId: null,
    parentIsRemote: null,
    sampled: true,
    name: overrides.name ?? "span",
    kind: NormalizedSpanKind.UNSPECIFIED,
    startTimeUnixMs,
    endTimeUnixMs: startTimeUnixMs + 100,
    durationMs: 100,
    spanAttributes: overrides.spanAttributes ?? {},
    resourceAttributes: {},
    events: [],
    links: [],
    statusMessage: null,
    statusCode: null,
    instrumentationScope: { name: "", version: null },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
    cost: null,
    nonBilledCost: null,
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
