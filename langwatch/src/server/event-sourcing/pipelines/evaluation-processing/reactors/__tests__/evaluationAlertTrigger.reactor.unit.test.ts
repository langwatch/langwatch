import { TriggerAction } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvaluationRunData } from "~/server/app-layer/evaluations/types";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { TriggerSummary } from "~/server/app-layer/triggers/repositories/trigger.repository";
import type { ReactorContext } from "../../../../reactors/reactor.types";
import type { EvaluationProcessingEvent } from "../../schemas/events";
import {
  createEvaluationAlertTriggerReactor,
  type EvaluationAlertTriggerReactorDeps,
} from "../evaluationAlertTrigger.reactor";

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

// Heavy I/O bound dependencies pulled in transitively via dispatchTriggerAction
// (email render + SES, Slack webhook, dataset row mapping). They throw on any
// unconfigured env in CI, which would short-circuit dispatch before
// `updateLastRunAt`. Stub them out so dispatch can complete its bookkeeping.
vi.mock("~/server/mailer/triggerEmail", () => ({
  sendTriggerEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/server/triggers/sendSlackWebhook", () => ({
  sendSlackWebhook: vi.fn().mockResolvedValue(undefined),
}));

function createEvalFoldState(
  overrides: Partial<EvaluationRunData> = {},
): EvaluationRunData {
  return {
    evaluationId: "eval-1",
    evaluatorId: "evaluator-1",
    evaluatorType: "llm_judge",
    evaluatorName: "Quality Check",
    traceId: "trace-1",
    isGuardrail: false,
    status: "processed",
    score: 0.9,
    passed: true,
    label: null,
    details: null,
    inputs: null,
    error: null,
    errorDetails: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    LastEventOccurredAt: Date.now(),
    archivedAt: null,
    scheduledAt: null,
    startedAt: null,
    completedAt: Date.now(),
    costId: null,
    ...overrides,
  };
}

function createTraceSummary(
  overrides: Partial<TraceSummaryData> = {},
): TraceSummaryData {
  return {
    traceId: "trace-1",
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
    tokensEstimated: false,
    totalPromptTokenCount: 100,
    totalCompletionTokenCount: 50,
    outputFromRootSpan: true,
    outputSpanEndTimeMs: 500,
    blockedByGuardrail: false,
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
  } as TraceSummaryData;
}

function createEvent(
  overrides: Record<string, unknown> = {},
): EvaluationProcessingEvent {
  return {
    id: "event-1",
    aggregateId: "eval-1",
    aggregateType: "evaluation",
    type: "lw.evaluation.completed",
    version: "2025-01-14",
    tenantId: "tenant-1",
    occurredAt: Date.now(),
    data: { evaluationId: "eval-1", status: "processed" },
    ...overrides,
  } as EvaluationProcessingEvent;
}

function createTrigger(
  overrides: Partial<TriggerSummary> = {},
): TriggerSummary {
  return {
    id: "trigger-1",
    projectId: "tenant-1",
    name: "Quality Alert",
    action: TriggerAction.SEND_EMAIL,
    actionParams: { members: ["user@example.com"] },
    filters: {
      "evaluations.passed": { "evaluator-1": ["true"] },
    },
    alertType: "WARNING",
    message: "Evaluation passed",
    customGraphId: null,
    ...overrides,
  };
}

function createDeps(
  overrides: Partial<EvaluationAlertTriggerReactorDeps> = {},
): EvaluationAlertTriggerReactorDeps {
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
    traceSummaryStore: {
      get: vi.fn().mockResolvedValue(createTraceSummary()),
      store: vi.fn(),
    },
    evaluationRuns: {
      findByTraceId: vi.fn().mockResolvedValue([]),
    } as any,
    traceById: vi.fn().mockResolvedValue(undefined),
    addToAnnotationQueue: vi.fn().mockResolvedValue(undefined),
    addToDataset: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("evaluationAlertTrigger reactor", () => {
  let deps: EvaluationAlertTriggerReactorDeps;

  beforeEach(() => {
    deps = createDeps();
    vi.clearAllMocks();
  });

  describe("when event is not a terminal evaluation event", () => {
    it("skips non-completion events", async () => {
      const reactor = createEvaluationAlertTriggerReactor(deps);
      const event = createEvent({ type: "lw.evaluation.scheduled" });
      const context: ReactorContext<EvaluationRunData> = {
        tenantId: "tenant-1",
        aggregateId: "eval-1",
        foldState: createEvalFoldState(),
      };

      await reactor.handle(event, context);

      expect(deps.triggers.getActiveTraceTriggersForProject).not.toHaveBeenCalled();
    });
  });

  describe("when evaluation has no traceId", () => {
    it("skips processing", async () => {
      const reactor = createEvaluationAlertTriggerReactor(deps);
      const event = createEvent();
      const context: ReactorContext<EvaluationRunData> = {
        tenantId: "tenant-1",
        aggregateId: "eval-1",
        foldState: createEvalFoldState({ traceId: null }),
      };

      await reactor.handle(event, context);

      expect(deps.triggers.getActiveTraceTriggersForProject).not.toHaveBeenCalled();
    });
  });

  describe("when evaluation is still in progress", () => {
    it("skips processing", async () => {
      const reactor = createEvaluationAlertTriggerReactor(deps);
      const event = createEvent();
      const context: ReactorContext<EvaluationRunData> = {
        tenantId: "tenant-1",
        aggregateId: "eval-1",
        foldState: createEvalFoldState({ status: "in_progress" }),
      };

      await reactor.handle(event, context);

      expect(deps.triggers.getActiveTraceTriggersForProject).not.toHaveBeenCalled();
    });
  });

  describe("when event is old (resyncing)", () => {
    it("skips processing", async () => {
      const reactor = createEvaluationAlertTriggerReactor(deps);
      const event = createEvent({
        occurredAt: Date.now() - 2 * 60 * 60 * 1000,
      });
      const context: ReactorContext<EvaluationRunData> = {
        tenantId: "tenant-1",
        aggregateId: "eval-1",
        foldState: createEvalFoldState(),
      };

      await reactor.handle(event, context);

      expect(deps.triggers.getActiveTraceTriggersForProject).not.toHaveBeenCalled();
    });
  });

  describe("when no triggers have evaluation filters", () => {
    it("skips without querying evaluations", async () => {
      const trigger = createTrigger({
        filters: { "traces.origin": ["application"] },
      });
      (deps.triggers.getActiveTraceTriggersForProject as any).mockResolvedValue([trigger]);

      const reactor = createEvaluationAlertTriggerReactor(deps);
      const event = createEvent();
      const context: ReactorContext<EvaluationRunData> = {
        tenantId: "tenant-1",
        aggregateId: "eval-1",
        foldState: createEvalFoldState(),
      };

      await reactor.handle(event, context);

      expect(deps.traceSummaryStore.get).not.toHaveBeenCalled();
      expect(deps.evaluationRuns.findByTraceId).not.toHaveBeenCalled();
    });
  });

  describe("when trace summary is not found", () => {
    it("skips processing", async () => {
      const trigger = createTrigger();
      (deps.triggers.getActiveTraceTriggersForProject as any).mockResolvedValue([trigger]);
      (deps.traceSummaryStore.get as any).mockResolvedValue(null);

      const reactor = createEvaluationAlertTriggerReactor(deps);
      const event = createEvent();
      const context: ReactorContext<EvaluationRunData> = {
        tenantId: "tenant-1",
        aggregateId: "eval-1",
        foldState: createEvalFoldState(),
      };

      await reactor.handle(event, context);

      expect(deps.triggers.claimSend).not.toHaveBeenCalled();
    });
  });

  describe("when evaluation filters match", () => {
    it("dispatches trigger action and records sent", async () => {
      const trigger = createTrigger({
        filters: {
          "evaluations.passed": { "evaluator-1": ["true"] },
        },
      });
      (deps.triggers.getActiveTraceTriggersForProject as any).mockResolvedValue([trigger]);
      (deps.evaluationRuns.findByTraceId as any).mockResolvedValue([
        createEvalFoldState({ evaluatorId: "evaluator-1", passed: true }),
      ]);

      const reactor = createEvaluationAlertTriggerReactor(deps);
      const event = createEvent();
      const context: ReactorContext<EvaluationRunData> = {
        tenantId: "tenant-1",
        aggregateId: "eval-1",
        foldState: createEvalFoldState(),
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

  describe("when evaluation filters do not match", () => {
    it("does not dispatch action", async () => {
      const trigger = createTrigger({
        filters: {
          "evaluations.passed": { "evaluator-1": ["true"] },
        },
      });
      (deps.triggers.getActiveTraceTriggersForProject as any).mockResolvedValue([trigger]);
      (deps.evaluationRuns.findByTraceId as any).mockResolvedValue([
        createEvalFoldState({ evaluatorId: "evaluator-1", passed: false }),
      ]);

      const reactor = createEvaluationAlertTriggerReactor(deps);
      const event = createEvent();
      const context: ReactorContext<EvaluationRunData> = {
        tenantId: "tenant-1",
        aggregateId: "eval-1",
        foldState: createEvalFoldState(),
      };

      await reactor.handle(event, context);

      expect(deps.triggers.claimSend).not.toHaveBeenCalled();
    });
  });

  describe("when trace filters do not match", () => {
    it("does not dispatch action even if evaluation filters match", async () => {
      const trigger = createTrigger({
        filters: {
          "traces.origin": ["playground"],
          "evaluations.passed": { "evaluator-1": ["true"] },
        },
      });
      (deps.triggers.getActiveTraceTriggersForProject as any).mockResolvedValue([trigger]);
      (deps.evaluationRuns.findByTraceId as any).mockResolvedValue([
        createEvalFoldState({ evaluatorId: "evaluator-1", passed: true }),
      ]);
      // Trace has origin "application", trigger wants "playground"
      (deps.traceSummaryStore.get as any).mockResolvedValue(
        createTraceSummary({
          attributes: { "langwatch.origin": "application" },
        }),
      );

      const reactor = createEvaluationAlertTriggerReactor(deps);
      const event = createEvent();
      const context: ReactorContext<EvaluationRunData> = {
        tenantId: "tenant-1",
        aggregateId: "eval-1",
        foldState: createEvalFoldState(),
      };

      await reactor.handle(event, context);

      expect(deps.triggers.claimSend).not.toHaveBeenCalled();
    });
  });

  describe("when trigger was already sent for this trace", () => {
    it("skips dispatch (dedup)", async () => {
      const trigger = createTrigger();
      (deps.triggers.getActiveTraceTriggersForProject as any).mockResolvedValue([trigger]);
      (deps.triggers.claimSend as any).mockResolvedValue(false);
      (deps.evaluationRuns.findByTraceId as any).mockResolvedValue([
        createEvalFoldState({ evaluatorId: "evaluator-1", passed: true }),
      ]);

      const reactor = createEvaluationAlertTriggerReactor(deps);
      const event = createEvent();
      const context: ReactorContext<EvaluationRunData> = {
        tenantId: "tenant-1",
        aggregateId: "eval-1",
        foldState: createEvalFoldState(),
      };

      await reactor.handle(event, context);

      // claim attempted but lost the race → no dispatch, no lastRunAt update.
      expect(deps.triggers.claimSend).toHaveBeenCalled();
      expect(deps.triggers.updateLastRunAt).not.toHaveBeenCalled();
    });
  });

  describe("when handling reported events", () => {
    it("processes reported events the same as completed", async () => {
      const trigger = createTrigger();
      (deps.triggers.getActiveTraceTriggersForProject as any).mockResolvedValue([trigger]);
      (deps.evaluationRuns.findByTraceId as any).mockResolvedValue([
        createEvalFoldState({ evaluatorId: "evaluator-1", passed: true }),
      ]);

      const reactor = createEvaluationAlertTriggerReactor(deps);
      const event = createEvent({ type: "lw.evaluation.reported" });
      const context: ReactorContext<EvaluationRunData> = {
        tenantId: "tenant-1",
        aggregateId: "eval-1",
        foldState: createEvalFoldState(),
      };

      await reactor.handle(event, context);

      expect(deps.triggers.claimSend).toHaveBeenCalled();
      expect(deps.triggers.updateLastRunAt).toHaveBeenCalled();
    });
  });

  describe("when both trace and evaluation filters match", () => {
    it("dispatches trigger action for mixed filter triggers", async () => {
      const trigger = createTrigger({
        filters: {
          "traces.origin": ["application"],
          "spans.model": ["gpt-5-mini"],
          "evaluations.passed": { "evaluator-1": ["true"] },
        },
      });
      (deps.triggers.getActiveTraceTriggersForProject as any).mockResolvedValue([trigger]);
      (deps.evaluationRuns.findByTraceId as any).mockResolvedValue([
        createEvalFoldState({ evaluatorId: "evaluator-1", passed: true }),
      ]);

      const reactor = createEvaluationAlertTriggerReactor(deps);
      const event = createEvent();
      const context: ReactorContext<EvaluationRunData> = {
        tenantId: "tenant-1",
        aggregateId: "eval-1",
        foldState: createEvalFoldState(),
      };

      await reactor.handle(event, context);

      expect(deps.triggers.claimSend).toHaveBeenCalled();
      expect(deps.triggers.updateLastRunAt).toHaveBeenCalled();
    });
  });
});
