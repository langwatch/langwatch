import { describe, expect, it, vi } from "vitest";

import type { EvaluationRunData } from "~/server/domain/evaluations/types";
import { GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS } from "~/server/event-sourcing/pipelines/automations/subscribers/graphTriggerActivity.subscriber";
import { createTenantId } from "../../../domain/tenantId";
import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
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

function buildPipeline() {
  const triggerMatchHandler = vi.fn().mockResolvedValue(undefined);
  const graphActivityHandler = vi.fn().mockResolvedValue(undefined);
  const pipeline = createEvaluationProcessingPipeline({
    evalRunStore: foldStore<EvaluationRunData>(),
    evaluationAnalyticsStore: foldStore<EvaluationAnalyticsData>(),
    evaluationAnalyticsRollupAppendStore: {
      append: vi.fn().mockResolvedValue(undefined),
    },
    executeEvaluationCommand: {} as never,
    automations: {
      triggerMatchHandler,
      graphActivityHandler,
    },
  });
  return { pipeline, triggerMatchHandler, graphActivityHandler };
}

describe("evaluation processing pipeline subscriber wiring", () => {
  describe("given the triggerMatch subscriber", () => {
    it("registers as a fold reactor on evaluationRun with a 10s delay and 30s dedup ttl", () => {
      const { pipeline } = buildPipeline();

      const entry = pipeline.foldReactors.get("triggerMatch");
      expect(entry?.projectionName).toBe("evaluationRun");
      expect(entry?.definition.options?.delay).toBe(10_000);
      expect(entry?.definition.options?.deduplication?.ttlMs).toBe(30_000);
    });

    it("reacts only to evaluation completed/reported events", () => {
      const { pipeline } = buildPipeline();
      const entry = pipeline.foldReactors.get("triggerMatch");
      const shouldReact = entry?.definition.shouldReact;

      const context = {} as never;
      expect(shouldReact?.(completedEvent(), context)).toBe(true);
      expect(
        shouldReact?.(
          {
            ...completedEvent(),
            type: "lw.evaluation.started",
          } as unknown as EvaluationProcessingEvent,
          context,
        ),
      ).toBe(false);
    });

    it("delegates to automations.triggerMatchHandler with the committed fold state", async () => {
      const { pipeline, triggerMatchHandler } = buildPipeline();
      const entry = pipeline.foldReactors.get("triggerMatch");
      const event = completedEvent();
      const foldState = {
        evaluationId: "eval-1",
      } as unknown as EvaluationRunData;

      await entry?.definition.handle(event, {
        tenantId,
        aggregateId: "eval-1",
        foldState,
      });

      expect(triggerMatchHandler).toHaveBeenCalledTimes(1);
      expect(triggerMatchHandler).toHaveBeenCalledWith(event, {
        tenantId,
        aggregateId: "eval-1",
        state: foldState,
      });
    });
  });

  describe("given the graphTriggerActivity subscriber", () => {
    it("registers as an event-only subscriber with the graph-trigger debounce delay", () => {
      const { pipeline } = buildPipeline();

      const entry = pipeline.eventSubscribers.get("graphTriggerActivity");
      expect(entry).toBeDefined();
      expect([...(entry?.eventTypes ?? [])].sort()).toEqual(
        [EVALUATION_COMPLETED_EVENT_TYPE, EVALUATION_REPORTED_EVENT_TYPE].sort(),
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
        state: undefined,
      });
    });
  });
});
