import { vi } from "vitest";
import type { JobRegistryEntry } from "../../../../services/queues/queueManager";
import { QueueManager } from "../../../../services/queues/queueManager";
import type { TraceProcessingPipelineDeps } from "../../pipeline";
import { createTraceProcessingPipeline } from "../../pipeline";
import type {
  RecordLogContributionCommandData,
  RecordMetricCorrelationCommandData,
  RecordSpanCommandData,
} from "../../schemas/commands";

const handlerStub = () => async () => {};

/**
 * Deps for building the REAL trace-processing pipeline in a wiring test.
 * `build()` only stores references, so no store or subscriber is ever invoked.
 */
export function buildTraceDeps(
  overrides: Partial<TraceProcessingPipelineDeps> = {},
): TraceProcessingPipelineDeps {
  const store = {} as any;
  return {
    spanAppendStore: store,
    traceSummaryStore: store,
    traceAnalyticsStore: store,
    traceAnalyticsRollupAppendStore: store,
    originGateHandler: handlerStub(),
    evaluationTrigger: {
      name: "evaluationTrigger",
      spec: { fold: "traceSummary", handler: handlerStub() },
    },
    customEvaluationSyncHandler: handlerStub(),
    trackedEventSyncHandler: handlerStub(),
    traceUpdateBroadcastHandler: handlerStub(),
    projectMetadataHandler: handlerStub(),
    simulationMetricsSyncHandler: handlerStub(),
    experimentMetricsSyncHandler: handlerStub(),
    automations: {
      triggerMatchHandler: vi.fn().mockResolvedValue(undefined),
      graphActivityHandler: vi.fn().mockResolvedValue(undefined),
    },
    spanStorageBroadcastHandler: handlerStub(),
    ...overrides,
  };
}

/**
 * The real pipeline's registration for one command. Throws rather than
 * returning undefined: `?.options` on a missing command reads as an absent
 * option, so a renamed command would otherwise pass every assertion.
 */
export function traceCommandRegistration(name: string) {
  const entry = createTraceProcessingPipeline(buildTraceDeps()).commands.find(
    (candidate) => candidate.name === name,
  );
  if (!entry) throw new Error(`no command registered as "${name}"`);
  return entry;
}

/**
 * Wires the named commands' real registrations through the real QueueManager
 * over a stub queue and returns the job registry it populated. Narrowed to the
 * named commands because initializeCommandQueues constructs every handler it
 * is given, and RecordSpanCommand's zero-arg constructor reaches for prisma.
 */
export function wireTraceCommands(
  names: readonly string[],
): Map<string, JobRegistryEntry> {
  const globalJobRegistry = new Map<string, JobRegistryEntry>();
  const manager = new QueueManager({
    aggregateType: "trace",
    pipelineName: "trace_processing",
    globalQueue: {
      send: vi.fn().mockResolvedValue(void 0),
      sendBatch: vi.fn().mockResolvedValue(void 0),
      close: vi.fn().mockResolvedValue(void 0),
      waitUntilReady: vi.fn().mockResolvedValue(void 0),
    } as never,
    globalJobRegistry,
  });
  manager.initializeCommandQueues(
    names.map(traceCommandRegistration) as never,
    vi.fn(),
    "trace_processing",
  );
  return globalJobRegistry;
}

export const FIXTURE_TENANT_ID = "tenant-span-coalescing";
export const FIXTURE_TRACE_ID = "534bd8a1bf83e7c58e8aaacefb047cc2";

export function spanId(index: number): string {
  return (index + 1).toString(16).padStart(16, "0");
}

/** A schema-valid recordSpan payload; `spoolRef` makes it the oversized shape. */
export function spanPayload({
  spanId: id,
  spoolRef,
}: {
  spanId: string;
  spoolRef?: string;
}): RecordSpanCommandData {
  return {
    tenantId: FIXTURE_TENANT_ID,
    occurredAt: 1_700_000_000_000,
    ...(spoolRef ? { spoolRef } : {}),
    span: {
      traceId: FIXTURE_TRACE_ID,
      spanId: id,
      name: "test-span",
      kind: 1,
      startTimeUnixNano: { low: 0, high: 0 },
      endTimeUnixNano: { low: 1_000_000, high: 0 },
      attributes: [],
      events: [],
      links: [],
      status: {},
      droppedAttributesCount: 0,
      droppedEventsCount: 0,
      droppedLinksCount: 0,
    },
    resource: null,
    instrumentationScope: null,
  } as unknown as RecordSpanCommandData;
}

/** A 64-hex content-hash id, as recordId and pointId/seriesId both are. */
function hashId(index: number): string {
  return (index + 1).toString(16).padStart(64, "0");
}

/** `index` varies recordId, spanId and time; the trace is fixed, as the group is. */
export function logContributionPayload({
  index,
}: {
  index: number;
}): RecordLogContributionCommandData {
  return {
    tenantId: FIXTURE_TENANT_ID,
    recordId: hashId(index),
    traceId: FIXTURE_TRACE_ID,
    spanId: spanId(index),
    timeUnixMs: 1_700_000_000_000 + index,
    severityNumber: 9,
    severityText: "INFO",
    providerKind: "generic",
    scopeName: "test-scope",
    correlationSource: "wire",
    input: null,
    output: `output-${index}`,
    liftedAttributes: {},
    nonBillable: false,
    piiRedactionLevel: "ESSENTIAL",
    occurredAt: 1_700_000_000_000 + index,
  };
}

/** seriesId is offset off pointId so the two 64-hex ids can never collide. */
export function metricCorrelationPayload({
  index,
}: {
  index: number;
}): RecordMetricCorrelationCommandData {
  return {
    tenantId: FIXTURE_TENANT_ID,
    traceId: FIXTURE_TRACE_ID,
    spanId: spanId(index),
    pointId: hashId(index),
    seriesId: hashId(1000 + index),
    metricName: "test.metric",
    metricUnit: "ms",
    metricKind: "gauge",
    exemplarValue: index,
    exemplarTimeUnixMs: 1_700_000_000_000 + index,
    occurredAt: 1_700_000_000_000 + index,
  };
}
