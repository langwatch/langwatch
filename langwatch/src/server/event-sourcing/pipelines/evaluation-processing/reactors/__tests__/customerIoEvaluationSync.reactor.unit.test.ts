import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EvaluationRunData } from "~/server/app-layer/evaluations/types";
import type { NurturingService } from "../../../../../../../ee/billing/nurturing/nurturing.service";
import type { ProjectService } from "../../../../../app-layer/projects/project.service";
import type { ReactorContext } from "../../../../reactors/reactor.types";
import type { EvaluationProcessingEvent } from "../../schemas/events";
import {
  createCustomerIoEvaluationSyncReactor,
  type CustomerIoEvaluationSyncReactorDeps,
} from "../customerIoEvaluationSync.reactor";

// Suppress logger output
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

function createFoldState(
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

function createContext(
  foldState: EvaluationRunData,
  tenantId = "project-1",
): ReactorContext<EvaluationRunData> {
  return {
    tenantId,
    aggregateId: "eval-1",
    foldState,
  };
}

function createMockNurturing(): NurturingService {
  return {
    identifyUser: vi.fn().mockResolvedValue(undefined),
    trackEvent: vi.fn().mockResolvedValue(undefined),
    groupUser: vi.fn().mockResolvedValue(undefined),
    batch: vi.fn().mockResolvedValue(undefined),
  } as unknown as NurturingService;
}

function createMockProjectService(
  overrides: Partial<{ resolveOrgAdmin: ReturnType<typeof vi.fn> }> = {},
): ProjectService {
  return {
    resolveOrgAdmin: vi.fn().mockResolvedValue({
      userId: "user-1",
      organizationId: "org-1",
      firstMessage: false,
    }),
    ...overrides,
  } as unknown as ProjectService;
}

function createDeps(
  overrides: Partial<CustomerIoEvaluationSyncReactorDeps> = {},
): CustomerIoEvaluationSyncReactorDeps {
  return {
    projects: createMockProjectService(),
    nurturing: createMockNurturing(),
    evaluationCountFn: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}

describe("customerIoEvaluationSync reactor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("makeJobId", () => {
    it("returns cio-eval-sync-{projectId}-{evaluationId}", () => {
      const deps = createDeps();
      const reactor = createCustomerIoEvaluationSyncReactor(deps);
      const event = createEvent({ tenantId: "project-42", aggregateId: "eval-99" });

      const jobId = reactor.options!.makeJobId!({
        event,
        foldState: createFoldState(),
      });

      expect(jobId).toBe("cio-eval-sync-project-42-eval-99");
    });
  });

  describe("given an organization with no prior evaluations", () => {
    describe("when the first evaluation is processed", () => {
      it("identifies user with has_evaluations true and evaluation_count 1", async () => {
        const deps = createDeps({
          evaluationCountFn: vi.fn().mockResolvedValue(1),
        });
        const reactor = createCustomerIoEvaluationSyncReactor(deps);

        await reactor.handle(
          createEvent(),
          createContext(createFoldState()),
        );

        expect(deps.nurturing.identifyUser).toHaveBeenCalledWith({
          userId: "user-1",
          traits: expect.objectContaining({
            has_evaluations: true,
            evaluation_count: 1,
            first_evaluation_at: expect.any(String),
          }),
        });
      });

      it("tracks first_evaluation_created event", async () => {
        const deps = createDeps({
          evaluationCountFn: vi.fn().mockResolvedValue(1),
        });
        const reactor = createCustomerIoEvaluationSyncReactor(deps);

        await reactor.handle(
          createEvent(),
          createContext(createFoldState({ evaluatorType: "llm_judge" })),
        );

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
      it("identifies user with updated evaluation_count and last_evaluation_at", async () => {
        const deps = createDeps({
          evaluationCountFn: vi.fn().mockResolvedValue(6),
        });
        const reactor = createCustomerIoEvaluationSyncReactor(deps);

        await reactor.handle(
          createEvent(),
          createContext(createFoldState({ score: 0.85, passed: true })),
        );

        expect(deps.nurturing.identifyUser).toHaveBeenCalledWith({
          userId: "user-1",
          traits: expect.objectContaining({
            evaluation_count: 6,
            last_evaluation_at: expect.any(String),
          }),
        });
      });

      it("tracks evaluation_ran event", async () => {
        const deps = createDeps({
          evaluationCountFn: vi.fn().mockResolvedValue(6),
        });
        const reactor = createCustomerIoEvaluationSyncReactor(deps);
        const foldState = createFoldState({
          evaluationId: "eval-42",
          score: 0.85,
          passed: true,
        });

        await reactor.handle(createEvent(), createContext(foldState));

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

  describe("given the evaluation count query fails", () => {
    describe("when evaluationCountFn returns null", () => {
      it("skips nurturing sync to avoid false milestones", async () => {
        const deps = createDeps({
          evaluationCountFn: vi.fn().mockResolvedValue(null),
        });
        const reactor = createCustomerIoEvaluationSyncReactor(deps);

        await reactor.handle(
          createEvent(),
          createContext(createFoldState()),
        );

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
      const reactor = createCustomerIoEvaluationSyncReactor(deps);

      await reactor.handle(
        createEvent(),
        createContext(createFoldState()),
      );

      expect(deps.nurturing.identifyUser).not.toHaveBeenCalled();
      expect(deps.nurturing.trackEvent).not.toHaveBeenCalled();
    });
  });

  describe("given the evaluation is not in a completed state", () => {
    it("does not call nurturing methods", async () => {
      const deps = createDeps();
      const reactor = createCustomerIoEvaluationSyncReactor(deps);

      await reactor.handle(
        createEvent({ type: "lw.evaluation.scheduled" } as any),
        createContext(createFoldState({ status: "scheduled" })),
      );

      expect(deps.nurturing.identifyUser).not.toHaveBeenCalled();
    });
  });

  describe("given the nurturing service throws", () => {
    it("does not propagate the error", async () => {
      const nurturing = createMockNurturing();
      vi.mocked(nurturing.identifyUser).mockRejectedValue(
        new Error("CIO down"),
      );
      const deps = createDeps({ nurturing });
      const reactor = createCustomerIoEvaluationSyncReactor(deps);

      await expect(
        reactor.handle(createEvent(), createContext(createFoldState())),
      ).resolves.toBeUndefined();
    });
  });
});
