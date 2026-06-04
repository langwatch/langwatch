import { TriggerAction } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvaluationRunData } from "~/server/app-layer/evaluations/types";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { TriggerSummary } from "~/server/app-layer/triggers/repositories/trigger.repository";
import type { ReactorContext } from "../../../../reactors/reactor.types";
import type { EvaluationProcessingEvent } from "../../schemas/events";
import {
  createEvaluationAlertTriggerNotifyOutboxReactor,
  type EvaluationAlertTriggerNotifyOutboxReactorDeps,
} from "../evaluationAlertTriggerNotifyOutbox.reactor";

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
    passed: true,
    score: 0.95,
    label: null,
    details: null,
    error: null,
    cost: null,
    duration: null,
    startedAt: Date.now(),
    finishedAt: Date.now(),
    timestamps: { inserted_at: Date.now() },
    ...overrides,
  } as EvaluationRunData;
}

function createTraceSummary(
  overrides: Partial<TraceSummaryData> = {},
): TraceSummaryData {
  return {
    aggregateId: "trace-1",
    tenantId: "tenant-1",
    occurredAt: Date.now(),
    spanCount: 1,
    computedInput: "the input",
    computedOutput: "the output",
    attributes: { "langwatch.origin": "playground" },
    ...overrides,
  } as TraceSummaryData;
}

function createTrigger(
  overrides: Partial<TriggerSummary> = {},
): TriggerSummary {
  return {
    id: "trigger-eval-notify",
    projectId: "tenant-1",
    name: "Quality Alert",
    action: TriggerAction.SEND_EMAIL,
    actionParams: { members: ["user@example.com"] },
    filters: {
      "evaluations.passed": { "evaluator-1": ["true"] },
    },
    alertType: "WARNING",
    message: "",
    customGraphId: null,
    notificationCadence: "immediate",
    traceDebounceMs: 25_000,
    ...overrides,
  };
}

function createEvent(
  overrides: Partial<EvaluationProcessingEvent> = {},
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

function createDeps(
  overrides: Partial<EvaluationAlertTriggerNotifyOutboxReactorDeps> = {},
): EvaluationAlertTriggerNotifyOutboxReactorDeps {
  return {
    triggers: {
      getActiveTraceTriggersForProject: vi.fn().mockResolvedValue([]),
    } as any,
    traceSummaryStore: {
      get: vi.fn().mockResolvedValue(createTraceSummary()),
      store: vi.fn(),
    } as any,
    ...overrides,
  };
}

describe("evaluationAlertTriggerNotifyOutbox reactor", () => {
  let deps: EvaluationAlertTriggerNotifyOutboxReactorDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createDeps();
  });

  describe("when a NOTIFY-class trigger with evaluation filters matches", () => {
    it("emits a settle-stage OutboxEnqueueRequest", async () => {
      const trigger = createTrigger();
      (deps.triggers.getActiveTraceTriggersForProject as any).mockResolvedValue(
        [trigger],
      );

      const reactor = createEvaluationAlertTriggerNotifyOutboxReactor(deps);
      const context: ReactorContext<EvaluationRunData> = {
        tenantId: "tenant-1",
        aggregateId: "eval-1",
        foldState: createEvalFoldState(),
      };

      const requests = await reactor.decide(createEvent(), context);

      expect(requests).toHaveLength(1);
      const [request] = requests;
      expect(request!.dedupKey).toBe(
        "tenant-1/trigger-eval-notify:trace:trace-1",
      );
      expect(request!.groupKey).toBe(
        "tenant-1/triggerNotify:trigger-eval-notify",
      );
      expect(request!.enqueueOptions).toEqual({ ttlMs: 25_000 });
      const payload = request!.payload as unknown as { stage: string; foldSnapshotAtEnqueue: { computedInput: string } };
      expect(payload.stage).toBe("settle");
      expect(payload.foldSnapshotAtEnqueue.computedInput).toBe("the input");
    });
  });

  describe("when no triggers have evaluation filters", () => {
    it("emits no requests", async () => {
      const trigger = createTrigger({
        filters: { "traces.origin": ["playground"] },
      });
      (deps.triggers.getActiveTraceTriggersForProject as any).mockResolvedValue(
        [trigger],
      );

      const reactor = createEvaluationAlertTriggerNotifyOutboxReactor(deps);
      const context: ReactorContext<EvaluationRunData> = {
        tenantId: "tenant-1",
        aggregateId: "eval-1",
        foldState: createEvalFoldState(),
      };

      const requests = await reactor.decide(createEvent(), context);
      expect(requests).toHaveLength(0);
    });
  });

  describe("when an evaluation-filter trigger is persist-class", () => {
    it("does not emit a request — persist actions stay on the inline reactor", async () => {
      const trigger = createTrigger({
        action: TriggerAction.ADD_TO_DATASET,
      });
      (deps.triggers.getActiveTraceTriggersForProject as any).mockResolvedValue(
        [trigger],
      );

      const reactor = createEvaluationAlertTriggerNotifyOutboxReactor(deps);
      const context: ReactorContext<EvaluationRunData> = {
        tenantId: "tenant-1",
        aggregateId: "eval-1",
        foldState: createEvalFoldState(),
      };

      const requests = await reactor.decide(createEvent(), context);
      expect(requests).toHaveLength(0);
    });
  });

  describe("when the trace fold is gone", () => {
    it("emits no request — settle would have nothing to debounce on", async () => {
      const trigger = createTrigger();
      (deps.triggers.getActiveTraceTriggersForProject as any).mockResolvedValue(
        [trigger],
      );
      (deps.traceSummaryStore.get as any).mockResolvedValue(null);

      const reactor = createEvaluationAlertTriggerNotifyOutboxReactor(deps);
      const context: ReactorContext<EvaluationRunData> = {
        tenantId: "tenant-1",
        aggregateId: "eval-1",
        foldState: createEvalFoldState(),
      };

      const requests = await reactor.decide(createEvent(), context);
      expect(requests).toHaveLength(0);
    });
  });

  describe("when the event is not a terminal evaluation event", () => {
    it("emits no requests", async () => {
      const trigger = createTrigger();
      (deps.triggers.getActiveTraceTriggersForProject as any).mockResolvedValue(
        [trigger],
      );

      const reactor = createEvaluationAlertTriggerNotifyOutboxReactor(deps);
      const context: ReactorContext<EvaluationRunData> = {
        tenantId: "tenant-1",
        aggregateId: "eval-1",
        foldState: createEvalFoldState(),
      };

      const requests = await reactor.decide(
        createEvent({ type: "lw.evaluation.started" as any }),
        context,
      );
      expect(requests).toHaveLength(0);
    });
  });

  describe("when the evaluation is still in-progress", () => {
    it("emits no requests — the fold may be half-formed", async () => {
      const trigger = createTrigger();
      (deps.triggers.getActiveTraceTriggersForProject as any).mockResolvedValue(
        [trigger],
      );

      const reactor = createEvaluationAlertTriggerNotifyOutboxReactor(deps);
      const context: ReactorContext<EvaluationRunData> = {
        tenantId: "tenant-1",
        aggregateId: "eval-1",
        foldState: createEvalFoldState({ status: "in_progress" }),
      };

      const requests = await reactor.decide(createEvent(), context);
      expect(requests).toHaveLength(0);
    });
  });

  describe("when the evaluation has no traceId", () => {
    it("emits no requests — every settle payload is keyed on traceId", async () => {
      const trigger = createTrigger();
      (deps.triggers.getActiveTraceTriggersForProject as any).mockResolvedValue(
        [trigger],
      );

      const reactor = createEvaluationAlertTriggerNotifyOutboxReactor(deps);
      const context: ReactorContext<EvaluationRunData> = {
        tenantId: "tenant-1",
        aggregateId: "eval-1",
        foldState: createEvalFoldState({ traceId: null as any }),
      };

      const requests = await reactor.decide(createEvent(), context);
      expect(requests).toHaveLength(0);
    });
  });
});
