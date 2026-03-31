import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { ReactorContext } from "../../../../reactors/reactor.types";
import type { ExperimentRunStateData } from "../../projections/experimentRunState.foldProjection";
import type { ExperimentRunProcessingEvent } from "../../schemas/events";
import { EXPERIMENT_RUN_EVENT_TYPES } from "../../schemas/constants";
import {
  createExperimentRunEsSyncReactor,
  type ExperimentRunEsSyncReactorDeps,
} from "../experimentRunEsSync.reactor";

function createMockDeps(): ExperimentRunEsSyncReactorDeps {
  return {
    project: {
      isFeatureEnabled: vi.fn().mockResolvedValue(true),
      getById: vi.fn().mockResolvedValue({ disableElasticSearchEvaluationWriting: false }),
    } as any,
    repository: {
      create: vi.fn().mockResolvedValue(undefined),
      upsertResults: vi.fn().mockResolvedValue(undefined),
      markComplete: vi.fn().mockResolvedValue(undefined),
    } as any,
  };
}

function createMockFoldState(
  overrides: Partial<ExperimentRunStateData> = {},
): ExperimentRunStateData {
  return {
    RunId: "run-1",
    ExperimentId: "exp-1",
    WorkflowVersionId: null,
    Total: 10,
    Progress: 0,
    CompletedCount: 0,
    FailedCount: 0,
    TotalCost: null,
    TotalDurationMs: null,
    AvgScoreBps: null,
    PassRateBps: null,
    Targets: "[]",
    CreatedAt: 1000000,
    UpdatedAt: 1000000,
    StartedAt: null,
    FinishedAt: null,
    StoppedAt: null,
    TotalScoreSum: 0,
    ScoreCount: 0,
    PassedCount: 0,
    GradedCount: 0,
    ...overrides,
  };
}

function createMockContext(
  foldState?: Partial<ExperimentRunStateData>,
): ReactorContext<ExperimentRunStateData> {
  return {
    tenantId: "tenant-1",
    aggregateId: "agg-1",
    foldState: createMockFoldState(foldState),
  };
}

function createMockEvent(
  type: string,
  data: Record<string, unknown> = {},
  metadata?: Record<string, unknown>,
): ExperimentRunProcessingEvent {
  return {
    id: "evt-1",
    aggregateId: "agg-1",
    aggregateType: "experiment_run",
    tenantId: "tenant-1",
    type,
    version: "2025-02-01",
    data,
    createdAt: 1000000,
    occurredAt: 1000000,
    metadata,
  } as ExperimentRunProcessingEvent;
}

describe("ExperimentRunEsSyncReactor", () => {
  let deps: ExperimentRunEsSyncReactorDeps;

  beforeEach(() => {
    vi.useFakeTimers();
    deps = createMockDeps();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("when feature flag is disabled", () => {
    it("skips processing", async () => {
      (deps.project.isFeatureEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(false);
      const reactor = createExperimentRunEsSyncReactor(deps);
      const event = createMockEvent(EXPERIMENT_RUN_EVENT_TYPES.STARTED, {
        runId: "run-1",
        experimentId: "exp-1",
        total: 10,
        targets: [],
      });

      await reactor.handle(event, createMockContext());

      expect(deps.repository.create).not.toHaveBeenCalled();
    });
  });

  describe("when ES writes are disabled for project", () => {
    it("skips processing", async () => {
      (deps.project.getById as ReturnType<typeof vi.fn>).mockResolvedValue({
        disableElasticSearchEvaluationWriting: true,
      });
      const reactor = createExperimentRunEsSyncReactor(deps);
      const event = createMockEvent(EXPERIMENT_RUN_EVENT_TYPES.STARTED, {
        runId: "run-1",
        experimentId: "exp-1",
        total: 10,
        targets: [],
      });

      await reactor.handle(event, createMockContext());

      expect(deps.repository.create).not.toHaveBeenCalled();
    });
  });

  describe("when event has migration source metadata", () => {
    it("skips processing", async () => {
      const reactor = createExperimentRunEsSyncReactor(deps);
      const event = createMockEvent(
        EXPERIMENT_RUN_EVENT_TYPES.STARTED,
        { runId: "run-1", experimentId: "exp-1", total: 10, targets: [] },
        { source: "migration" },
      );

      await reactor.handle(event, createMockContext());

      expect(deps.project.isFeatureEnabled).not.toHaveBeenCalled();
      expect(deps.repository.create).not.toHaveBeenCalled();
    });
  });

  describe("when experimentId or runId is missing from fold state", () => {
    it("skips processing when experimentId is empty", async () => {
      const reactor = createExperimentRunEsSyncReactor(deps);
      const event = createMockEvent(EXPERIMENT_RUN_EVENT_TYPES.STARTED, {
        runId: "run-1",
        experimentId: "exp-1",
        total: 10,
        targets: [],
      });

      await reactor.handle(event, createMockContext({ ExperimentId: "" }));

      expect(deps.repository.create).not.toHaveBeenCalled();
    });

    it("skips processing when runId is empty", async () => {
      const reactor = createExperimentRunEsSyncReactor(deps);
      const event = createMockEvent(EXPERIMENT_RUN_EVENT_TYPES.STARTED, {
        runId: "run-1",
        experimentId: "exp-1",
        total: 10,
        targets: [],
      });

      await reactor.handle(event, createMockContext({ RunId: "" }));

      expect(deps.repository.create).not.toHaveBeenCalled();
    });
  });

  describe("when handling STARTED event", () => {
    it("calls repository.create with correct args", async () => {
      const reactor = createExperimentRunEsSyncReactor(deps);
      const targets = [{ id: "t1", name: "target1" }];
      const event = createMockEvent(EXPERIMENT_RUN_EVENT_TYPES.STARTED, {
        runId: "run-1",
        experimentId: "exp-1",
        total: 10,
        targets,
      });

      await reactor.handle(
        event,
        createMockContext({
          Targets: JSON.stringify(targets),
          WorkflowVersionId: "wf-1",
          Total: 10,
        }),
      );

      expect(deps.repository.create).toHaveBeenCalledWith({
        projectId: "tenant-1",
        experimentId: "exp-1",
        runId: "run-1",
        workflowVersionId: "wf-1",
        total: 10,
        targets,
      });
    });

    it("handles invalid Targets JSON gracefully", async () => {
      const reactor = createExperimentRunEsSyncReactor(deps);
      const event = createMockEvent(EXPERIMENT_RUN_EVENT_TYPES.STARTED, {
        runId: "run-1",
        experimentId: "exp-1",
        total: 5,
        targets: [],
      });

      await reactor.handle(
        event,
        createMockContext({ Targets: "not-valid-json" }),
      );

      expect(deps.repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ targets: [] }),
      );
    });
  });

  describe("when handling TARGET_RESULT event", () => {
    it("calls repository.upsertResults with dataset", async () => {
      const reactor = createExperimentRunEsSyncReactor(deps);
      const event = createMockEvent(EXPERIMENT_RUN_EVENT_TYPES.TARGET_RESULT, {
        runId: "run-1",
        experimentId: "exp-1",
        index: 0,
        targetId: "t1",
        entry: { input: "hello" },
        predicted: { output: "world" },
        cost: 0.05,
        duration: 1500,
        error: null,
        traceId: "trace-abc",
      });

      await reactor.handle(event, createMockContext({ Progress: 1 }));

      expect(deps.repository.upsertResults).toHaveBeenCalledWith({
        projectId: "tenant-1",
        experimentId: "exp-1",
        runId: "run-1",
        dataset: [
          {
            index: 0,
            target_id: "t1",
            entry: { input: "hello" },
            predicted: { output: "world" },
            cost: 0.05,
            duration: 1500,
            error: null,
            trace_id: "trace-abc",
          },
        ],
        progress: 1,
        targets: [],
      });
    });
  });

  describe("when handling EVALUATOR_RESULT event", () => {
    it("calls repository.upsertResults with evaluations", async () => {
      const reactor = createExperimentRunEsSyncReactor(deps);
      const event = createMockEvent(
        EXPERIMENT_RUN_EVENT_TYPES.EVALUATOR_RESULT,
        {
          runId: "run-1",
          experimentId: "exp-1",
          index: 0,
          targetId: "t1",
          evaluatorId: "eval-1",
          evaluatorName: "accuracy",
          status: "processed",
          score: 0.95,
          label: "good",
          passed: true,
          details: "all correct",
          cost: 0.01,
        },
      );

      await reactor.handle(event, createMockContext());

      expect(deps.repository.upsertResults).toHaveBeenCalledWith({
        projectId: "tenant-1",
        experimentId: "exp-1",
        runId: "run-1",
        evaluations: [
          {
            evaluator: "eval-1",
            name: "accuracy",
            target_id: "t1",
            index: 0,
            status: "processed",
            score: 0.95,
            label: "good",
            passed: true,
            details: "all correct",
            cost: 0.01,
          },
        ],
      });
    });
  });

  describe("when handling COMPLETED event", () => {
    it("calls repository.markComplete", async () => {
      const reactor = createExperimentRunEsSyncReactor(deps);
      const event = createMockEvent(EXPERIMENT_RUN_EVENT_TYPES.COMPLETED, {
        runId: "run-1",
        experimentId: "exp-1",
        finishedAt: 2000000,
        stoppedAt: null,
      });

      await reactor.handle(event, createMockContext());

      expect(deps.repository.markComplete).toHaveBeenCalledWith({
        projectId: "tenant-1",
        experimentId: "exp-1",
        runId: "run-1",
        finishedAt: 2000000,
        stoppedAt: undefined,
      });
    });
  });

  describe("when repository throws", () => {
    it("retries up to MAX_RETRIES with exponential backoff", async () => {
      vi.useRealTimers(); // Use real timers for retry delays
      const error = new Error("ES connection failed");
      let callCount = 0;
      (deps.repository.create as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callCount++;
        if (callCount < 3) throw error;
      });

      const reactor = createExperimentRunEsSyncReactor(deps);
      const event = createMockEvent(EXPERIMENT_RUN_EVENT_TYPES.STARTED, {
        runId: "run-1",
        experimentId: "exp-1",
        total: 10,
        targets: [],
      });

      // The reactor retries with 1s, 2s delays — mock setTimeout to resolve instantly
      vi.useFakeTimers();
      const promise = reactor.handle(event, createMockContext());
      await vi.advanceTimersByTimeAsync(5000);
      await promise;

      expect(deps.repository.create).toHaveBeenCalledTimes(3);
    });

    it("throws after all retries exhausted", async () => {
      const error = new Error("ES permanently down");
      (deps.repository.create as ReturnType<typeof vi.fn>).mockRejectedValue(error);

      const reactor = createExperimentRunEsSyncReactor(deps);
      const event = createMockEvent(EXPERIMENT_RUN_EVENT_TYPES.STARTED, {
        runId: "run-1",
        experimentId: "exp-1",
        total: 10,
        targets: [],
      });

      // Attach rejection handler BEFORE advancing timers to avoid unhandled rejection
      const promise = reactor.handle(event, createMockContext());
      const caught = promise.catch((e) => e);

      // Advance enough time for all retries (1s + 2s = 3s)
      await vi.advanceTimersByTimeAsync(5000);

      const result = await caught;
      expect(result).toBe(error);
      expect(deps.repository.create).toHaveBeenCalledTimes(3);
    });
  });
});
