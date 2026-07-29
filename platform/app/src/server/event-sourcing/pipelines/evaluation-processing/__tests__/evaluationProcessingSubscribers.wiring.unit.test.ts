import { describe, expect, it, vi } from "vitest";

import type { EvaluationRunData } from "~/server/app-layer/evaluations/types";
import { GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS } from "~/server/event-sourcing/pipelines/automations/subscribers/graphTriggerActivity.subscriber";
import { createTenantId } from "../../../domain/tenantId";
import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import type { EventSubscriberDefinition } from "../../../subscribers/eventSubscriber.types";
import { createEvaluationProcessingPipeline } from "../pipeline";
import type { EvaluationAnalyticsData } from "../projections/evaluationAnalytics.foldProjection";
import {
  EVALUATION_COMPLETED_EVENT_TYPE,
  EVALUATION_REPORTED_EVENT_TYPE,
} from "../schemas/constants";
import type {
  EvaluationCompletedEvent,
  EvaluationProcessingEvent,
} from "../schemas/events";

const tenantId = createTenantId("project-wiring");

function foldStore<State>(): FoldProjectionStore<State> {
  return {
    get: vi.fn().mockResolvedValue(null),
    store: vi.fn().mockResolvedValue(undefined),
  };
}

function completedEvent(): EvaluationCompletedEvent {
  return {
    id: "evt-completed",
    aggregateId: "eval-1",
    aggregateType: "evaluation",
    tenantId,
    createdAt: 1_000,
    occurredAt: 1_000,
    type: EVALUATION_COMPLETED_EVENT_TYPE,
    version: "2025-01-14",
    data: {
      evaluationId: "eval-1",
      status: "processed",
    },
  };
}

function buildPipeline({ isSaas = true }: { isSaas?: boolean } = {}) {
  const triggerMatchSubscriber: EventSubscriberDefinition<EvaluationProcessingEvent> =
    {
      name: "triggerMatch",
      eventTypes: [
        EVALUATION_COMPLETED_EVENT_TYPE,
        EVALUATION_REPORTED_EVENT_TYPE,
      ],
      options: { delay: 10_000 },
      handle: async () => {},
    };
  const graphActivityHandler = vi.fn().mockResolvedValue(undefined);
  const pipeline = createEvaluationProcessingPipeline({
    evalRunStore: foldStore<EvaluationRunData>(),
    evaluationAnalyticsStore: foldStore<EvaluationAnalyticsData>(),
    evaluationAnalyticsRollupAppendStore: {
      append: vi.fn().mockResolvedValue(undefined),
    },
    executeEvaluationCommand: {} as never,
    commands: { port: () => async () => {} } as never,
    isSaas,
    automations: {
      triggerMatchSubscriber,
      graphActivityHandler,
    },
  });
  return { pipeline, triggerMatchSubscriber, graphActivityHandler };
}

describe("evaluation processing pipeline subscriber wiring", () => {
  describe("given the triggerMatch subscriber", () => {
    it("registers the injected definition verbatim, adding no delay or dedup of its own", () => {
      const { pipeline, triggerMatchSubscriber } = buildPipeline();

      // The delay, the dedup key and the enqueue filter belong to the
      // subscriber now, not to this mount, and are tested where they are
      // authored. What matters here is that the pipeline registers exactly
      // what it was handed.
      expect(pipeline.eventSubscribers.get("triggerMatch")).toBe(
        triggerMatchSubscriber,
      );
    });
  });

  describe("given the billing poke", () => {
    it("meters the reported event, the only billable evaluation event", () => {
      const { pipeline } = buildPipeline();
      const poke = pipeline.eventSubscribers.get("billingMeterPoke");

      expect(poke).toBeDefined();
      expect(poke?.eventTypes).toEqual([EVALUATION_REPORTED_EVENT_TYPE]);
      expect(poke?.options?.disabled).toBe(false);
    });

    it("is off outside the SaaS build, where nothing could report the usage", () => {
      const { pipeline } = buildPipeline({ isSaas: false });

      expect(
        pipeline.eventSubscribers.get("billingMeterPoke")?.options?.disabled,
      ).toBe(true);
    });
  });

  describe("given the graphTriggerActivity subscriber", () => {
    it("registers as an event-only subscriber with the graph-trigger debounce delay", () => {
      const { pipeline } = buildPipeline();

      const entry = pipeline.eventSubscribers.get("graphTriggerActivity");
      expect(entry).toBeDefined();
      expect([...(entry?.eventTypes ?? [])].sort()).toEqual(
        [
          EVALUATION_COMPLETED_EVENT_TYPE,
          EVALUATION_REPORTED_EVENT_TYPE,
        ].sort(),
      );
      expect(entry?.options?.delay).toBe(GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS);
    });

    it("dedups per tenant with the graph-trigger debounce ttl, without extend/replace", () => {
      const { pipeline } = buildPipeline();
      const entry = pipeline.eventSubscribers.get("graphTriggerActivity");
      const dedup = entry?.options?.deduplication as
        | {
            makeId: (event: EvaluationProcessingEvent) => string;
            ttlMs?: number;
            extend?: boolean;
            replace?: boolean;
          }
        | undefined;

      expect(dedup?.ttlMs).toBe(GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS);
      expect(dedup?.extend).toBe(false);
      expect(dedup?.replace).toBe(false);
      expect(dedup?.makeId(completedEvent())).toBe(
        `graph-trigger-activity:${tenantId}`,
      );
    });

    it("delegates to automations.graphActivityHandler with the tenant and aggregate id", async () => {
      const { pipeline, graphActivityHandler } = buildPipeline();
      const entry = pipeline.eventSubscribers.get("graphTriggerActivity");
      const event = completedEvent();

      await entry?.handle(event, { tenantId, aggregateId: "eval-1" });

      expect(graphActivityHandler).toHaveBeenCalledTimes(1);
      expect(graphActivityHandler).toHaveBeenCalledWith(event, {
        tenantId,
        aggregateId: "eval-1",
      });
    });
  });
});
