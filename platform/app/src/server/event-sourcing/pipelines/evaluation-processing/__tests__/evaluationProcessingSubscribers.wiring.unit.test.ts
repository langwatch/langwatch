import { TriggerAction, TriggerKind } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { TriggerSummary } from "~/server/app-layer/automations/repositories/trigger.repository";
import type { EvaluationRunData } from "~/server/app-layer/evaluations/types";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import { RecordTriggerMatchCommand } from "~/server/event-sourcing/pipelines/automations/commands/recordTriggerMatch.command";
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

function completedEvent(occurredAt = 1_000): EvaluationCompletedEvent {
  return {
    id: "evt-completed",
    aggregateId: "eval-1",
    aggregateType: "evaluation",
    tenantId,
    createdAt: occurredAt,
    occurredAt,
    type: EVALUATION_COMPLETED_EVENT_TYPE,
    version: "2025-01-14",
    data: {
      evaluationId: "eval-1",
      traceId: "trace-1",
      status: "processed",
    },
  };
}

/** One automation that reads evaluations, so the trigger match has a match. */
function evaluationTrigger(): TriggerSummary {
  return {
    id: "trigger-1",
    projectId: String(tenantId),
    name: "Evaluation automation",
    action: TriggerAction.ADD_TO_DATASET,
    triggerKind: TriggerKind.AUTOMATION,
    actionParams: {},
    filters: { "evaluations.passed": { "evaluator-1": ["true"] } },
    alertType: "WARNING",
    message: "",
    customGraphId: null,
    notificationCadence: "immediate",
    filterQuery: null,
    traceDebounceMs: 30_000,
    templates: {
      slackTemplateType: null,
      slackTemplate: null,
      emailSubjectTemplate: null,
      emailBodyTemplate: null,
    },
  };
}

function buildPipeline({ isSaas = true }: { isSaas?: boolean } = {}) {
  const graphActivityHandler = vi.fn().mockResolvedValue(undefined);
  const readTraceSummary = vi
    .fn()
    .mockResolvedValue({ traceId: "trace-1" } as TraceSummaryData);
  const getActiveTraceTriggersForProject = vi
    .fn()
    .mockResolvedValue([evaluationTrigger()]);

  // One dispatcher per command class, so a test can name the command the
  // pipeline bound its port to rather than trusting "some port was taken".
  const dispatchers = new Map<unknown, ReturnType<typeof vi.fn>>();
  const port = vi.fn((command: unknown) => {
    const existing = dispatchers.get(command);
    if (existing) return existing;
    const dispatch = vi.fn().mockResolvedValue(undefined);
    dispatchers.set(command, dispatch);
    return dispatch;
  });

  const pipeline = createEvaluationProcessingPipeline({
    evalRunStore: foldStore<EvaluationRunData>(),
    evaluationAnalyticsStore: foldStore<EvaluationAnalyticsData>(),
    evaluationAnalyticsRollupAppendStore: {
      append: vi.fn().mockResolvedValue(undefined),
    },
    executeEvaluation: {} as never,
    commands: { port } as never,
    isSaas,
    automations: {
      triggers: { getActiveTraceTriggersForProject } as never,
      readTraceSummary,
      graphActivityHandler,
    },
  });

  return {
    pipeline,
    graphActivityHandler,
    readTraceSummary,
    getActiveTraceTriggersForProject,
    recordTriggerMatch: dispatchers.get(RecordTriggerMatchCommand),
  };
}

describe("evaluation processing pipeline subscriber wiring", () => {
  describe("given the triggerMatch subscriber", () => {
    it("mounts the evaluation-alert subscriber it builds itself over both terminal events", () => {
      const { pipeline } = buildPipeline();
      const entry = pipeline.eventSubscribers.get("triggerMatch");

      // The delay, the dedup key and the enqueue filter belong to the
      // subscriber, not to this mount, and are tested where they are authored
      // (`automations/subscribers/__tests__`). What matters here is that the
      // pipeline constructs it rather than receiving it built (ADR-082 Rule 1).
      expect(entry?.name).toBe("triggerMatch");
      expect([...(entry?.eventTypes ?? [])].sort()).toEqual(
        [
          EVALUATION_COMPLETED_EVENT_TYPE,
          EVALUATION_REPORTED_EVENT_TYPE,
        ].sort(),
      );
    });

    it("binds it to the trigger service, the trace-summary reader and the recordTriggerMatch port", async () => {
      const {
        pipeline,
        readTraceSummary,
        getActiveTraceTriggersForProject,
        recordTriggerMatch,
      } = buildPipeline();
      const occurredAt = Date.now();

      await pipeline.eventSubscribers
        .get("triggerMatch")
        ?.handle(completedEvent(occurredAt), {
          tenantId,
          aggregateId: "eval-1",
        });

      expect(readTraceSummary).toHaveBeenCalledWith({
        tenantId,
        traceId: "trace-1",
        occurredAtMs: occurredAt,
      });
      expect(getActiveTraceTriggersForProject).toHaveBeenCalledWith(tenantId);
      expect(recordTriggerMatch).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          occurredAt,
          triggerId: "trigger-1",
          traceId: "trace-1",
        }),
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
