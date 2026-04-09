import { describe, expect, it, vi, beforeEach } from "vitest";
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
      getById: vi.fn().mockResolvedValue({}),
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
    LastEventOccurredAt: 0,
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
  } as ExperimentRunProcessingEvent;
}

describe("ExperimentRunEsSyncReactor", () => {
  let deps: ExperimentRunEsSyncReactorDeps;

  beforeEach(() => {
    deps = createMockDeps();
  });

  describe("when handling any event", () => {
    it("is a no-op (ES writes are fully disabled)", async () => {
      const reactor = createExperimentRunEsSyncReactor(deps);
      const event = createMockEvent(EXPERIMENT_RUN_EVENT_TYPES.STARTED, {
        runId: "run-1",
        experimentId: "exp-1",
        total: 10,
        targets: [],
      });

      await reactor.handle(event, createMockContext());

      expect(deps.repository.create).not.toHaveBeenCalled();
      expect(deps.repository.upsertResults).not.toHaveBeenCalled();
      expect(deps.repository.markComplete).not.toHaveBeenCalled();
    });
  });
});
