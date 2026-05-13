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
    traceName: "trace-1",
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
      hasSentForTrace: vi.fn().mockResolvedValue(false),
      claimDispatchSlot: vi.fn().mockResolvedValue(true),
      recordSent: vi.fn().mockResolvedValue(undefined),
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
    ...overrides,
  };
}

describe("alertTrigger reactor", () => {
  let deps: AlertTriggerReactorDeps;

  beforeEach(() => {
    deps = createDeps();
    vi.clearAllMocks();
  });

  describe("when event is old (resyncing)", () => {
    it("skips processing", async () => {
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

  describe("when trace is blocked by guardrail without output", () => {
    it("skips processing", async () => {
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

      expect(deps.triggers.recordSent).not.toHaveBeenCalled();
    });
  });

  describe("when trace filters match", () => {
    it("dispatches and records sent", async () => {
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

      expect(deps.triggers.claimDispatchSlot).toHaveBeenCalledWith({
        triggerId: "trigger-1",
        traceId: "trace-1",
        projectId: "tenant-1",
      });
      expect(deps.triggers.recordSent).toHaveBeenCalledWith({
        triggerId: "trigger-1",
        traceId: "trace-1",
        projectId: "tenant-1",
      });
      expect(deps.triggers.updateLastRunAt).toHaveBeenCalledWith({
        triggerId: "trigger-1",
        projectId: "tenant-1",
      });
    });
  });

  describe("when trace filters do not match", () => {
    it("does not dispatch", async () => {
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

      expect(deps.triggers.recordSent).not.toHaveBeenCalled();
    });
  });

  describe("when trigger has already been sent for this trace", () => {
    it("skips dispatch (PG dedup)", async () => {
      const trigger = createTrigger();
      (deps.triggers.getActiveTraceTriggersForProject as any).mockResolvedValue(
        [trigger],
      );
      (deps.triggers.hasSentForTrace as any).mockResolvedValue(true);

      const reactor = createAlertTriggerReactor(deps);
      const event = createEvent();
      const context: ReactorContext<TraceSummaryData> = {
        tenantId: "tenant-1",
        aggregateId: "trace-1",
        foldState: createFoldState(),
      };

      await reactor.handle(event, context);

      expect(deps.triggers.recordSent).not.toHaveBeenCalled();
    });
  });

  describe("when redis claim is already held", () => {
    it("skips dispatch (in-flight dedup)", async () => {
      const trigger = createTrigger();
      (deps.triggers.getActiveTraceTriggersForProject as any).mockResolvedValue(
        [trigger],
      );
      (deps.triggers.claimDispatchSlot as any).mockResolvedValue(false);

      const reactor = createAlertTriggerReactor(deps);
      const event = createEvent();
      const context: ReactorContext<TraceSummaryData> = {
        tenantId: "tenant-1",
        aggregateId: "trace-1",
        foldState: createFoldState(),
      };

      await reactor.handle(event, context);

      expect(deps.triggers.recordSent).not.toHaveBeenCalled();
    });
  });
});
