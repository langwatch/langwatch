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
  // Default to ADD_TO_DATASET (persist-class) so these tests exercise
  // the persist branch this reactor now owns. NOTIFY-class actions
  // (SEND_EMAIL / SEND_SLACK_MESSAGE) flow through the
  // evaluationAlertTriggerNotifyOutbox reactor.
  return {
    id: "trigger-1",
    projectId: "tenant-1",
    name: "Quality Alert",
    action: TriggerAction.ADD_TO_DATASET,
    actionParams: {
      datasetId: "dataset-1",
      datasetMapping: { mapping: {}, expansions: [] },
    },
    filters: {
      "evaluations.passed": { "evaluator-1": ["true"] },
    },
    alertType: "WARNING",
    message: "Evaluation passed",
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

function createContext(
  foldState: EvaluationRunData = createEvalFoldState(),
): ReactorContext<EvaluationRunData> {
  return { tenantId: "tenant-1", aggregateId: "eval-1", foldState };
}

function createDeps(
  overrides: Partial<EvaluationAlertTriggerReactorDeps> = {},
): EvaluationAlertTriggerReactorDeps {
  return {
    triggers: {
      getActiveTraceTriggersForProject: vi.fn().mockResolvedValue([]),
    } as any,
    traceSummaryStore: {
      get: vi.fn().mockResolvedValue(createTraceSummary()),
      store: vi.fn(),
    },
    ...overrides,
  };
}

describe("evaluationAlertTrigger reactor (persist outbox)", () => {
  let deps: EvaluationAlertTriggerReactorDeps;

  beforeEach(() => {
    deps = createDeps();
    vi.clearAllMocks();
  });

  describe("when event is not a terminal evaluation event", () => {
    it("emits nothing and never fetches triggers", async () => {
      const reactor = createEvaluationAlertTriggerReactor(deps);
      const requests = await reactor.decide(
        createEvent({ type: "lw.evaluation.scheduled" }),
        createContext(),
      );

      expect(requests).toHaveLength(0);
      expect(
        deps.triggers.getActiveTraceTriggersForProject,
      ).not.toHaveBeenCalled();
    });
  });

  describe("when evaluation has no traceId", () => {
    it("emits nothing", async () => {
      const reactor = createEvaluationAlertTriggerReactor(deps);
      const requests = await reactor.decide(
        createEvent(),
        createContext(createEvalFoldState({ traceId: null })),
      );

      expect(requests).toHaveLength(0);
      expect(
        deps.triggers.getActiveTraceTriggersForProject,
      ).not.toHaveBeenCalled();
    });
  });

  describe("when evaluation is still in progress", () => {
    it("emits nothing", async () => {
      const reactor = createEvaluationAlertTriggerReactor(deps);
      const requests = await reactor.decide(
        createEvent(),
        createContext(createEvalFoldState({ status: "in_progress" })),
      );

      expect(requests).toHaveLength(0);
      expect(
        deps.triggers.getActiveTraceTriggersForProject,
      ).not.toHaveBeenCalled();
    });
  });

  describe("when event is old (resyncing)", () => {
    it("emits nothing", async () => {
      const reactor = createEvaluationAlertTriggerReactor(deps);
      const requests = await reactor.decide(
        createEvent({ occurredAt: Date.now() - 2 * 60 * 60 * 1000 }),
        createContext(),
      );

      expect(requests).toHaveLength(0);
      expect(
        deps.triggers.getActiveTraceTriggersForProject,
      ).not.toHaveBeenCalled();
    });
  });

  describe("when no triggers have evaluation filters", () => {
    it("emits nothing without reading the trace fold", async () => {
      const trigger = createTrigger({
        filters: { "traces.origin": ["application"] },
      });
      (deps.triggers.getActiveTraceTriggersForProject as any).mockResolvedValue(
        [trigger],
      );

      const reactor = createEvaluationAlertTriggerReactor(deps);
      const requests = await reactor.decide(createEvent(), createContext());

      expect(requests).toHaveLength(0);
      expect(deps.traceSummaryStore.get).not.toHaveBeenCalled();
    });
  });

  describe("when the only eval-filter triggers are notify-class", () => {
    it("emits nothing (the notify outbox reactor owns them)", async () => {
      const trigger = createTrigger({
        action: TriggerAction.SEND_EMAIL,
        actionParams: { members: ["ops@example.com"] },
      });
      (deps.triggers.getActiveTraceTriggersForProject as any).mockResolvedValue(
        [trigger],
      );

      const reactor = createEvaluationAlertTriggerReactor(deps);
      const requests = await reactor.decide(createEvent(), createContext());

      expect(requests).toHaveLength(0);
      // Pre-filter short-circuits before the cross-pipeline fold read.
      expect(deps.traceSummaryStore.get).not.toHaveBeenCalled();
    });
  });

  describe("when trace summary is not found", () => {
    it("emits nothing", async () => {
      const trigger = createTrigger();
      (deps.triggers.getActiveTraceTriggersForProject as any).mockResolvedValue(
        [trigger],
      );
      (deps.traceSummaryStore.get as any).mockResolvedValue(null);

      const reactor = createEvaluationAlertTriggerReactor(deps);
      const requests = await reactor.decide(createEvent(), createContext());

      expect(requests).toHaveLength(0);
    });
  });

  describe("given an active persist-class eval-filter trigger", () => {
    describe("when the reactor decides on a completed event", () => {
      it("emits a settle request stamped actionClass=persist with the debounce TTL and fold breadcrumb", async () => {
        const trigger = createTrigger({ traceDebounceMs: 45_000 });
        (
          deps.triggers.getActiveTraceTriggersForProject as any
        ).mockResolvedValue([trigger]);

        const reactor = createEvaluationAlertTriggerReactor(deps);
        const requests = await reactor.decide(createEvent(), createContext());

        expect(requests).toHaveLength(1);
        const [request] = requests;
        expect(request!.dedupKey).toBe("tenant-1/trigger-1:trace:trace-1");
        expect(request!.groupKey).toBe("tenant-1/triggerNotify:trigger-1");
        expect(request!.enqueueOptions).toEqual({ ttlMs: 45_000 });
        const payload = request!.payload as unknown as {
          stage: string;
          actionClass: string;
          traceId: string;
          foldSnapshotAtEnqueue: {
            computedInput: string;
            computedOutput: string;
          };
        };
        expect(payload.stage).toBe("settle");
        expect(payload.actionClass).toBe("persist");
        expect(payload.traceId).toBe("trace-1");
        expect(payload.foldSnapshotAtEnqueue).toEqual({
          computedInput: "test input",
          computedOutput: "test output",
        });
      });
    });

    describe("when the reactor decides on a reported event", () => {
      it("emits a settle request the same as for a completed event", async () => {
        const trigger = createTrigger();
        (
          deps.triggers.getActiveTraceTriggersForProject as any
        ).mockResolvedValue([trigger]);

        const reactor = createEvaluationAlertTriggerReactor(deps);
        const requests = await reactor.decide(
          createEvent({ type: "lw.evaluation.reported" }),
          createContext(),
        );

        expect(requests).toHaveLength(1);
        expect(
          (requests[0]!.payload as unknown as { actionClass: string })
            .actionClass,
        ).toBe("persist");
      });
    });

    describe("when the reactor decides", () => {
      it("does not load evaluations or derive events itself (the settle stage re-reads + filters)", async () => {
        const trigger = createTrigger({
          filters: {
            "events.event_type": ["thumbs_up_down"],
            "evaluations.passed": { "evaluator-1": ["true"] },
          },
        });
        (
          deps.triggers.getActiveTraceTriggersForProject as any
        ).mockResolvedValue([trigger]);

        const reactor = createEvaluationAlertTriggerReactor(deps);
        const requests = await reactor.decide(createEvent(), createContext());

        // The reactor only enqueues; the settle dispatcher loads
        // evaluations + derives events against the settled state. The
        // reactor's only cross-pipeline read is the fold breadcrumb.
        expect(requests).toHaveLength(1);
        expect(deps.traceSummaryStore.get).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("given several persist eval-filter triggers on the same trace", () => {
    it("emits one settle request per trigger", async () => {
      const a = createTrigger({ id: "trig-a", traceDebounceMs: 30_000 });
      const b = createTrigger({ id: "trig-b", traceDebounceMs: 60_000 });
      (deps.triggers.getActiveTraceTriggersForProject as any).mockResolvedValue(
        [a, b],
      );

      const reactor = createEvaluationAlertTriggerReactor(deps);
      const requests = await reactor.decide(createEvent(), createContext());

      expect(requests).toHaveLength(2);
      expect(requests.map((r) => r.enqueueOptions?.ttlMs)).toEqual([
        30_000, 60_000,
      ]);
    });
  });
});
