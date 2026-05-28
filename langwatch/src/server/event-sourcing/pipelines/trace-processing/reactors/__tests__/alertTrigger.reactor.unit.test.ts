import { TriggerAction } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { TriggerSummary } from "~/server/app-layer/triggers/repositories/trigger.repository";
import type { ReactorContext } from "../../../../reactors/reactor.types";
import type { TraceProcessingEvent } from "../../schemas/events";
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

vi.mock("~/server/mailer/triggerEmail", () => ({
  sendTriggerEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/server/triggers/sendSlackWebhook", () => ({
  sendSlackWebhook: vi.fn().mockResolvedValue(undefined),
}));

function createFoldState(
  overrides: Partial<TraceSummaryData> = {},
): TraceSummaryData {
  return {
    traceId: "trace-1",
    traceName: "trace-1",
    spanCount: 2,
    totalDurationMs: 500,
    computedIOSchemaVersion: "1",
    computedInput: "hello",
    computedOutput: "world",
    timeToFirstTokenMs: null,
    timeToLastTokenMs: null,
    tokensPerSecond: null,
    containsErrorStatus: false,
    containsOKStatus: true,
    errorMessage: null,
    models: ["gpt-5-mini"],
    totalCost: 0.01,
    tokensEstimated: false,
    totalPromptTokenCount: 100,
    totalCompletionTokenCount: 50,
    outputFromRootSpan: true,
    outputSpanEndTimeMs: 500,
    blockedByGuardrail: false,
    rootSpanType: null,
    containsAi: true,
    containsPrompt: false,
    selectedPromptId: null,
    selectedPromptSpanId: null,
    selectedPromptStartTimeMs: null,
    lastUsedPromptId: null,
    lastUsedPromptVersionNumber: null,
    lastUsedPromptVersionId: null,
    lastUsedPromptSpanId: null,
    lastUsedPromptStartTimeMs: null,
    topicId: null,
    subTopicId: null,
    annotationIds: [],
    attributes: {
      "langwatch.origin": "application",
      "langwatch.user_id": "user-1",
    },
    occurredAt: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    LastEventOccurredAt: Date.now(),
    ...overrides,
  };
}

function createEvent(
  overrides: Record<string, unknown> = {},
): TraceProcessingEvent {
  return {
    id: "event-1",
    aggregateId: "trace-1",
    aggregateType: "trace",
    type: "lw.obs.trace.span_received",
    version: 1,
    tenantId: "tenant-1",
    occurredAt: Date.now(),
    data: {
      span: {} as any,
      resource: null,
      instrumentationScope: null,
      piiRedactionLevel: "STRICT",
    },
    metadata: { spanId: "span-1", traceId: "trace-1" },
    ...overrides,
  } as unknown as TraceProcessingEvent;
}

function createTrigger(
  overrides: Partial<TriggerSummary> = {},
): TriggerSummary {
  return {
    id: "trigger-1",
    projectId: "tenant-1",
    name: "App Origin Alert",
    action: TriggerAction.SEND_EMAIL,
    actionParams: { members: ["user@example.com"] },
    filters: { "traces.origin": ["application"] },
    alertType: "WARNING",
    message: "Trace matched",
    customGraphId: null,
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

  describe("when event is old (replay/resync flood)", () => {
    it("skips before querying triggers", async () => {
      const reactor = createAlertTriggerReactor(deps);
      const event = createEvent({
        occurredAt: Date.now() - 2 * 60 * 60 * 1000,
      });
      const context: ReactorContext<TraceSummaryData> = {
        tenantId: "tenant-1",
        aggregateId: "trace-1",
        foldState: createFoldState(),
      };

      await reactor.handle(event, context);

      expect(
        deps.triggers.getActiveTraceTriggersForProject,
      ).not.toHaveBeenCalled();
    });
  });

  describe("when event type is not a message event", () => {
    it("skips so derived enrichment (topic_assigned, etc.) does not re-fan side effects", async () => {
      const reactor = createAlertTriggerReactor(deps);
      const event = createEvent({ type: "lw.obs.trace.topic_assigned" });
      const context: ReactorContext<TraceSummaryData> = {
        tenantId: "tenant-1",
        aggregateId: "trace-1",
        foldState: createFoldState(),
      };

      await reactor.handle(event, context);

      expect(
        deps.triggers.getActiveTraceTriggersForProject,
      ).not.toHaveBeenCalled();
    });
  });

  describe("when trace itself is older than the 24h cap", () => {
    it("skips even on a fresh span event", async () => {
      const reactor = createAlertTriggerReactor(deps);
      const event = createEvent();
      const context: ReactorContext<TraceSummaryData> = {
        tenantId: "tenant-1",
        aggregateId: "trace-1",
        foldState: createFoldState({
          occurredAt: Date.now() - 25 * 60 * 60 * 1000,
        }),
      };

      await reactor.handle(event, context);

      expect(
        deps.triggers.getActiveTraceTriggersForProject,
      ).not.toHaveBeenCalled();
    });
  });

  describe("when trace is blocked by guardrail without output", () => {
    it("skips before querying triggers", async () => {
      const reactor = createAlertTriggerReactor(deps);
      const event = createEvent();
      const context: ReactorContext<TraceSummaryData> = {
        tenantId: "tenant-1",
        aggregateId: "trace-1",
        foldState: createFoldState({
          blockedByGuardrail: true,
          computedOutput: "",
        }),
      };

      await reactor.handle(event, context);

      expect(
        deps.triggers.getActiveTraceTriggersForProject,
      ).not.toHaveBeenCalled();
    });
  });

  describe("when origin is not yet resolved", () => {
    it("skips so originGate can defer", async () => {
      const reactor = createAlertTriggerReactor(deps);
      const event = createEvent();
      const context: ReactorContext<TraceSummaryData> = {
        tenantId: "tenant-1",
        aggregateId: "trace-1",
        foldState: createFoldState({ attributes: {} }),
      };

      await reactor.handle(event, context);

      expect(
        deps.triggers.getActiveTraceTriggersForProject,
      ).not.toHaveBeenCalled();
    });
  });

  describe("when project has no active triggers", () => {
    it("returns without claiming or dispatching", async () => {
      const reactor = createAlertTriggerReactor(deps);
      const event = createEvent();
      const context: ReactorContext<TraceSummaryData> = {
        tenantId: "tenant-1",
        aggregateId: "trace-1",
        foldState: createFoldState(),
      };

      await reactor.handle(event, context);

      expect(deps.triggers.claimSend).not.toHaveBeenCalled();
    });
  });

  describe("when trigger has evaluation filters", () => {
    it("delegates to evaluationAlertTrigger reactor (skips here)", async () => {
      const trigger = createTrigger({
        filters: { "evaluations.passed": { "evaluator-1": ["true"] } },
      });
      (deps.triggers.getActiveTraceTriggersForProject as any).mockResolvedValue(
        [trigger],
      );

      const reactor = createAlertTriggerReactor(deps);
      const event = createEvent();
      const context: ReactorContext<TraceSummaryData> = {
        tenantId: "tenant-1",
        aggregateId: "trace-1",
        foldState: createFoldState(),
      };

      await reactor.handle(event, context);

      expect(deps.triggers.claimSend).not.toHaveBeenCalled();
    });
  });

  describe("when trace filters match", () => {
    it("claims, dispatches, and updates lastRunAt", async () => {
      const trigger = createTrigger();
      (deps.triggers.getActiveTraceTriggersForProject as any).mockResolvedValue(
        [trigger],
      );

      const reactor = createAlertTriggerReactor(deps);
      const event = createEvent();
      const context: ReactorContext<TraceSummaryData> = {
        tenantId: "tenant-1",
        aggregateId: "trace-1",
        foldState: createFoldState(),
      };

      await reactor.handle(event, context);

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

  describe("when trace filters do not match", () => {
    it("does not claim or dispatch", async () => {
      const trigger = createTrigger({
        filters: { "traces.origin": ["playground"] },
      });
      (deps.triggers.getActiveTraceTriggersForProject as any).mockResolvedValue(
        [trigger],
      );

      const reactor = createAlertTriggerReactor(deps);
      const event = createEvent();
      const context: ReactorContext<TraceSummaryData> = {
        tenantId: "tenant-1",
        aggregateId: "trace-1",
        foldState: createFoldState(),
      };

      await reactor.handle(event, context);

      expect(deps.triggers.claimSend).not.toHaveBeenCalled();
      expect(deps.triggers.updateLastRunAt).not.toHaveBeenCalled();
    });
  });

  describe("when claim is lost (concurrent reactor or retry)", () => {
    it("skips dispatch and lastRunAt", async () => {
      const trigger = createTrigger();
      (deps.triggers.getActiveTraceTriggersForProject as any).mockResolvedValue(
        [trigger],
      );
      (deps.triggers.claimSend as any).mockResolvedValue(false);

      const reactor = createAlertTriggerReactor(deps);
      const event = createEvent();
      const context: ReactorContext<TraceSummaryData> = {
        tenantId: "tenant-1",
        aggregateId: "trace-1",
        foldState: createFoldState(),
      };

      await reactor.handle(event, context);

      expect(deps.triggers.claimSend).toHaveBeenCalled();
      expect(deps.triggers.updateLastRunAt).not.toHaveBeenCalled();
    });
  });

  describe("when a trigger filters on event fields", () => {
    it("derives events lazily and matches against them", async () => {
      const trigger = createTrigger({
        filters: { "events.event_type": ["thumbs_up_down"] },
      });
      (deps.triggers.getActiveTraceTriggersForProject as any).mockResolvedValue(
        [trigger],
      );
      (deps.deriveEvents as any).mockResolvedValue([
        {
          spanId: "span-1",
          timestamp: 1700,
          name: "thumbs_up_down",
          attributes: {},
        },
      ]);

      const reactor = createAlertTriggerReactor(deps);
      const event = createEvent();
      const context: ReactorContext<TraceSummaryData> = {
        tenantId: "tenant-1",
        aggregateId: "trace-1",
        foldState: createFoldState(),
      };

      await reactor.handle(event, context);

      expect(deps.deriveEvents).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "tenant-1", traceId: "trace-1" }),
      );
      expect(deps.triggers.claimSend).toHaveBeenCalled();
    });
  });

  describe("when no trigger filters on event fields", () => {
    it("does not derive events (keeps the common path cheap)", async () => {
      const trigger = createTrigger();
      (deps.triggers.getActiveTraceTriggersForProject as any).mockResolvedValue(
        [trigger],
      );

      const reactor = createAlertTriggerReactor(deps);
      const event = createEvent();
      const context: ReactorContext<TraceSummaryData> = {
        tenantId: "tenant-1",
        aggregateId: "trace-1",
        foldState: createFoldState(),
      };

      await reactor.handle(event, context);

      expect(deps.deriveEvents).not.toHaveBeenCalled();
    });
  });
});
