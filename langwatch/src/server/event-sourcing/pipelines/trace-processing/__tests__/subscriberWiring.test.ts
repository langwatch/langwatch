import { describe, expect, it, vi } from "vitest";
import { GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS } from "~/server/event-sourcing/pipelines/automations/subscribers/graphTriggerActivity.subscriber";
import {
  createTraceProcessingPipeline,
  type TraceProcessingPipelineDeps,
} from "../pipeline";
import {
  ORIGIN_RESOLVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_TYPE,
} from "../schemas/constants";
import type { TraceProcessingEvent } from "../schemas/events";

/**
 * Wiring-level unit test: builds the REAL trace-processing pipeline and
 * asserts the `.withSubscriber("triggerMatch", ...)` /
 * `.withSubscriber("graphTriggerActivity", ...)` registrations at
 * pipeline.ts:224-241 carry the intended events/delay/ttl/dedup. These
 * debounce/dedup values previously lived on deleted reactors' options and
 * were tested there (ADR-052) — this locks the replacement wiring in.
 * `build()` only stores references, so no store / reactor is ever invoked.
 */

const reactorStub = (name: string) => ({ name, handle: async () => {} }) as any;

function buildTraceDeps(
  overrides: Partial<TraceProcessingPipelineDeps> = {},
): TraceProcessingPipelineDeps {
  const store = {} as any;
  return {
    spanAppendStore: store,
    traceSummaryStore: store,
    traceAnalyticsStore: store,
    traceAnalyticsRollupAppendStore: store,
    logRecordAppendStore: store,
    originGateReactor: reactorStub("originGate"),
    evaluationTriggerReactor: reactorStub("evaluationTrigger"),
    customEvaluationSyncReactor: reactorStub("customEvaluationSync"),
    traceUpdateBroadcastReactor: reactorStub("traceUpdateBroadcast"),
    projectMetadataReactor: reactorStub("projectMetadata"),
    simulationMetricsSyncReactor: reactorStub("simulationMetricsSync"),
    automations: {
      triggerMatchHandler: vi.fn().mockResolvedValue(undefined),
      graphActivityHandler: vi.fn().mockResolvedValue(undefined),
    },
    spanStorageBroadcastReactor: reactorStub("spanStorageBroadcast"),
    claudeCodeSpanSyncReactor: reactorStub("claudeCodeSpanSync"),
    ...overrides,
  };
}

function fakeEvent(
  overrides: Partial<
    Omit<TraceProcessingEvent, "type" | "tenantId"> & {
      type: string;
      tenantId: string;
    }
  > = {},
): TraceProcessingEvent {
  return {
    id: "ev-1",
    aggregateId: "trace-1",
    aggregateType: "trace",
    tenantId: "project-1",
    createdAt: 0,
    occurredAt: 0,
    type: SPAN_RECEIVED_EVENT_TYPE,
    version: "2024-01-01",
    data: {},
    ...overrides,
  } as unknown as TraceProcessingEvent;
}

describe("trace-processing pipeline subscriber wiring", () => {
  describe("given the triggerMatch subscriber", () => {
    const definition = createTraceProcessingPipeline(buildTraceDeps());
    const triggerMatch = definition.foldReactors.get("triggerMatch");

    it("attaches to the traceSummary fold with a 30s delay and matching dedup ttl", () => {
      expect(triggerMatch).toBeDefined();
      expect(triggerMatch!.projectionName).toBe("traceSummary");
      expect(triggerMatch!.definition.options?.delay).toBe(30_000);
      expect(triggerMatch!.definition.options?.deduplication?.ttlMs).toBe(
        30_000,
      );
    });

    it("reacts only to span_received and origin_resolved events", () => {
      const shouldReact = triggerMatch!.definition.shouldReact!;
      const context = {} as never;
      expect(
        shouldReact(fakeEvent({ type: SPAN_RECEIVED_EVENT_TYPE }), context),
      ).toBe(true);
      expect(
        shouldReact(fakeEvent({ type: ORIGIN_RESOLVED_EVENT_TYPE }), context),
      ).toBe(true);
      expect(
        shouldReact(
          fakeEvent({ type: "lw.obs.trace.something_else" }),
          context,
        ),
      ).toBe(false);
    });

    it("derives the dedup id from tenant + aggregate, scoped to this subscriber", () => {
      const makeId = triggerMatch!.definition.options?.deduplication?.makeId;
      expect(makeId).toBeDefined();
      const event = fakeEvent({ tenantId: "project-9", aggregateId: "t-9" });
      expect(makeId!({ event, foldState: undefined })).toBe(
        "subscriber:triggerMatch:project-9:t-9",
      );
    });

    it("delegates to automations.triggerMatchHandler with tenant/aggregate/fold state", async () => {
      const deps = buildTraceDeps();
      const pipeline = createTraceProcessingPipeline(deps);
      const reactor = pipeline.foldReactors.get("triggerMatch")!.definition;
      const event = fakeEvent({ tenantId: "project-2", aggregateId: "t-2" });
      const foldState = { traceId: "t-2" } as any;
      await reactor.handle(event, {
        tenantId: "project-2",
        aggregateId: "t-2",
        foldState,
      });
      expect(deps.automations.triggerMatchHandler).toHaveBeenCalledWith(
        event,
        { tenantId: "project-2", aggregateId: "t-2", state: foldState },
      );
    });
  });

  describe("given the graphTriggerActivity subscriber", () => {
    const definition = createTraceProcessingPipeline(buildTraceDeps());
    const graphTriggerActivity = definition.eventSubscribers.get(
      "graphTriggerActivity",
    );

    it("registers for span_received and origin_resolved with the real-time debounce delay", () => {
      expect(graphTriggerActivity).toBeDefined();
      expect(graphTriggerActivity!.eventTypes).toEqual([
        SPAN_RECEIVED_EVENT_TYPE,
        ORIGIN_RESOLVED_EVENT_TYPE,
      ]);
      expect(graphTriggerActivity!.options?.delay).toBe(
        GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS,
      );
    });

    it("dedups per tenant for the debounce window without extending or replacing", () => {
      const dedup = graphTriggerActivity!.options?.deduplication as
        | {
            ttlMs?: number;
            extend?: boolean;
            replace?: boolean;
            makeId?: (event: TraceProcessingEvent) => string;
          }
        | undefined;
      expect(dedup?.ttlMs).toBe(GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS);
      expect(dedup?.extend).toBe(false);
      expect(dedup?.replace).toBe(false);
      expect(dedup!.makeId!(fakeEvent({ tenantId: "project-7" }))).toBe(
        "graph-trigger-activity:project-7",
      );
    });

    it("delegates to automations.graphActivityHandler with tenant/aggregate", async () => {
      const deps = buildTraceDeps();
      const pipeline = createTraceProcessingPipeline(deps);
      const subscriber = pipeline.eventSubscribers.get(
        "graphTriggerActivity",
      )!;
      const event = fakeEvent({ tenantId: "project-3", aggregateId: "t-3" });
      await subscriber.handle(event, {
        tenantId: "project-3",
        aggregateId: "t-3",
      });
      expect(deps.automations.graphActivityHandler).toHaveBeenCalledWith(
        event,
        { tenantId: "project-3", aggregateId: "t-3" },
      );
    });
  });
});
