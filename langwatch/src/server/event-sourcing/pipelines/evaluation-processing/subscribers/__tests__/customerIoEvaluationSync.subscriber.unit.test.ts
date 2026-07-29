import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EvaluationRunData } from "~/server/app-layer/evaluations/types";
import type { FoldProjectionStore } from "~/server/event-sourcing/projections/foldProjection.types";
import type { EventSubscriberContext } from "~/server/event-sourcing/subscribers/eventSubscriber.types";
import {
  createMockNurturing,
  createMockProjectService,
} from "../../../shared/__tests__/support/nurtureFixtures";
import { CIO_SYNC_DEBOUNCE_TTL_MS } from "../../../shared/nurtureSync";
import type { EvaluationProcessingEvent } from "../../schemas/events";
import {
  type CustomerIoEvaluationSyncSubscriberDeps,
  createCustomerIoEvaluationSyncSubscriber,
} from "../customerIoEvaluationSync.subscriber";

// Suppress logger output
vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("~/utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
  toError: vi.fn((e) => (e instanceof Error ? e : new Error(String(e)))),
}));

function createRun(
  overrides: Partial<EvaluationRunData> = {},
): EvaluationRunData {
  return {
    evaluationId: "eval-1",
    evaluatorId: "evaluator-1",
    evaluatorType: "llm_judge",
    evaluatorName: "Toxicity Check",
    traceId: "trace-1",
    isGuardrail: false,
    status: "processed",
    score: 0.85,
    passed: true,
    label: null,
    details: null,
    error: null,
    errorDetails: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    archivedAt: null,
    scheduledAt: null,
    startedAt: null,
    completedAt: Date.now(),
    costId: null,
    ...overrides,
  } as EvaluationRunData;
}

function createEvent(
  overrides: Record<string, unknown> = {},
): EvaluationProcessingEvent {
  return {
    id: "event-1",
    aggregateId: "eval-1",
    aggregateType: "evaluation",
    tenantId: "project-1",
    createdAt: Date.now(),
    occurredAt: Date.now(),
    type: "lw.evaluation.completed",
    version: 1,
    data: {
      evaluationId: "eval-1",
      status: "processed",
      score: 0.85,
      passed: true,
    },
    metadata: {},
    ...overrides,
  } as unknown as EvaluationProcessingEvent;
}

function createContext(tenantId = "project-1"): EventSubscriberContext {
  return { tenantId, aggregateId: "eval-1" };
}

function createMockEvalRunStore(
  run: EvaluationRunData | null = createRun(),
): FoldProjectionStore<EvaluationRunData> {
  return {
    get: vi.fn().mockResolvedValue(run),
    store: vi.fn().mockResolvedValue(undefined),
  } as unknown as FoldProjectionStore<EvaluationRunData>;
}

function createDeps(
  overrides: Partial<CustomerIoEvaluationSyncSubscriberDeps> = {},
): CustomerIoEvaluationSyncSubscriberDeps {
  return {
    projects: createMockProjectService(),
    nurturing: createMockNurturing(),
    evaluationCountFn: vi.fn().mockResolvedValue(0),
    evalRunStore: createMockEvalRunStore(),
    ...overrides,
  };
}

describe("customerIoEvaluationSync subscriber", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("deduplication", () => {
    /** @scenario 'Evaluation sync reactor uses project-and-evaluation-scoped job ID for debouncing' */
    it("keys the dedup window on cio-eval-sync-{projectId}-{evaluationId}", () => {
      const subscriber = createCustomerIoEvaluationSyncSubscriber(createDeps());
      const dedup = subscriber.options?.deduplication;
      if (!dedup || dedup === "aggregate") {
        throw new Error("expected a custom deduplication config");
      }

      expect(
        dedup.makeId(
          createEvent({ tenantId: "project-42", aggregateId: "eval-99" }),
        ),
      ).toBe("cio-eval-sync-project-42-eval-99");
    });

    /** @scenario 'Subsequent evaluation updates are debounced per project' */
    it("debounces over the shared Customer.io window", () => {
      const subscriber = createCustomerIoEvaluationSyncSubscriber(createDeps());
      const dedup = subscriber.options?.deduplication;
      if (!dedup || dedup === "aggregate") {
        throw new Error("expected a custom deduplication config");
      }

      expect(dedup.ttlMs).toBe(CIO_SYNC_DEBOUNCE_TTL_MS);
      expect(dedup.extend).toBeUndefined();
      expect(dedup.replace).toBeUndefined();
    });
  });

  describe("event types", () => {
    it("subscribes to the terminal evaluation events only", () => {
      const subscriber = createCustomerIoEvaluationSyncSubscriber(createDeps());

      expect(subscriber.eventTypes).toEqual([
        "lw.evaluation.completed",
        "lw.evaluation.reported",
      ]);
    });
  });

  describe("given an organization with no prior evaluations", () => {
    describe("when the first evaluation is processed", () => {
      /** @scenario 'First evaluation identifies user with evaluation milestones' */
      it("identifies user with has_evaluations true and evaluation_count 1", async () => {
        const deps = createDeps({
          evaluationCountFn: vi.fn().mockResolvedValue(1),
        });
        const subscriber = createCustomerIoEvaluationSyncSubscriber(deps);

        await subscriber.handle(createEvent(), createContext());

        expect(deps.nurturing.identifyUser).toHaveBeenCalledWith({
          userId: "user-1",
          traits: expect.objectContaining({
            has_evaluations: true,
            evaluation_count: 1,
            first_evaluation_at: expect.any(String),
          }),
        });
      });

      /** @scenario 'First evaluation fires first_evaluation_created event' */
      it("tracks first_evaluation_created event with the folded evaluator type", async () => {
        const deps = createDeps({
          evaluationCountFn: vi.fn().mockResolvedValue(1),
          evalRunStore: createMockEvalRunStore(
            createRun({ evaluatorType: "llm_judge" }),
          ),
        });
        const subscriber = createCustomerIoEvaluationSyncSubscriber(deps);

        await subscriber.handle(createEvent(), createContext());

        expect(deps.nurturing.trackEvent).toHaveBeenCalledWith({
          userId: "user-1",
          event: "first_evaluation_created",
          properties: expect.objectContaining({
            evaluation_type: "llm_judge",
            project_id: "project-1",
          }),
        });
      });
    });
  });

  describe("given an organization that already has evaluations", () => {
    describe("when a new evaluation is processed", () => {
      /** @scenario 'Subsequent evaluations update identify with evaluation count' */
      it("identifies user with updated evaluation_count and last_evaluation_at", async () => {
        const deps = createDeps({
          evaluationCountFn: vi.fn().mockResolvedValue(6),
          evalRunStore: createMockEvalRunStore(
            createRun({ score: 0.85, passed: true }),
          ),
        });
        const subscriber = createCustomerIoEvaluationSyncSubscriber(deps);

        await subscriber.handle(createEvent(), createContext());

        expect(deps.nurturing.identifyUser).toHaveBeenCalledWith({
          userId: "user-1",
          traits: expect.objectContaining({
            evaluation_count: 6,
            last_evaluation_at: expect.any(String),
          }),
        });
      });

      /** @scenario 'Subsequent evaluations fire evaluation_ran event' */
      it("tracks evaluation_ran event", async () => {
        const deps = createDeps({
          evaluationCountFn: vi.fn().mockResolvedValue(6),
          evalRunStore: createMockEvalRunStore(
            createRun({ evaluationId: "eval-42", score: 0.85, passed: true }),
          ),
        });
        const subscriber = createCustomerIoEvaluationSyncSubscriber(deps);

        await subscriber.handle(createEvent(), createContext());

        expect(deps.nurturing.trackEvent).toHaveBeenCalledWith({
          userId: "user-1",
          event: "evaluation_ran",
          properties: expect.objectContaining({
            evaluation_id: "eval-42",
            score: 0.85,
            passed: true,
          }),
        });
      });
    });
  });

  describe("given the evaluation run fold is not readable", () => {
    it("does not call nurturing methods", async () => {
      const deps = createDeps({
        evalRunStore: createMockEvalRunStore(null),
      });
      const subscriber = createCustomerIoEvaluationSyncSubscriber(deps);

      await subscriber.handle(createEvent(), createContext());

      expect(deps.nurturing.identifyUser).not.toHaveBeenCalled();
      expect(deps.nurturing.trackEvent).not.toHaveBeenCalled();
    });
  });

  describe("given the evaluation run fold is readable", () => {
    describe("when the subscriber handles the event", () => {
      it("reads the fold back for the event's own evaluation and tenant", async () => {
        const deps = createDeps();
        const subscriber = createCustomerIoEvaluationSyncSubscriber(deps);

        await subscriber.handle(createEvent(), createContext());

        expect(deps.evalRunStore.get).toHaveBeenCalledWith(
          "eval-1",
          expect.objectContaining({
            aggregateId: "eval-1",
            tenantId: "project-1",
          }),
        );
      });
    });
  });

  describe("given the evaluation count query fails", () => {
    describe("when evaluationCountFn returns null", () => {
      it("skips nurturing sync to avoid false milestones", async () => {
        const deps = createDeps({
          evaluationCountFn: vi.fn().mockResolvedValue(null),
        });
        const subscriber = createCustomerIoEvaluationSyncSubscriber(deps);

        await subscriber.handle(createEvent(), createContext());

        expect(deps.nurturing.identifyUser).not.toHaveBeenCalled();
        expect(deps.nurturing.trackEvent).not.toHaveBeenCalled();
      });
    });
  });

  describe("given the project is not found", () => {
    it("does not call nurturing methods", async () => {
      const deps = createDeps({
        projects: createMockProjectService({
          resolveOrgAdmin: vi.fn().mockResolvedValue({
            userId: null,
            organizationId: null,
            firstMessage: false,
          }),
        }),
      });
      const subscriber = createCustomerIoEvaluationSyncSubscriber(deps);

      await subscriber.handle(createEvent(), createContext());

      expect(deps.nurturing.identifyUser).not.toHaveBeenCalled();
      expect(deps.nurturing.trackEvent).not.toHaveBeenCalled();
    });
  });

  describe("given the evaluation is not in a terminal state", () => {
    it("does not call nurturing methods", async () => {
      const deps = createDeps();
      const subscriber = createCustomerIoEvaluationSyncSubscriber(deps);

      await subscriber.handle(
        createEvent({ type: "lw.evaluation.scheduled" }),
        createContext(),
      );

      expect(deps.nurturing.identifyUser).not.toHaveBeenCalled();
      expect(deps.evalRunStore.get).not.toHaveBeenCalled();
    });
  });

  describe("given the nurturing service throws", () => {
    it("does not propagate the error", async () => {
      const nurturing = createMockNurturing();
      vi.mocked(nurturing.identifyUser).mockRejectedValue(
        new Error("CIO down"),
      );
      const deps = createDeps({ nurturing });
      const subscriber = createCustomerIoEvaluationSyncSubscriber(deps);

      await expect(
        subscriber.handle(createEvent(), createContext()),
      ).resolves.toBeUndefined();
    });
  });

  describe("given the evaluation run store throws", () => {
    it("does not propagate the error", async () => {
      const evalRunStore = createMockEvalRunStore();
      vi.mocked(evalRunStore.get).mockRejectedValue(
        new Error("ClickHouse down"),
      );
      const deps = createDeps({ evalRunStore });
      const subscriber = createCustomerIoEvaluationSyncSubscriber(deps);

      await expect(
        subscriber.handle(createEvent(), createContext()),
      ).resolves.toBeUndefined();
    });
  });
});
