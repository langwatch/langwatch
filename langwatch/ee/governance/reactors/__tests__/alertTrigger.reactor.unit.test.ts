// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { TriggerAction } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { TriggerSummary } from "~/server/app-layer/triggers/repositories/trigger.repository";
import {
  ORIGIN_RESOLVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_TYPE,
} from "~/server/event-sourcing/pipelines/trace-processing/schemas/constants";
import type { TraceProcessingEvent } from "~/server/event-sourcing/pipelines/trace-processing/schemas/events";
import type { ReactorContext } from "~/server/event-sourcing/reactors/reactor.types";
import {
  type AlertTriggerReactorDeps,
  createAlertTriggerReactor,
} from "../alertTrigger.reactor";

function createFoldState(
  overrides: Partial<TraceSummaryData> = {},
): TraceSummaryData {
  return {
    traceId: "trace-1",
    spanCount: 1,
    totalDurationMs: 100,
    computedIOSchemaVersion: "1",
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
    tokensEstimated: false,
    totalPromptTokenCount: null,
    totalCompletionTokenCount: null,
    outputFromRootSpan: false,
    outputSpanEndTimeMs: 0,
    blockedByGuardrail: false,
    topicId: null,
    subTopicId: null,
    annotationIds: [],
    occurredAt: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    LastEventOccurredAt: Date.now(),
    attributes: { "langwatch.origin": "application" },
    ...overrides,
  } as TraceSummaryData;
}

function createEvent(
  overrides: Record<string, unknown> = {},
): TraceProcessingEvent {
  return {
    id: "event-1",
    aggregateId: "trace-1",
    aggregateType: "trace",
    tenantId: "tenant-1",
    createdAt: Date.now(),
    occurredAt: Date.now(),
    type: SPAN_RECEIVED_EVENT_TYPE,
    version: "2025-01-14",
    data: {},
    ...overrides,
  } as unknown as TraceProcessingEvent;
}

function createContext(
  foldState: TraceSummaryData,
): ReactorContext<TraceSummaryData> {
  return { tenantId: "tenant-1", aggregateId: "trace-1", foldState };
}

function createTrigger(
  overrides: Partial<TriggerSummary> = {},
): TriggerSummary {
  // Default to ADD_TO_DATASET (persist-class) so these tests exercise
  // the persist branch this reactor now owns. NOTIFY-class actions
  // (SEND_EMAIL / SEND_SLACK_MESSAGE) flow through the
  // alertTriggerNotifyOutbox reactor; eval-filter triggers flow through
  // the evaluation pipeline.
  return {
    id: "trigger-1",
    projectId: "tenant-1",
    name: "Latency Alert",
    action: TriggerAction.ADD_TO_DATASET,
    actionParams: {
      datasetId: "dataset-1",
      datasetMapping: { mapping: {}, expansions: [] },
    },
    filters: {},
    alertType: "WARNING",
    message: "",
    customGraphId: null,
    notificationCadence: "immediate",
    traceDebounceMs: 30000,
    templates: {
      slackTemplateType: null,
      slackTemplate: null,
      emailSubjectTemplate: null,
      emailBodyTemplate: null,
    },
    ...overrides,
  };
}

function createDeps(
  overrides: Partial<AlertTriggerReactorDeps> = {},
): AlertTriggerReactorDeps {
  return {
    triggers: {
      getActiveTraceTriggersForProject: vi.fn().mockResolvedValue([]),
    } as any,
    ...overrides,
  };
}

describe("alertTrigger reactor (persist outbox)", () => {
  let deps: AlertTriggerReactorDeps;

  beforeEach(() => {
    deps = createDeps();
    vi.clearAllMocks();
  });

  describe("given an active persist-class trace-only trigger", () => {
    describe("when the reactor decides", () => {
      it("emits a settle-stage request stamped actionClass=persist with the per-trigger debounce TTL", async () => {
        const trigger = createTrigger({ traceDebounceMs: 45_000 });
        (
          deps.triggers.getActiveTraceTriggersForProject as any
        ).mockResolvedValue([trigger]);

        const reactor = createAlertTriggerReactor(deps);
        const requests = await reactor.decide(
          createEvent(),
          createContext(createFoldState()),
        );

        expect(requests).toHaveLength(1);
        const [request] = requests;
        expect(request!.dedupKey).toBe("tenant-1/trigger-1:trace:trace-1");
        expect(request!.groupKey).toBe("tenant-1/triggerNotify:trigger-1");
        expect(request!.enqueueOptions).toEqual({ ttlMs: 45_000 });
        const payload = request!.payload as unknown as {
          stage: string;
          actionClass: string;
          projectId: string;
          triggerId: string;
          traceId: string;
          foldSnapshotAtEnqueue: {
            computedInput: string;
            computedOutput: string;
          };
        };
        expect(payload.stage).toBe("settle");
        // The marker the cadence handler reads to pick dispatchTriggerAction.
        expect(payload.actionClass).toBe("persist");
        expect(payload.projectId).toBe("tenant-1");
        expect(payload.triggerId).toBe("trigger-1");
        expect(payload.traceId).toBe("trace-1");
        expect(payload.foldSnapshotAtEnqueue).toEqual({
          computedInput: "hello",
          computedOutput: "world",
        });
      });
    });

    describe("when the trigger filters on event fields", () => {
      it("still emits a settle request without deriving events itself (the settle stage re-reads + filters)", async () => {
        const trigger = createTrigger({
          filters: {
            "events.metrics.value": { thumbs_up_down: { vote: ["-1", "-1"] } },
          },
        });
        (
          deps.triggers.getActiveTraceTriggersForProject as any
        ).mockResolvedValue([trigger]);

        const reactor = createAlertTriggerReactor(deps);
        const requests = await reactor.decide(
          createEvent(),
          createContext(createFoldState()),
        );

        // The reactor no longer evaluates filters or derives events — it
        // only enqueues; the settle dispatcher re-reads the settled fold
        // and runs the filters against the complete state.
        expect(requests).toHaveLength(1);
        expect(
          (requests[0]!.payload as unknown as { actionClass: string })
            .actionClass,
        ).toBe("persist");
      });
    });
  });

  describe("given a NOTIFY-class trigger", () => {
    describe("when the reactor decides", () => {
      it("emits nothing (the notify outbox reactor owns notify)", async () => {
        (
          deps.triggers.getActiveTraceTriggersForProject as any
        ).mockResolvedValue([
          createTrigger({
            action: TriggerAction.SEND_EMAIL,
            actionParams: { members: ["ops@example.com"] },
          }),
          createTrigger({
            id: "trigger-slack",
            action: TriggerAction.SEND_SLACK_MESSAGE,
            actionParams: { slackWebhook: "https://hooks.slack.com/x" },
          }),
        ]);

        const reactor = createAlertTriggerReactor(deps);
        const requests = await reactor.decide(
          createEvent(),
          createContext(createFoldState()),
        );

        expect(requests).toHaveLength(0);
      });
    });
  });

  describe("given a trigger with evaluation filters", () => {
    describe("when the reactor decides", () => {
      it("emits nothing (the evaluation pipeline owns those triggers)", async () => {
        (
          deps.triggers.getActiveTraceTriggersForProject as any
        ).mockResolvedValue([
          createTrigger({
            filters: { "evaluations.passed": { "evaluator-1": ["true"] } },
          }),
        ]);

        const reactor = createAlertTriggerReactor(deps);
        const requests = await reactor.decide(
          createEvent(),
          createContext(createFoldState()),
        );

        expect(requests).toHaveLength(0);
      });
    });
  });

  describe("given several persist triggers on the same trace", () => {
    describe("when the reactor decides", () => {
      it("emits one settle request per trigger so each gets its own debounce window", async () => {
        const a = createTrigger({ id: "trig-a", traceDebounceMs: 30_000 });
        const b = createTrigger({ id: "trig-b", traceDebounceMs: 60_000 });
        (
          deps.triggers.getActiveTraceTriggersForProject as any
        ).mockResolvedValue([a, b]);

        const reactor = createAlertTriggerReactor(deps);
        const requests = await reactor.decide(
          createEvent(),
          createContext(createFoldState()),
        );

        expect(requests).toHaveLength(2);
        expect(requests.map((r) => r.enqueueOptions?.ttlMs)).toEqual([
          30_000, 60_000,
        ]);
      });
    });
  });

  describe("given the origin guard", () => {
    describe("when the trace origin is not resolved", () => {
      it("suppresses the decide() body so no request emits", async () => {
        (
          deps.triggers.getActiveTraceTriggersForProject as any
        ).mockResolvedValue([createTrigger()]);

        const reactor = createAlertTriggerReactor(deps);
        const requests = await reactor.decide(
          createEvent(),
          createContext(createFoldState({ attributes: {} })),
        );

        expect(requests).toHaveLength(0);
        // Origin gate runs before the trigger fetch.
        expect(
          deps.triggers.getActiveTraceTriggersForProject,
        ).not.toHaveBeenCalled();
      });
    });

    describe("when the event is a derived (non-message) event", () => {
      it("rejects topic_assigned but still fires on origin_resolved", async () => {
        (
          deps.triggers.getActiveTraceTriggersForProject as any
        ).mockResolvedValue([createTrigger()]);

        const reactor = createAlertTriggerReactor(deps);

        const rejected = await reactor.decide(
          createEvent({ type: "lw.obs.trace.topic_assigned" }),
          createContext(createFoldState()),
        );
        expect(rejected).toHaveLength(0);

        const fired = await reactor.decide(
          createEvent({ type: ORIGIN_RESOLVED_EVENT_TYPE }),
          createContext(createFoldState()),
        );
        expect(fired).toHaveLength(1);
      });
    });
  });
});
