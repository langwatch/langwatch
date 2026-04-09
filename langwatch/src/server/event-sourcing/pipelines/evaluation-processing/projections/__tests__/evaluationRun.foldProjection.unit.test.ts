import { describe, expect, it } from "vitest";
import type { EvaluationRunData } from "~/server/app-layer/evaluations/types";
import type { FoldProjectionStore } from "../../../../projections/foldProjection.types";
import type {
  EvaluationCompletedEvent,
  EvaluationReportedEvent,
  EvaluationStartedEvent,
} from "../../schemas/events";
import { EvaluationRunFoldProjection } from "../evaluationRun.foldProjection";

function createStubStore(): FoldProjectionStore<EvaluationRunData> {
  return {
    get: async () => null,
    save: async () => {},
  } as unknown as FoldProjectionStore<EvaluationRunData>;
}

function createInitState(): EvaluationRunData {
  const projection = new EvaluationRunFoldProjection({
    store: createStubStore(),
  });
  return projection.init();
}

function createStartedEvent(
  overrides: Partial<EvaluationStartedEvent> = {},
): EvaluationStartedEvent {
  return {
    id: "evt-1",
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
    id: "evt-2",
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
      label: null,
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
    id: "evt-3",
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
      score: 0.9,
      passed: true,
      label: null,
      details: null,
      error: null,
    },
    ...overrides,
  } as unknown as EvaluationReportedEvent;
}

describe("evaluationRun foldProjection", () => {
  describe("apply()", () => {
    describe("when EvaluationCompletedEvent arrives after EvaluationStartedEvent", () => {
      it("applies completed state normally", () => {
        const projection = new EvaluationRunFoldProjection({
          store: createStubStore(),
        });
        const state = createInitState();
        const afterStarted = projection.apply(state, createStartedEvent());
        const afterCompleted = projection.apply(
          afterStarted,
          createCompletedEvent(),
        );

        expect(afterCompleted.status).toBe("processed");
        expect(afterCompleted.score).toBe(0.9);
        expect(afterCompleted.passed).toBe(true);
      });
    });

    describe("when EvaluationCompletedEvent arrives with empty evaluationId in state", () => {
      it("falls back to evaluationId from the event", () => {
        const projection = new EvaluationRunFoldProjection({
          store: createStubStore(),
        });
        const emptyState = createInitState();

        const result = projection.apply(emptyState, createCompletedEvent());

        expect(result.evaluationId).toBe("eval-1");
      });
    });

    describe("when EvaluationReportedEvent is applied", () => {
      it("sets all fields in one shot", () => {
        const projection = new EvaluationRunFoldProjection({
          store: createStubStore(),
        });
        const state = createInitState();
        const afterReported = projection.apply(state, createReportedEvent());

        expect(afterReported.evaluationId).toBe("eval-1");
        expect(afterReported.evaluatorId).toBe("evaluator-1");
        expect(afterReported.evaluatorType).toBe("custom");
        expect(afterReported.evaluatorName).toBe("toxicity");
        expect(afterReported.traceId).toBe("trace-1");
        expect(afterReported.isGuardrail).toBe(false);
        expect(afterReported.status).toBe("processed");
        expect(afterReported.score).toBe(0.9);
        expect(afterReported.passed).toBe(true);
        expect(afterReported.label).toBeNull();
        expect(afterReported.details).toBeNull();
        expect(afterReported.error).toBeNull();
        expect(afterReported.startedAt).toBe(1700000000000);
        expect(afterReported.completedAt).toBe(1700000000000);
      });

      it("does not require a prior started event", () => {
        const projection = new EvaluationRunFoldProjection({
          store: createStubStore(),
        });
        const emptyState = createInitState();

        expect(() =>
          projection.apply(emptyState, createReportedEvent()),
        ).not.toThrow();
      });

      it("defaults optional fields to null or false", () => {
        const projection = new EvaluationRunFoldProjection({
          store: createStubStore(),
        });
        const state = createInitState();
        const afterReported = projection.apply(
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

        expect(afterReported.evaluatorName).toBeNull();
        expect(afterReported.traceId).toBeNull();
        expect(afterReported.isGuardrail).toBe(false);
        expect(afterReported.score).toBeNull();
        expect(afterReported.passed).toBeNull();
      });

      it("preserves inputs when present", () => {
        const projection = new EvaluationRunFoldProjection({
          store: createStubStore(),
        });
        const state = createInitState();
        const inputs = { input: "hello world", output: "response text" };
        const afterReported = projection.apply(
          state,
          createReportedEvent({
            data: {
              evaluationId: "eval-1",
              evaluatorId: "evaluator-1",
              evaluatorType: "custom",
              evaluatorName: "toxicity",
              traceId: "trace-1",
              isGuardrail: false,
              status: "processed",
              score: 0.9,
              passed: true,
              label: null,
              details: null,
              error: null,
              inputs,
            },
          } as Partial<EvaluationReportedEvent>),
        );

        expect(afterReported.inputs).toEqual(inputs);
      });

      it("defaults inputs to null when not provided", () => {
        const projection = new EvaluationRunFoldProjection({
          store: createStubStore(),
        });
        const state = createInitState();
        const afterReported = projection.apply(state, createReportedEvent());

        expect(afterReported.inputs).toBeNull();
      });
    });

    describe("when EvaluationCompletedEvent has inputs", () => {
      it("preserves inputs in state", () => {
        const projection = new EvaluationRunFoldProjection({
          store: createStubStore(),
        });
        const state = createInitState();
        const afterStarted = projection.apply(state, createStartedEvent());
        const inputs = { input: "test input", contexts: ["ctx1"] };
        const afterCompleted = projection.apply(
          afterStarted,
          createCompletedEvent({
            data: {
              evaluationId: "eval-1",
              status: "processed",
              score: 0.8,
              passed: true,
              label: null,
              details: null,
              error: null,
              errorDetails: null,
              costId: null,
              inputs,
            },
          } as Partial<EvaluationCompletedEvent>),
        );

        expect(afterCompleted.inputs).toEqual(inputs);
      });
    });
  });
});
