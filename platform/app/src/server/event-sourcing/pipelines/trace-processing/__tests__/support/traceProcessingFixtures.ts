import { vi } from "vitest";
import type { TraceProcessingPipelineDeps } from "../../pipeline";
import type { RecordSpanCommandData } from "../../schemas/commands";

const reactorStub = (name: string) => ({ name, handle: async () => {} }) as any;

/**
 * Deps for building the REAL trace-processing pipeline in a wiring test.
 * `build()` only stores references, so no store or reactor is ever invoked.
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
    originGateReactor: reactorStub("originGate"),
    evaluationTriggerReactor: reactorStub("evaluationTrigger"),
    customEvaluationSyncReactor: reactorStub("customEvaluationSync"),
    traceUpdateBroadcastReactor: reactorStub("traceUpdateBroadcast"),
    projectMetadataReactor: reactorStub("projectMetadata"),
    simulationMetricsSyncReactor: reactorStub("simulationMetricsSync"),
    experimentMetricsSyncReactor: reactorStub("experimentMetricsSync"),
    automations: {
      triggerMatchHandler: vi.fn().mockResolvedValue(undefined),
      graphActivityHandler: vi.fn().mockResolvedValue(undefined),
    },
    spanStorageBroadcastReactor: reactorStub("spanStorageBroadcast"),
    ...overrides,
  };
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
