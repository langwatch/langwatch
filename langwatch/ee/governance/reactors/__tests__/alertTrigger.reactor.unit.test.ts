// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { TriggerAction } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { TriggerSummary } from "~/server/app-layer/triggers/repositories/trigger.repository";
import type { DerivedTraceEvent } from "~/server/event-sourcing/pipelines/trace-processing/projections/services/trace-events.derivation";
import type { ReactorContext } from "~/server/event-sourcing/reactors/reactor.types";
import type { TraceProcessingEvent } from "~/server/event-sourcing/pipelines/trace-processing/schemas/events";
import { SPAN_RECEIVED_EVENT_TYPE } from "~/server/event-sourcing/pipelines/trace-processing/schemas/constants";
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

// Heavy I/O bound dependencies pulled in transitively via dispatchTriggerAction
// (email render + SES, Slack webhook). They throw on any unconfigured env in
// CI, which would short-circuit dispatch before `updateLastRunAt`. Stub them
// out so dispatch can complete its bookkeeping.
vi.mock("~/server/mailer/triggerEmail", () => ({
  sendTriggerEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/server/triggers/sendSlackWebhook", () => ({
  sendSlackWebhook: vi.fn().mockResolvedValue(undefined),
}));

function createTraceSummary(
  overrides: Partial<TraceSummaryData> = {},
): TraceSummaryData {
  return {
    traceId: "trace-1",
    traceName: "",
    spanCount: 2,
    totalDurationMs: 500,
    computedIOSchemaVersion: "1",
    computedInput: "test input",
    computedOutput: "test output",
    timeToFirstTokenMs: null,
    timeToLastTokenMs: null,
    tokensPerSecond: null,
    containsErrorStatus: false,
    containsOKStatus: true,
    errorMessage: null,
    models: ["gpt-5-mini"],
    totalCost: 0.01,
    nonBilledCost: null,
    tokensEstimated: false,
    totalPromptTokenCount: 100,
    totalCompletionTokenCount: 50,
    outputFromRootSpan: true,
    outputSpanEndTimeMs: 500,
    blockedByGuardrail: false,
    rootSpanType: null,
    containsAi: false,
    topicId: null,
    subTopicId: null,
    annotationIds: [],
    containsPrompt: false,
    selectedPromptId: null,
    selectedPromptSpanId: null,
    selectedPromptStartTimeMs: null,
    lastUsedPromptId: null,
    lastUsedPromptVersionNumber: null,
    lastUsedPromptVersionId: null,
    lastUsedPromptSpanId: null,
    lastUsedPromptStartTimeMs: null,
    attributes: {
      "langwatch.origin": "application",
      "langwatch.user_id": "user-1",
    },
    occurredAt: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    LastEventOccurredAt: Date.now(),
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
    type: SPAN_RECEIVED_EVENT_TYPE,
    version: "2025-01-14",
    tenantId: "tenant-1",
    occurredAt: Date.now(),
    data: {},
    ...overrides,
  } as TraceProcessingEvent;
}

function createContext(
  foldState: TraceSummaryData = createTraceSummary(),
): ReactorContext<TraceSummaryData> {
  return {
    tenantId: "tenant-1",
    aggregateId: "trace-1",
    foldState,
  };
}

/** A thumbs-down automation: fires when a thumbs_up_down event has vote == -1. */
function thumbsDownTrigger(
  overrides: Partial<TriggerSummary> = {},
): TriggerSummary {
  return {
    id: "trigger-1",
    projectId: "tenant-1",
    name: "Thumbs Down Alert",
    action: TriggerAction.SEND_EMAIL,
    actionParams: { members: ["user@example.com"] },
    filters: {
      "events.metrics.value": { thumbs_up_down: { vote: ["-1", "-1"] } },
    },
    alertType: "WARNING",
    message: "User gave a thumbs down",
    customGraphId: null,
    ...overrides,
  };
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
      getById: vi.fn().mockResolvedValue({
        id: "tenant-1",
        slug: "test-project",
      }),
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

  describe("given a thumbs-down automation", () => {
    describe("when the trace has no down-vote", () => {
      it("does not dispatch the trigger action", async () => {
        (
          deps.triggers.getActiveTraceTriggersForProject as any
        ).mockResolvedValue([thumbsDownTrigger()]);
        // No thumbs_up_down event at all → condition unmet.
        (deps.deriveEvents as any).mockResolvedValue([]);

        const reactor = createAlertTriggerReactor(deps);
        await reactor.handle(createEvent(), createContext());

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
        await reactor.handle(createEvent(), createContext());

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
        await reactor.handle(createEvent(), createContext());

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
        await reactor.handle(createEvent(), createContext());

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
        await reactor.handle(createEvent(), createContext());

        expect(deps.deriveEvents).toHaveBeenCalledWith(
          expect.objectContaining({ tenantId: "tenant-1", traceId: "trace-1" }),
        );
      });
    });
  });
});
