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
  type AlertTriggerNotifyOutboxReactorDeps,
  createAlertTriggerNotifyOutboxReactor,
} from "../alertTriggerNotifyOutbox.reactor";

function createTrigger(
  overrides: Partial<TriggerSummary> = {},
): TriggerSummary {
  return {
    id: "trigger-notify",
    projectId: "tenant-1",
    name: "Latency Alert",
    action: TriggerAction.SEND_EMAIL,
    actionParams: { members: ["user@example.com"] },
    filters: { "traces.origin": ["playground"] },
    alertType: "WARNING",
    message: "",
    customGraphId: null,
    notificationCadence: "immediate",
    traceDebounceMs: 45_000,
    templates: {
      slackTemplateType: null,
      slackTemplate: null,
      emailSubjectTemplate: null,
      emailBodyTemplate: null,
    },
    ...overrides,
  };
}

function createFoldState(
  overrides: Partial<TraceSummaryData> = {},
): TraceSummaryData {
  return {
    aggregateId: "trace-1",
    tenantId: "tenant-1",
    occurredAt: Date.now(),
    spanCount: 1,
    computedInput: "in",
    computedOutput: "out",
    attributes: { "langwatch.origin": "playground" },
    ...overrides,
  } as TraceSummaryData;
}

function createEvent(
  overrides: Partial<TraceProcessingEvent> = {},
): TraceProcessingEvent {
  return {
    id: "event-1",
    aggregateId: "trace-1",
    aggregateType: "trace",
    type: SPAN_RECEIVED_EVENT_TYPE,
    version: "2025-01-14",
    tenantId: "tenant-1",
    occurredAt: Date.now(),
    data: {},
    ...overrides,
  } as TraceProcessingEvent;
}

function createContext(
  foldState: TraceSummaryData,
): ReactorContext<TraceSummaryData> {
  return { tenantId: "tenant-1", aggregateId: "trace-1", foldState };
}

function createDeps(
  overrides: Partial<AlertTriggerNotifyOutboxReactorDeps> = {},
): AlertTriggerNotifyOutboxReactorDeps {
  return {
    triggers: {
      getActiveTraceTriggersForProject: vi.fn().mockResolvedValue([]),
    } as any,
    ...overrides,
  };
}

describe("alertTriggerNotifyOutbox reactor", () => {
  let deps: AlertTriggerNotifyOutboxReactorDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createDeps();
  });

  describe("when a NOTIFY-class trace-only trigger is active", () => {
    it("emits a settle-stage OutboxEnqueueRequest with the per-trigger debounce TTL", async () => {
      const trigger = createTrigger();
      (deps.triggers.getActiveTraceTriggersForProject as any).mockResolvedValue(
        [trigger],
      );

      const reactor = createAlertTriggerNotifyOutboxReactor(deps);
      const requests = await reactor.decide(
        createEvent(),
        createContext(createFoldState()),
      );

      expect(requests).toHaveLength(1);
      const [request] = requests;
      expect(request!.dedupKey).toBe("tenant-1/trigger-notify:trace:trace-1");
      expect(request!.groupKey).toBe("tenant-1/triggerNotify:trigger-notify");
      expect(request!.enqueueOptions).toEqual({ ttlMs: 45_000 });
      const payload = request!.payload as unknown as {
        stage: string;
        projectId: string;
        triggerId: string;
        traceId: string;
        foldSnapshotAtEnqueue: {
          computedInput: string;
          computedOutput: string;
        };
      };
      expect(payload.stage).toBe("settle");
      expect(payload.projectId).toBe("tenant-1");
      expect(payload.triggerId).toBe("trigger-notify");
      expect(payload.traceId).toBe("trace-1");
      expect(payload.foldSnapshotAtEnqueue).toEqual({
        computedInput: "in",
        computedOutput: "out",
      });
    });
  });

  describe("when a trigger has evaluation filters", () => {
    it("does not emit a request (the evaluation pipeline owns those triggers)", async () => {
      const trigger = createTrigger({
        filters: { "evaluations.passed": { "evaluator-1": ["true"] } },
      });
      (deps.triggers.getActiveTraceTriggersForProject as any).mockResolvedValue(
        [trigger],
      );

      const reactor = createAlertTriggerNotifyOutboxReactor(deps);
      const requests = await reactor.decide(
        createEvent(),
        createContext(createFoldState()),
      );

      expect(requests).toHaveLength(0);
    });
  });

  describe("when a trigger is a persist action", () => {
    it("does not emit a request (the inline reactor owns persist actions)", async () => {
      const trigger = createTrigger({
        action: TriggerAction.ADD_TO_ANNOTATION_QUEUE,
      });
      (deps.triggers.getActiveTraceTriggersForProject as any).mockResolvedValue(
        [trigger],
      );

      const reactor = createAlertTriggerNotifyOutboxReactor(deps);
      const requests = await reactor.decide(
        createEvent(),
        createContext(createFoldState()),
      );

      expect(requests).toHaveLength(0);
    });
  });

  describe("when several notify triggers match the same trace", () => {
    it("emits one request per trigger so each gets its own settle window", async () => {
      const a = createTrigger({ id: "trig-a", traceDebounceMs: 30_000 });
      const b = createTrigger({ id: "trig-b", traceDebounceMs: 60_000 });
      (deps.triggers.getActiveTraceTriggersForProject as any).mockResolvedValue(
        [a, b],
      );

      const reactor = createAlertTriggerNotifyOutboxReactor(deps);
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

  describe("when the trace origin is not resolved", () => {
    it("the origin guard suppresses the decide() body so no request emits", async () => {
      const trigger = createTrigger();
      (deps.triggers.getActiveTraceTriggersForProject as any).mockResolvedValue(
        [trigger],
      );

      const reactor = createAlertTriggerNotifyOutboxReactor(deps);
      const requests = await reactor.decide(
        createEvent(),
        createContext(createFoldState({ attributes: {} })),
      );

      expect(requests).toHaveLength(0);
      // Origin gate runs before the trigger fetch, so we never call
      // out to the trigger service either.
      expect(
        deps.triggers.getActiveTraceTriggersForProject,
      ).not.toHaveBeenCalled();
    });
  });

  describe("when the event is not a message event", () => {
    it("the origin guard rejects derived events like topic_assigned", async () => {
      const trigger = createTrigger();
      (deps.triggers.getActiveTraceTriggersForProject as any).mockResolvedValue(
        [trigger],
      );

      const reactor = createAlertTriggerNotifyOutboxReactor(deps);
      const requests = await reactor.decide(
        createEvent({ type: "lw.obs.trace.topic_assigned" as any }),
        createContext(createFoldState()),
      );

      expect(requests).toHaveLength(0);
    });

    it("but origin_resolved (the deferred-origin completion event) still fires", async () => {
      const trigger = createTrigger();
      (deps.triggers.getActiveTraceTriggersForProject as any).mockResolvedValue(
        [trigger],
      );

      const reactor = createAlertTriggerNotifyOutboxReactor(deps);
      const requests = await reactor.decide(
        createEvent({ type: ORIGIN_RESOLVED_EVENT_TYPE }),
        createContext(createFoldState()),
      );

      expect(requests).toHaveLength(1);
    });
  });
});
