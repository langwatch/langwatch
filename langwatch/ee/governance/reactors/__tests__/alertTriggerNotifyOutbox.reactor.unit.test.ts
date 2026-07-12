import { TriggerAction, TriggerKind } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type {
  TriggerRepository,
  TriggerSummary,
} from "~/server/app-layer/triggers/repositories/trigger.repository";
import { TriggerService } from "~/server/app-layer/triggers/trigger.service";
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
    triggerKind: TriggerKind.AUTOMATION,
    actionParams: { members: ["user@example.com"] },
    filters: { "traces.origin": ["playground"] },
    alertType: "WARNING",
    message: "",
    customGraphId: null,
    notificationCadence: "immediate",
    filterQuery: null,
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

/**
 * The trace's prompt and response, as the fold holds them. Distinctive strings
 * so the "no content on the payload" assertion below cannot pass by accident.
 */
const TRACE_INPUT = "What is the patient's diagnosis?";
const TRACE_OUTPUT = "The patient has a suspected fracture.";

function createFoldState(
  overrides: Partial<TraceSummaryData> = {},
): TraceSummaryData {
  return {
    aggregateId: "trace-1",
    tenantId: "tenant-1",
    occurredAt: Date.now(),
    spanCount: 1,
    computedInput: TRACE_INPUT,
    computedOutput: TRACE_OUTPUT,
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

  describe("given active trace triggers on the project", () => {
    describe("when a NOTIFY-class trace-only trigger is active", () => {
      it("emits a settle-stage OutboxEnqueueRequest with the per-trigger debounce TTL", async () => {
        const trigger = createTrigger();
        (
          deps.triggers.getActiveTraceTriggersForProject as any
        ).mockResolvedValue([trigger]);

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
        };
        expect(payload.stage).toBe("settle");
        expect(payload.projectId).toBe("tenant-1");
        expect(payload.triggerId).toBe("trigger-notify");
        expect(payload.traceId).toBe("trace-1");
      });

      it("carries no trace content on the payload", async () => {
        const trigger = createTrigger();
        (
          deps.triggers.getActiveTraceTriggersForProject as any
        ).mockResolvedValue([trigger]);

        const reactor = createAlertTriggerNotifyOutboxReactor(deps);
        const requests = await reactor.decide(
          createEvent(),
          createContext(createFoldState()),
        );

        // A settle payload carries an IDENTITY, never trace content: settle
        // re-reads the fold at fire time, so a copy here would be unread
        // customer text living in Redis and (via the audit projection) at rest
        // in Postgres, outliving the trace it came from.
        const serialized = JSON.stringify(requests[0]!.payload);
        expect(serialized).not.toContain(TRACE_INPUT);
        expect(serialized).not.toContain(TRACE_OUTPUT);
        expect(serialized).not.toContain("patient");
      });
    });

    describe("when a trigger has evaluation filters", () => {
      it("does not emit a request (the evaluation pipeline owns those triggers)", async () => {
        const trigger = createTrigger({
          filters: { "evaluations.passed": { "evaluator-1": ["true"] } },
        });
        (
          deps.triggers.getActiveTraceTriggersForProject as any
        ).mockResolvedValue([trigger]);

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
        (
          deps.triggers.getActiveTraceTriggersForProject as any
        ).mockResolvedValue([trigger]);

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
        (
          deps.triggers.getActiveTraceTriggersForProject as any
        ).mockResolvedValue([a, b]);

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
        (
          deps.triggers.getActiveTraceTriggersForProject as any
        ).mockResolvedValue([trigger]);

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
        (
          deps.triggers.getActiveTraceTriggersForProject as any
        ).mockResolvedValue([trigger]);

        const reactor = createAlertTriggerNotifyOutboxReactor(deps);
        const requests = await reactor.decide(
          createEvent({ type: "lw.obs.trace.topic_assigned" as any }),
          createContext(createFoldState()),
        );

        expect(requests).toHaveLength(0);
      });

      it("but origin_resolved (the deferred-origin completion event) still fires", async () => {
        const trigger = createTrigger();
        (
          deps.triggers.getActiveTraceTriggersForProject as any
        ).mockResolvedValue([trigger]);

        const reactor = createAlertTriggerNotifyOutboxReactor(deps);
        const requests = await reactor.decide(
          createEvent({ type: ORIGIN_RESOLVED_EVENT_TYPE }),
          createContext(createFoldState()),
        );

        expect(requests).toHaveLength(1);
      });
    });
  });

  /**
   * ADR-044 regression. A scheduled report is persisted as a Trigger row with
   * `triggerKind: REPORT`, `filters: {}` and no `customGraphId` — structurally
   * identical to a match-everything trace automation with a NOTIFY action. This
   * reactor enqueues a settle for exactly that shape, and the settle dispatcher
   * skips its filter guard when `filters` is empty, so a leaked report became
   * ONE NOTIFICATION PER INGESTED TRACE on top of its weekly schedule.
   *
   * The real TriggerService is wired over the repository here — mocking the
   * service would mock away the very filter under test, so this drives the
   * genuine repository -> service -> reactor path.
   */
  describe("given the project's only active row is a scheduled report", () => {
    function repositoryReturning(rows: TriggerSummary[]): TriggerRepository {
      return {
        findActiveForProject: async () => rows,
        claimSend: async () => true,
        isSendClaimed: async () => false,
        updateLastRunAt: async () => undefined,
      };
    }

    const reportRow = createTrigger({
      id: "weekly-report",
      name: "Weekly dashboard report",
      triggerKind: TriggerKind.REPORT,
      action: TriggerAction.SEND_SLACK_MESSAGE,
      filters: {},
      filterQuery: null,
      customGraphId: null,
    });

    describe("when a trace is ingested", () => {
      it("enqueues no settle — a report fires on its schedule, never per trace", async () => {
        const reactor = createAlertTriggerNotifyOutboxReactor({
          triggers: new TriggerService(repositoryReturning([reportRow])),
        });

        const requests = await reactor.decide(
          createEvent(),
          createContext(createFoldState()),
        );

        expect(requests).toEqual([]);
      });
    });

    describe("when a genuine trace automation sits alongside the report", () => {
      it("enqueues a settle for the automation only", async () => {
        const reactor = createAlertTriggerNotifyOutboxReactor({
          triggers: new TriggerService(
            repositoryReturning([
              reportRow,
              createTrigger({ id: "trace-automation", filters: {} }),
            ]),
          ),
        });

        const requests = await reactor.decide(
          createEvent(),
          createContext(createFoldState()),
        );

        expect(requests).toHaveLength(1);
        expect(requests[0]!.groupKey).toContain("trace-automation");
      });
    });
  });
});
