// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { TriggerAction } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { TriggerSummary } from "~/server/app-layer/triggers/repositories/trigger.repository";
import { DispatchError } from "~/server/event-sourcing/outbox/dispatchError";
import type { DerivedTraceEvent } from "~/server/event-sourcing/pipelines/trace-processing/projections/services/trace-events.derivation";
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
  toError: vi.fn((e) => (e instanceof Error ? e : new Error(String(e)))),
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
    actionParams: {
      annotators: [{ id: "annotator-1", name: "Ops" }],
      createdByUserId: "user-1",
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

/**
 * A thumbs-down automation: fires when a `thumbs_up_down` event has vote == -1
 * (#4903 / #4805). Persist-class (annotation-queue) so it flows through the
 * inline alertTrigger reactor under test — notify-class triggers are owned by
 * the `.withOutbox` reactor and would never claim a send here.
 */
function thumbsDownTrigger(
  overrides: Partial<TriggerSummary> = {},
): TriggerSummary {
  return createTrigger({
    filters: {
      "events.metrics.value": { thumbs_up_down: { vote: ["-1", "-1"] } },
    },
    ...overrides,
  });
}

/** A derived thumbs_up_down span event carrying the given vote metric. */
function voteEvent(vote: number): DerivedTraceEvent {
  return {
    spanId: "span-1",
    timestamp: Date.now(),
    name: "thumbs_up_down",
    attributes: {
      "event.type": "thumbs_up_down",
      "event.metrics.vote": String(vote),
    },
  } as unknown as DerivedTraceEvent;
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

  // #4903 (#4805): a thumbs-down automation is an `events.metrics.value` range
  // (vote == -1), not a distinct event type. The in-memory matcher used to skip
  // that field and an all-skipped filter set matched every trace — so the alert
  // fired on every trace. These exercise the persist-class path through the
  // inline reactor with the fixed matcher.
  describe("given a thumbs-down automation", () => {
    describe("when the trace has no down-vote", () => {
      it("does not dispatch the trigger action", async () => {
        (
          deps.triggers.getActiveTraceTriggersForProject as any
        ).mockResolvedValue([thumbsDownTrigger()]);
        // No thumbs_up_down event at all → condition unmet.
        (deps.deriveEvents as any).mockResolvedValue([]);

        const reactor = createAlertTriggerReactor(deps);
        await reactor.handle(createEvent(), createContext(createFoldState()));

        expect(deps.triggers.claimSend).not.toHaveBeenCalled();
        expect(deps.triggers.updateLastRunAt).not.toHaveBeenCalled();
      });
    });

    describe("when the trace has an up-vote", () => {
      it("does not dispatch the trigger action", async () => {
        (
          deps.triggers.getActiveTraceTriggersForProject as any
        ).mockResolvedValue([thumbsDownTrigger()]);
        (deps.deriveEvents as any).mockResolvedValue([voteEvent(1)]);

        const reactor = createAlertTriggerReactor(deps);
        await reactor.handle(createEvent(), createContext(createFoldState()));

        expect(deps.triggers.claimSend).not.toHaveBeenCalled();
      });
    });

    describe("when the trace has a down-vote", () => {
      it("dispatches the trigger action exactly once", async () => {
        (
          deps.triggers.getActiveTraceTriggersForProject as any
        ).mockResolvedValue([thumbsDownTrigger()]);
        (deps.deriveEvents as any).mockResolvedValue([voteEvent(-1)]);

        const reactor = createAlertTriggerReactor(deps);
        await reactor.handle(createEvent(), createContext(createFoldState()));

        expect(deps.triggers.claimSend).toHaveBeenCalledTimes(1);
        expect(deps.triggers.claimSend).toHaveBeenCalledWith({
          triggerId: "trigger-1",
          traceId: "trace-1",
          projectId: "tenant-1",
        });
        expect(deps.triggers.updateLastRunAt).toHaveBeenCalledTimes(1);
      });
    });

    describe("when the trigger was already sent for this trace", () => {
      it("respects at-most-once and does not dispatch", async () => {
        (
          deps.triggers.getActiveTraceTriggersForProject as any
        ).mockResolvedValue([thumbsDownTrigger()]);
        (deps.deriveEvents as any).mockResolvedValue([voteEvent(-1)]);
        // Lost the claim race (another reactor already sent).
        (deps.triggers.claimSend as any).mockResolvedValue(false);

        const reactor = createAlertTriggerReactor(deps);
        await reactor.handle(createEvent(), createContext(createFoldState()));

        expect(deps.triggers.claimSend).toHaveBeenCalledTimes(1);
        expect(deps.triggers.updateLastRunAt).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a thumbs-down automation that references event fields", () => {
    describe("when the trace has a down-vote", () => {
      it("derives the trace events list before matching", async () => {
        (
          deps.triggers.getActiveTraceTriggersForProject as any
        ).mockResolvedValue([thumbsDownTrigger()]);
        (deps.deriveEvents as any).mockResolvedValue([voteEvent(-1)]);

        const reactor = createAlertTriggerReactor(deps);
        await reactor.handle(createEvent(), createContext(createFoldState()));

        expect(deps.deriveEvents).toHaveBeenCalledWith(
          expect.objectContaining({ tenantId: "tenant-1", traceId: "trace-1" }),
        );
      });
    });
  });
});
