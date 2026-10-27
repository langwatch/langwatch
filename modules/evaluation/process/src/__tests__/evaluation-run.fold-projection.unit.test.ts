import type {
  EvaluationAttemptFailedEvent,
  EvaluationRunData,
  EvaluationCompletedEvent,
  EvaluationReportedEvent,
  EvaluationStartedEvent,
} from "@langwatch/evaluation-contract";
import {
  evaluationAttemptFailedEventSchema,
  evaluationCompletedEventSchema,
  evaluationReportedEventSchema,
  evaluationStartedEventSchema,
} from "@langwatch/evaluation-contract";
import type { FoldProjectionStore } from "@langwatch/eventing";
import { createTenantId, FoldProjectionExecutor } from "@langwatch/eventing";
import { describe, expect, it, vi } from "vitest";

import { EvaluationRunFoldProjection } from "../eventing/evaluation-run.projection.ts";

function createStubStore(): FoldProjectionStore<EvaluationRunData> {
  return {
    get: async () => ({ kind: "empty" as const }),
    store: async () => {},
  };
}

function createInitState(): EvaluationRunData {
  const projection = EvaluationRunFoldProjection.create({
    store: createStubStore(),
  });
  return projection.init();
}

type EventOverrides<Event extends { data: object }> = Omit<Partial<Event>, "data"> & {
  data?: Partial<Event["data"]>;
};

function createStartedEvent(
  overrides: EventOverrides<EvaluationStartedEvent> = {},
): EvaluationStartedEvent {
  const { data, ...eventOverrides } = overrides;
  return evaluationStartedEventSchema.parse({
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
      ...data,
    },
    ...eventOverrides,
  });
}

function createCompletedEvent(
  overrides: EventOverrides<EvaluationCompletedEvent> = {},
): EvaluationCompletedEvent {
  const { data, ...eventOverrides } = overrides;
  return evaluationCompletedEventSchema.parse({
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
      ...data,
    },
    ...eventOverrides,
  });
}

function createReportedEvent(
  overrides: EventOverrides<EvaluationReportedEvent> = {},
): EvaluationReportedEvent {
  const { data, ...eventOverrides } = overrides;
  return evaluationReportedEventSchema.parse({
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
      ...data,
    },
    ...eventOverrides,
  });
}

function createAttemptFailedEvent({
  id,
  attempt,
  occurredAt,
  nextAttemptAt,
}: {
  id: string;
  attempt: number;
  occurredAt: number;
  nextAttemptAt: number;
}): EvaluationAttemptFailedEvent {
  return evaluationAttemptFailedEventSchema.parse({
    id,
    aggregateId: "eval-1",
    aggregateType: "evaluation",
    tenantId: "tenant-1",
    createdAt: occurredAt,
    occurredAt,
    type: "lw.evaluation.attempt_failed",
    version: "2026-10-19",
    data: {
      evaluationId: "eval-1",
      evaluatorId: "evaluator-1",
      evaluatorType: "custom",
      evaluatorName: "toxicity",
      traceId: "trace-1",
      isGuardrail: false,
      attempt,
      error: "Evaluator cannot be reached",
      nextAttemptAt,
    },
  });
}

describe("evaluationRun foldProjection", () => {
  describe("apply()", () => {
    describe("when EvaluationCompletedEvent arrives after EvaluationStartedEvent", () => {
      /** @scenario "A completion folded after a start applies the run's completed state normally" */
      it("applies completed state normally", () => {
        const projection = new EvaluationRunFoldProjection({
          store: createStubStore(),
        });
        const state = createInitState();
        const afterStarted = projection.apply(state, createStartedEvent());
        const afterCompleted = projection.apply(afterStarted, createCompletedEvent());

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

        expect(() => projection.apply(emptyState, createReportedEvent())).not.toThrow();
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
              evaluatorName: undefined,
              traceId: undefined,
              isGuardrail: undefined,
              status: "processed",
              score: undefined,
              passed: undefined,
              label: undefined,
              details: undefined,
              error: undefined,
              errorDetails: undefined,
              costId: undefined,
            },
          }),
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
          }),
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
          }),
        );

        expect(afterCompleted.inputs).toEqual(inputs);
      });
    });
  });

  describe("given a coalesced batch out of canonical order", () => {
    it("applies a coalesced lifecycle batch by createdAt and event id, not occurredAt", async () => {
      let persisted: EvaluationRunData | null = null;
      const store: FoldProjectionStore<EvaluationRunData> = {
        get: async () => ({ kind: "empty" as const }),
        store: async (state) => {
          persisted = state;
        },
      };
      const projection = new EvaluationRunFoldProjection({ store });

      const started = createStartedEvent({
        id: "evt-a",
        createdAt: 1_000,
        occurredAt: 2_000,
      });
      const completed = createCompletedEvent({
        id: "evt-b",
        createdAt: 2_000,
        occurredAt: 1_000,
      });

      const state = await new FoldProjectionExecutor().executeBatch(
        projection,
        [completed, started],
        { aggregateId: "eval-1", tenantId: createTenantId("tenant-1") },
      );

      expect(state.status).toBe("processed");
      expect(persisted).toEqual(state);
      expect(state.startedAt).toBe(2_000);
      expect(state.completedAt).toBe(1_000);
    });

    it("uses event id as the canonical tiebreaker when accepted timestamps match", async () => {
      const projection = new EvaluationRunFoldProjection({
        store: {
          get: async () => ({ kind: "empty" as const }),
          store: async () => {},
        },
      });
      const started = createStartedEvent({
        id: "evt-a",
        createdAt: 1_000,
        occurredAt: 2_000,
      });
      const completed = createCompletedEvent({
        id: "evt-b",
        createdAt: 1_000,
        occurredAt: 1_000,
      });

      const state = await new FoldProjectionExecutor().executeBatch(
        projection,
        [completed, started],
        { aggregateId: "eval-1", tenantId: createTenantId("tenant-1") },
      );

      expect(state.status).toBe("processed");
    });

    describe("given a later-accepted event has an older business timestamp", () => {
      it("does not re-fold it into occurredAt order", async () => {
        const CHECKPOINT_MS = 9_000;
        const stored: EvaluationRunData = {
          ...createInitState(),
          LastEventOccurredAt: CHECKPOINT_MS,
        };
        const store: FoldProjectionStore<EvaluationRunData> = {
          get: async () => ({ kind: "folded" as const, state: stored }),
          store: async () => {},
        };

        const projection = new EvaluationRunFoldProjection({ store });
        const eventLoader = vi.fn().mockResolvedValue([]);
        projection.eventLoader = eventLoader;

        const state = await new FoldProjectionExecutor().execute(
          projection,
          createStartedEvent({
            id: "evt-later-accepted",
            createdAt: 10_000,
            occurredAt: 1_000,
          }),
          { aggregateId: "eval-1", tenantId: createTenantId("tenant-1") },
        );

        expect(eventLoader).not.toHaveBeenCalled();
        expect(state.status).toBe("in_progress");
      });
    });
  });

  describe("given the evaluator service was not up for two attempts", () => {
    const projection = EvaluationRunFoldProjection.create({ store: createStubStore() });
    const afterFirst = projection.apply(
      createInitState(),
      createAttemptFailedEvent({
        id: "evt-a1",
        attempt: 1,
        occurredAt: 1_700_000_010_000,
        nextAttemptAt: 1_700_000_015_000,
      }),
    );
    const afterSecond = projection.apply(
      afterFirst,
      createAttemptFailedEvent({
        id: "evt-a2",
        attempt: 2,
        occurredAt: 1_700_000_015_000,
        nextAttemptAt: 1_700_000_025_000,
      }),
    );

    describe("when the second attempt has been folded", () => {
      /** @scenario "A retrying evaluation shows as in progress" */
      it("shows the run in progress with its last attempt and next try", () => {
        expect(afterSecond).toMatchObject({
          evaluationId: "eval-1",
          traceId: "trace-1",
          status: "in_progress",
          attempts: 2,
          lastAttemptAt: 1_700_000_015_000,
          lastAttemptError: "Evaluator cannot be reached",
          nextAttemptAt: 1_700_000_025_000,
          startedAt: 1_700_000_010_000,
        });
      });
    });

    describe("when the run is then reported as an error", () => {
      /** @scenario "A run that ends after failed attempts keeps how many attempts failed" */
      it("keeps its attempts and last attempt, with no next try", () => {
        const ended = projection.apply(
          afterSecond,
          createReportedEvent({
            data: { status: "error", error: "Evaluator cannot be reached", score: null },
          }),
        );

        expect(ended).toMatchObject({
          status: "error",
          attempts: 2,
          lastAttemptAt: 1_700_000_015_000,
          lastAttemptError: "Evaluator cannot be reached",
          nextAttemptAt: null,
        });
      });

      /** @scenario "A run that ends after failed attempts keeps how many attempts failed" */
      it("is not reopened by an attempt event folded after it", () => {
        const ended = projection.apply(afterSecond, createReportedEvent());
        const late = projection.apply(
          ended,
          createAttemptFailedEvent({
            id: "evt-a3",
            attempt: 3,
            occurredAt: 1_700_000_030_000,
            nextAttemptAt: 1_700_000_050_000,
          }),
        );

        expect(late).toMatchObject({
          status: ended.status,
          attempts: 2,
          lastAttemptAt: 1_700_000_015_000,
          nextAttemptAt: null,
        });
      });
    });
  });
});
