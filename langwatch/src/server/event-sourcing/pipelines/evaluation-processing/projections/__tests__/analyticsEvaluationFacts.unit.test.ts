import { describe, expect, it } from "vitest";
import type { AnalyticsEvaluationFactData } from "~/server/app-layer/analytics/types";
import type { FoldProjectionStore } from "../../../../projections/foldProjection.types";
import type {
  EvaluationScheduledEvent,
  EvaluationStartedEvent,
  EvaluationCompletedEvent,
  EvaluationReportedEvent,
} from "../../schemas/events";
import { AnalyticsEvaluationFactsFoldProjection } from "../analyticsEvaluationFacts.foldProjection";

function createStubStore(): FoldProjectionStore<AnalyticsEvaluationFactData> {
  return {
    store: async () => {},
    get: async () => null,
  };
}

function createProjection() {
  return new AnalyticsEvaluationFactsFoldProjection({
    store: createStubStore(),
  });
}

function createInitState(): AnalyticsEvaluationFactData {
  return createProjection().init();
}

function createScheduledEvent(
  overrides: Partial<EvaluationScheduledEvent> = {},
): EvaluationScheduledEvent {
  return {
    id: "evt-1",
    aggregateId: "eval-1",
    aggregateType: "evaluation",
    tenantId: "tenant-1",
    createdAt: Date.now(),
    occurredAt: 1700000000000,
    type: "lw.evaluation.scheduled",
    version: "2025-01-14",
    data: {
      evaluationId: "eval-1",
      evaluatorId: "evaluator-1",
      evaluatorType: "custom",
      evaluatorName: "toxicity",
      traceId: "trace-1",
      isGuardrail: false,
    },
    ...overrides,
  } as unknown as EvaluationScheduledEvent;
}

function createStartedEvent(
  overrides: Partial<EvaluationStartedEvent> = {},
): EvaluationStartedEvent {
  return {
    id: "evt-2",
    aggregateId: "eval-1",
    aggregateType: "evaluation",
    tenantId: "tenant-1",
    createdAt: Date.now(),
    occurredAt: Date.now(),
    type: "lw.evaluation.started",
    version: "2025-01-14",
    data: {
      evaluationId: "eval-1",
      evaluatorId: "evaluator-1",
      evaluatorType: "custom",
      evaluatorName: "toxicity",
      traceId: "trace-1",
      isGuardrail: false,
    },
    ...overrides,
  } as unknown as EvaluationStartedEvent;
}

function createCompletedEvent(
  overrides: Partial<EvaluationCompletedEvent> = {},
): EvaluationCompletedEvent {
  return {
    id: "evt-3",
    aggregateId: "eval-1",
    aggregateType: "evaluation",
    tenantId: "tenant-1",
    createdAt: Date.now(),
    occurredAt: Date.now(),
    type: "lw.evaluation.completed",
    version: "2025-01-14",
    data: {
      evaluationId: "eval-1",
      status: "processed",
      score: 0.9,
      passed: true,
      label: "positive",
      details: null,
      error: null,
      errorDetails: null,
      costId: null,
    },
    ...overrides,
  } as unknown as EvaluationCompletedEvent;
}

function createReportedEvent(
  overrides: Partial<EvaluationReportedEvent> = {},
): EvaluationReportedEvent {
  return {
    id: "evt-4",
    aggregateId: "eval-1",
    aggregateType: "evaluation",
    tenantId: "tenant-1",
    createdAt: Date.now(),
    occurredAt: 1700000000000,
    type: "lw.evaluation.reported",
    version: "2025-01-14",
    data: {
      evaluationId: "eval-1",
      evaluatorId: "evaluator-1",
      evaluatorType: "custom",
      evaluatorName: "toxicity",
      traceId: "trace-1",
      isGuardrail: false,
      status: "processed",
      score: 0.85,
      passed: true,
      label: "safe",
      details: null,
      error: null,
    },
    ...overrides,
  } as unknown as EvaluationReportedEvent;
}

describe("analyticsEvaluationFacts foldProjection", () => {
  describe("init()", () => {
    it("returns initial state with timestamps and empty defaults", () => {
      const state = createInitState();

      expect(state.evaluationId).toBe("");
      expect(state.traceId).toBeNull();
      expect(state.occurredAt).toBe(0);
      expect(state.evaluatorId).toBe("");
      expect(state.evaluatorName).toBeNull();
      expect(state.evaluatorType).toBe("");
      expect(state.isGuardrail).toBe(false);
      expect(state.score).toBeNull();
      expect(state.passed).toBeNull();
      expect(state.label).toBeNull();
      expect(state.status).toBe("scheduled");
      expect(state.userId).toBeNull();
      expect(state.threadId).toBeNull();
      expect(state.topicId).toBeNull();
      expect(state.customerId).toBeNull();
      expect(state.createdAt).toBeGreaterThan(0);
      expect(state.updatedAt).toBeGreaterThan(0);
    });
  });

  describe("apply()", () => {
    describe("when EvaluationScheduledEvent arrives", () => {
      it("sets evaluator identity and status to scheduled", () => {
        const projection = createProjection();
        const state = createInitState();

        const result = projection.apply(state, createScheduledEvent());

        expect(result.evaluationId).toBe("eval-1");
        expect(result.evaluatorId).toBe("evaluator-1");
        expect(result.evaluatorType).toBe("custom");
        expect(result.evaluatorName).toBe("toxicity");
        expect(result.traceId).toBe("trace-1");
        expect(result.isGuardrail).toBe(false);
        expect(result.status).toBe("scheduled");
        expect(result.occurredAt).toBe(1700000000000);
      });

      it("defaults optional fields when not provided", () => {
        const projection = createProjection();
        const state = createInitState();

        const result = projection.apply(
          state,
          createScheduledEvent({
            data: {
              evaluationId: "eval-2",
              evaluatorId: "evaluator-2",
              evaluatorType: "llm",
            },
          } as Partial<EvaluationScheduledEvent>),
        );

        expect(result.evaluatorName).toBeNull();
        expect(result.traceId).toBeNull();
        expect(result.isGuardrail).toBe(false);
      });
    });

    describe("when EvaluationStartedEvent arrives after scheduled", () => {
      it("updates status to in_progress, preserving identity from scheduled", () => {
        const projection = createProjection();
        let state = createInitState();

        state = projection.apply(state, createScheduledEvent());
        state = projection.apply(state, createStartedEvent());

        expect(state.status).toBe("in_progress");
        expect(state.evaluationId).toBe("eval-1");
        expect(state.evaluatorId).toBe("evaluator-1");
      });
    });

    describe("when EvaluationCompletedEvent arrives after started", () => {
      it("sets results and status from completed event", () => {
        const projection = createProjection();
        let state = createInitState();

        state = projection.apply(state, createScheduledEvent());
        state = projection.apply(state, createStartedEvent());
        state = projection.apply(state, createCompletedEvent());

        expect(state.status).toBe("processed");
        expect(state.score).toBe(0.9);
        expect(state.passed).toBe(true);
        expect(state.label).toBe("positive");
      });
    });

    describe("when EvaluationCompletedEvent has error status", () => {
      it("sets status to error", () => {
        const projection = createProjection();
        let state = createInitState();

        state = projection.apply(state, createScheduledEvent());
        state = projection.apply(state, createStartedEvent());
        state = projection.apply(
          state,
          createCompletedEvent({
            data: {
              evaluationId: "eval-1",
              status: "error",
              score: null,
              passed: null,
              label: null,
              details: null,
              error: "timeout",
              errorDetails: "evaluation timed out",
              costId: null,
            },
          } as Partial<EvaluationCompletedEvent>),
        );

        expect(state.status).toBe("error");
        expect(state.score).toBeNull();
        expect(state.passed).toBeNull();
      });
    });

    describe("when EvaluationReportedEvent is applied (SDK path)", () => {
      it("sets all fields atomically in one shot", () => {
        const projection = createProjection();
        const state = createInitState();

        const result = projection.apply(state, createReportedEvent());

        expect(result.evaluationId).toBe("eval-1");
        expect(result.evaluatorId).toBe("evaluator-1");
        expect(result.evaluatorType).toBe("custom");
        expect(result.evaluatorName).toBe("toxicity");
        expect(result.traceId).toBe("trace-1");
        expect(result.isGuardrail).toBe(false);
        expect(result.status).toBe("processed");
        expect(result.score).toBe(0.85);
        expect(result.passed).toBe(true);
        expect(result.label).toBe("safe");
        expect(result.occurredAt).toBe(1700000000000);
      });

      it("does not require prior scheduled/started events", () => {
        const projection = createProjection();
        const emptyState = createInitState();

        expect(() =>
          projection.apply(emptyState, createReportedEvent()),
        ).not.toThrow();
      });

      it("defaults optional fields to null or false", () => {
        const projection = createProjection();
        const state = createInitState();

        const result = projection.apply(
          state,
          createReportedEvent({
            data: {
              evaluationId: "eval-1",
              evaluatorId: "evaluator-1",
              evaluatorType: "custom",
              status: "processed",
            },
          } as Partial<EvaluationReportedEvent>),
        );

        expect(result.evaluatorName).toBeNull();
        expect(result.traceId).toBeNull();
        expect(result.isGuardrail).toBe(false);
        expect(result.score).toBeNull();
        expect(result.passed).toBeNull();
        expect(result.label).toBeNull();
      });
    });

    describe("when isGuardrail is true", () => {
      it("sets isGuardrail from scheduled event", () => {
        const projection = createProjection();
        const state = createInitState();

        const result = projection.apply(
          state,
          createScheduledEvent({
            data: {
              evaluationId: "eval-1",
              evaluatorId: "evaluator-1",
              evaluatorType: "guardrail",
              isGuardrail: true,
            },
          } as Partial<EvaluationScheduledEvent>),
        );

        expect(result.isGuardrail).toBe(true);
      });
    });
  });

  describe("projection metadata", () => {
    it("has correct name, version, and event count", () => {
      const projection = createProjection();

      expect(projection.name).toBe("analyticsEvaluationFacts");
      expect(projection.version).toBe("2026-04-01");
      expect(projection.eventTypes).toHaveLength(4);
    });
  });

  describe("full lifecycle", () => {
    describe("when scheduled -> started -> completed", () => {
      it("tracks the full evaluation lifecycle", () => {
        const projection = createProjection();
        let state = createInitState();

        state = projection.apply(state, createScheduledEvent());
        expect(state.status).toBe("scheduled");

        state = projection.apply(state, createStartedEvent());
        expect(state.status).toBe("in_progress");

        state = projection.apply(state, createCompletedEvent());
        expect(state.status).toBe("processed");
        expect(state.score).toBe(0.9);
        expect(state.passed).toBe(true);
        expect(state.evaluationId).toBe("eval-1");
        expect(state.evaluatorId).toBe("evaluator-1");
        expect(state.traceId).toBe("trace-1");
      });
    });
  });
});
