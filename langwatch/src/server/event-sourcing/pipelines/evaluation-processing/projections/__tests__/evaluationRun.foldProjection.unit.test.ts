import { describe, expect, it } from "vitest";
import type { EvaluationRunData } from "~/server/app-layer/evaluations/types";
import type { FoldProjectionStore } from "../../../../projections/foldProjection.types";
import type { EvaluationCompletedEvent, EvaluationStartedEvent } from "../../schemas/events";
import { createEvaluationRunFoldProjection } from "../evaluationRun.foldProjection";

function createStubStore(): FoldProjectionStore<EvaluationRunData> {
  return {
    get: async () => null,
    save: async () => {},
  } as unknown as FoldProjectionStore<EvaluationRunData>;
}

function createInitState(): EvaluationRunData {
  const projection = createEvaluationRunFoldProjection({
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

describe("evaluationRun foldProjection", () => {
  describe("apply()", () => {
    describe("when EvaluationCompletedEvent arrives after EvaluationStartedEvent", () => {
      it("applies completed state normally", () => {
        const projection = createEvaluationRunFoldProjection({
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
      it("throws an error to trigger retry", () => {
        const projection = createEvaluationRunFoldProjection({
          store: createStubStore(),
        });
        const emptyState = createInitState();

        expect(() =>
          projection.apply(emptyState, createCompletedEvent()),
        ).toThrow(
          /Received EvaluationCompletedEvent for evaluation eval-1 but state has no evaluationId/,
        );
      });
    });
  });
});
