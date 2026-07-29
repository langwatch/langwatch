import { describe, expect, it, vi } from "vitest";
import { GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS } from "~/server/event-sourcing/pipelines/automations/subscribers/graphTriggerActivity.subscriber";
import type { EventSubscriberDefinition } from "../../../subscribers/eventSubscriber.types";
import {
  createTraceProcessingPipeline,
  type TraceProcessingPipelineDeps,
} from "../pipeline";
import { CUSTOM_EVALUATION_SYNC_PROCESS_NAME } from "../process-manager/customEvaluationSyncProcess.types";
import { EVALUATION_TRIGGER_PROCESS_NAME } from "../process-manager/evaluationTriggerProcess.types";
import { ORIGIN_GATE_PROCESS_NAME } from "../process-manager/originGateProcess.types";
import {
  ORIGIN_RESOLVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_TYPE,
} from "../schemas/constants";
import type { TraceProcessingEvent } from "../schemas/events";

/**
 * Wiring-level unit test: builds the REAL trace-processing pipeline and asserts
 * the composition root mounts what ADR-075/ADR-082 say it should — the three
 * process managers, the four at-most-once subscribers, the billing poke, the
 * coding-agent span-facts dispatch, and the automations mounts. `build()` only
 * stores references, so no store, process or subscriber is ever invoked.
 *
 * `triggerMatch` is asserted as a MOUNT, not as a shape: its delay, dedup key
 * and enqueue filter belong to the enterprise subscriber definition now, and
 * are tested where they are authored. What this file locks in is that the
 * pipeline registers exactly the definition it was handed and configures
 * nothing of its own on top.
 */

const triggerMatchSubscriber: EventSubscriberDefinition<TraceProcessingEvent> =
  {
    name: "triggerMatch",
    eventTypes: [SPAN_RECEIVED_EVENT_TYPE, ORIGIN_RESOLVED_EVENT_TYPE],
    options: { delay: 30_000 },
    handle: async () => {},
  };

function buildTraceDeps(
  overrides: Partial<TraceProcessingPipelineDeps> = {},
): TraceProcessingPipelineDeps {
  const store = {} as any;
  return {
    spanAppendStore: store,
    traceSummaryStore: store,
    traceAnalyticsStore: store,
    traceAnalyticsRollupAppendStore: store,
    commands: { port: vi.fn(() => async () => {}) } as any,
    broadcast: {} as any,
    hasRedis: true,
    projects: {} as any,
    bootstrapTopicClustering: async () => {},
    getNormalizedSpanById: async () => null,
    evaluationTriggerDispatch: {
      monitors: {} as any,
      readTraceSummary: async () => null,
      evaluation: async () => {},
    },
    customEvaluationSyncDispatch: {
      getSpanEvents: async () => [],
      reportEvaluation: async () => {},
    },
    isSaas: true,
    automations: {
      triggerMatchSubscriber,
      graphActivityHandler: vi.fn().mockResolvedValue(undefined),
    },
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

describe("trace-processing pipeline wiring", () => {
  describe("given the deferred work the pipeline owns", () => {
    const definition = createTraceProcessingPipeline(buildTraceDeps());

    it("mounts the origin gate, the evaluation trigger and the custom-evaluation sync as process managers", () => {
      expect([...definition.processManagers.keys()].sort()).toEqual(
        [
          CUSTOM_EVALUATION_SYNC_PROCESS_NAME,
          EVALUATION_TRIGGER_PROCESS_NAME,
          ORIGIN_GATE_PROCESS_NAME,
        ].sort(),
      );
    });

    it("gives every one of them a gate before a job is staged", () => {
      // All three are mounted on `span_received`, the busiest stream in the
      // product. A process mounted there with no enqueue declaration costs a
      // job, an inbox row and a durable transition per span (ADR-069). What
      // each declares is tested where it is authored; what this pins is that
      // the mount declares anything at all.
      for (const name of [
        CUSTOM_EVALUATION_SYNC_PROCESS_NAME,
        EVALUATION_TRIGGER_PROCESS_NAME,
        ORIGIN_GATE_PROCESS_NAME,
      ]) {
        const enqueue = definition.processManagers.get(name)?.config.enqueue;
        expect(enqueue?.filter ?? enqueue?.deduplication).toBeDefined();
      }
    });
  });

  describe("given the at-most-once side effects", () => {
    const definition = createTraceProcessingPipeline(buildTraceDeps());

    it("mounts the broadcast, project-metadata and clustering-bootstrap subscribers", () => {
      for (const name of [
        "traceUpdateBroadcast",
        "spanStorageBroadcast",
        "projectMetadata",
        "topicClusteringBootstrap",
      ]) {
        expect(definition.eventSubscribers.get(name)).toBeDefined();
      }
    });
  });

  describe("given the billing poke", () => {
    it("meters span_received, the only billable event this pipeline emits", () => {
      const definition = createTraceProcessingPipeline(buildTraceDeps());
      const poke = definition.eventSubscribers.get("billingMeterPoke");

      expect(poke).toBeDefined();
      expect(poke!.eventTypes).toEqual([SPAN_RECEIVED_EVENT_TYPE]);
      expect(poke!.options?.disabled).toBe(false);
    });

    it("is off outside the SaaS build, where nothing could report the usage", () => {
      const definition = createTraceProcessingPipeline(
        buildTraceDeps({ isSaas: false }),
      );

      expect(
        definition.eventSubscribers.get("billingMeterPoke")!.options?.disabled,
      ).toBe(true);
    });
  });

  describe("given the coding-agent span-facts dispatch", () => {
    it("mounts it from this pipeline, bound through the command bus", () => {
      const deps = buildTraceDeps();
      const definition = createTraceProcessingPipeline(deps);
      const dispatch = definition.eventSubscribers.get(
        "codingAgentSpanFactsDispatch",
      );

      expect(dispatch).toBeDefined();
      expect(dispatch!.eventTypes).toEqual([SPAN_RECEIVED_EVENT_TYPE]);
      // ADR-082 §5: the port is bound while this pipeline is being built, so
      // coding-agent registration order relative to it carries no meaning.
      expect(deps.commands.port).toHaveBeenCalled();
    });
  });

  describe("given the triggerMatch subscriber", () => {
    it("registers the injected definition verbatim, adding no delay or dedup of its own", () => {
      const definition = createTraceProcessingPipeline(buildTraceDeps());

      expect(definition.eventSubscribers.get("triggerMatch")).toBe(
        triggerMatchSubscriber,
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
      const subscriber = pipeline.eventSubscribers.get("graphTriggerActivity")!;
      const event = fakeEvent({ tenantId: "project-3", aggregateId: "t-3" });
      await subscriber.handle(event, {
        tenantId: "project-3",
        aggregateId: "t-3",
      });
      expect(deps.automations.graphActivityHandler).toHaveBeenCalledWith(
        event,
        {
          tenantId: "project-3",
          aggregateId: "t-3",
        },
      );
    });
  });
});
