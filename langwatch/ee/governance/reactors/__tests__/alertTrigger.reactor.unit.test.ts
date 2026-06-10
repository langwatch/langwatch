import { TriggerAction } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { TriggerSummary } from "~/server/app-layer/triggers/repositories/trigger.repository";
import { DispatchError } from "~/server/event-sourcing/outbox/dispatchError";
import type { ReactorContext } from "~/server/event-sourcing/reactors/reactor.types";
import type { TraceProcessingEvent } from "~/server/event-sourcing/pipelines/trace-processing/schemas/events";
import { captureException } from "~/utils/posthogErrorCapture";
import {
  createAlertTriggerReactor,
  type AlertTriggerReactorDeps,
} from "../alertTrigger.reactor";

vi.mock("~/utils/logger/server", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("~/utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
}));

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
    type: "lw.obs.trace.span_received",
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

function createTrigger(overrides: Partial<TriggerSummary> = {}): TriggerSummary {
  // Default to ADD_TO_ANNOTATION_QUEUE (persist-class, single-call
  // dispatch path) so these tests exercise the inline path the reactor
  // now owns. NOTIFY-class actions (SEND_EMAIL / SEND_SLACK_MESSAGE)
  // flow through the `.withOutbox`-registered
  // alertTriggerNotifyOutbox reactor — see its own test file.
  return {
    id: "trigger-1",
    projectId: "tenant-1",
    name: "Latency Alert",
    action: TriggerAction.ADD_TO_ANNOTATION_QUEUE,
    actionParams: { annotators: [{ id: "annotator-1", name: "Ops" }] },
    filters: {},
    alertType: "WARNING",
    message: "",
    customGraphId: null,
    notificationCadence: "immediate",
    traceDebounceMs: 30000,
    ...overrides,
  };
}

function createDeps(
  overrides: Partial<AlertTriggerReactorDeps> = {},
): AlertTriggerReactorDeps {
  return {
    triggers: {
      getActiveTraceTriggersForProject: vi.fn().mockResolvedValue([]),
      claimSend: vi.fn().mockResolvedValue(true),
      updateLastRunAt: vi.fn().mockResolvedValue(undefined),
      invalidate: vi.fn(),
    } as any,
    projects: {
      getById: vi.fn().mockResolvedValue({ id: "tenant-1", slug: "demo" }),
    } as any,
    traceById: vi.fn().mockResolvedValue(undefined),
    addToAnnotationQueue: vi.fn().mockResolvedValue(undefined),
    addToDataset: vi.fn().mockResolvedValue(undefined),
    deriveEvents: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe("alertTrigger reactor", () => {
  let deps: AlertTriggerReactorDeps;

  beforeEach(() => {
    deps = createDeps();
    vi.clearAllMocks();
  });

  describe("when a trace-only trigger matches", () => {
    it("claims the match, dispatches, and records the trigger as run", async () => {
      (deps.triggers.getActiveTraceTriggersForProject as any).mockResolvedValue([
        createTrigger(),
      ]);

      const reactor = createAlertTriggerReactor(deps);
      await reactor.handle(createEvent(), createContext(createFoldState()));

      expect(deps.triggers.claimSend).toHaveBeenCalledWith({
        triggerId: "trigger-1",
        traceId: "trace-1",
        projectId: "tenant-1",
      });
      expect(deps.triggers.updateLastRunAt).toHaveBeenCalledWith(
        "trigger-1",
        "tenant-1",
      );
    });
  });

  describe("when the only active triggers are notify-class", () => {
    it("never claims a send (the notify outbox reactor owns them)", async () => {
      (deps.triggers.getActiveTraceTriggersForProject as any).mockResolvedValue([
        createTrigger({ action: TriggerAction.SEND_EMAIL }),
        createTrigger({
          id: "trigger-slack",
          action: TriggerAction.SEND_SLACK_MESSAGE,
        }),
      ]);

      const reactor = createAlertTriggerReactor(deps);
      await reactor.handle(createEvent(), createContext(createFoldState()));

      expect(deps.triggers.claimSend).not.toHaveBeenCalled();
      expect(deps.triggers.updateLastRunAt).not.toHaveBeenCalled();
    });
  });

  describe("when the only active triggers have evaluation filters", () => {
    it("never claims a send (the evaluation pipeline owns them)", async () => {
      (deps.triggers.getActiveTraceTriggersForProject as any).mockResolvedValue([
        createTrigger({
          filters: { "evaluations.passed": { "evaluator-1": ["true"] } },
        }),
      ]);

      const reactor = createAlertTriggerReactor(deps);
      await reactor.handle(createEvent(), createContext(createFoldState()));

      expect(deps.triggers.claimSend).not.toHaveBeenCalled();
    });
  });

  describe("when no trigger filter references event fields", () => {
    it("skips the events derivation entirely", async () => {
      (deps.triggers.getActiveTraceTriggersForProject as any).mockResolvedValue([
        createTrigger(),
      ]);

      const reactor = createAlertTriggerReactor(deps);
      await reactor.handle(createEvent(), createContext(createFoldState()));

      expect(deps.deriveEvents).not.toHaveBeenCalled();
      expect(deps.triggers.claimSend).toHaveBeenCalled();
    });
  });

  describe("when the match was already claimed", () => {
    it("does not dispatch or record the trigger as run", async () => {
      (deps.triggers.getActiveTraceTriggersForProject as any).mockResolvedValue([
        createTrigger(),
      ]);
      (deps.triggers.claimSend as any).mockResolvedValue(false);

      const reactor = createAlertTriggerReactor(deps);
      await reactor.handle(createEvent(), createContext(createFoldState()));

      expect(deps.triggers.claimSend).toHaveBeenCalled();
      expect(deps.triggers.updateLastRunAt).not.toHaveBeenCalled();
    });
  });

  describe("when a trigger's dispatch fails", () => {
    it("surfaces the failure with its retryable flag and does not record the trigger as run", async () => {
      (deps.triggers.getActiveTraceTriggersForProject as any).mockResolvedValue([
        createTrigger(),
      ]);
      (deps.addToAnnotationQueue as any).mockRejectedValueOnce(
        new DispatchError({ message: "provider 503", retryable: true }),
      );

      const reactor = createAlertTriggerReactor(deps);
      await reactor.handle(createEvent(), createContext(createFoldState()));

      expect(deps.triggers.claimSend).toHaveBeenCalled();
      expect(deps.triggers.updateLastRunAt).not.toHaveBeenCalled();
      expect(captureException).toHaveBeenCalledWith(
        expect.any(DispatchError),
        expect.objectContaining({
          extra: expect.objectContaining({ retryable: true }),
        }),
      );
    });
  });

  describe("when one of several matching triggers fails to dispatch", () => {
    it("still dispatches the remaining triggers", async () => {
      (deps.triggers.getActiveTraceTriggersForProject as any).mockResolvedValue([
        createTrigger({ id: "trigger-failing" }),
        createTrigger({ id: "trigger-ok" }),
      ]);
      (deps.addToAnnotationQueue as any)
        .mockRejectedValueOnce(
          new DispatchError({ message: "revoked", retryable: false }),
        )
        .mockResolvedValueOnce(undefined);

      const reactor = createAlertTriggerReactor(deps);
      await reactor.handle(createEvent(), createContext(createFoldState()));

      expect(deps.triggers.claimSend).toHaveBeenCalledTimes(2);
      expect(deps.triggers.updateLastRunAt).toHaveBeenCalledTimes(1);
      expect(deps.triggers.updateLastRunAt).toHaveBeenCalledWith(
        "trigger-ok",
        "tenant-1",
      );
    });
  });
});
