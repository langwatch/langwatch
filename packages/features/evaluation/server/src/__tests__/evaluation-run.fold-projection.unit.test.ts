import type { FoldProjectionStore } from "@langwatch/eventing";
import { createTenantId, FoldProjectionExecutor } from "@langwatch/eventing";
import { describe, expect, it, vi } from "vitest";
import type { EvaluationRunData } from "@langwatch/evaluation-contract";
import type {
  EvaluationCompletedEvent,
  EvaluationReportedEvent,
  EvaluationStartedEvent,
} from "@langwatch/evaluation-contract";
import {
  evaluationCompletedEventSchema,
  evaluationReportedEventSchema,
  evaluationStartedEventSchema,
} from "@langwatch/evaluation-contract";
import { EvaluationRunFoldProjection } from "@langwatch/evaluation-server/internal";

function createStubStore(): FoldProjectionStore<EvaluationRunData> {
  return {
    get: async () => null,
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

describe("evaluationRun foldProjection", () => {
  describe("apply()", () => {
    describe("when EvaluationCompletedEvent arrives after EvaluationStartedEvent", () => {
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

  describe("canonical accepted ordering", () => {
    it("applies a coalesced lifecycle batch by createdAt and event id, not occurredAt", async () => {
      let persisted: EvaluationRunData | null = null;
      const store: FoldProjectionStore<EvaluationRunData> = {
        get: async () => null,
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
          get: async () => null,
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
          get: async () => stored,
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
});
