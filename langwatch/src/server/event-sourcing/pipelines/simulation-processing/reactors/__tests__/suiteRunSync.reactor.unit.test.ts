import { describe, expect, it, vi } from "vitest";
import { createTenantId } from "../../../../domain/tenantId";
import type { SimulationRunStateData } from "../../projections/simulationRunState.foldProjection";
import {
  SIMULATION_RUN_EVENT_TYPES,
  SIMULATION_EVENT_VERSIONS,
} from "../../schemas/constants";
import type {
  SimulationRunStartedEvent,
  SimulationRunFinishedEvent,
  SimulationTextMessageEndEvent,
} from "../../schemas/events";
import { createSuiteRunSyncReactor, type SuiteRunSyncReactorDeps } from "../suiteRunSync.reactor";

const TEST_TENANT_ID = createTenantId("tenant-1");

function createDeps(): SuiteRunSyncReactorDeps & {
  recordSuiteRunItemStarted: ReturnType<typeof vi.fn>;
  completeSuiteRunItem: ReturnType<typeof vi.fn>;
} {
  return {
    recordSuiteRunItemStarted: vi.fn().mockResolvedValue(undefined),
    completeSuiteRunItem: vi.fn().mockResolvedValue(undefined),
  };
}

function createFoldState(overrides: Partial<SimulationRunStateData> = {}): SimulationRunStateData {
  return {
    ScenarioRunId: "run-1",
    ScenarioId: "scenario-1",
    BatchRunId: "batch-1",
    ScenarioSetId: "__internal__suite-1__suite",
    Status: "IN_PROGRESS",
    Name: null,
    Description: null,
    Metadata: null,
    Messages: [],
    TraceIds: [],
    Verdict: null,
    Reasoning: null,
    MetCriteria: [],
    UnmetCriteria: [],
    Error: null,
    DurationMs: null,
    TotalCost: null,
    RoleCosts: {},
    RoleLatencies: {},
    TraceMetrics: {},
    StartedAt: 1000,
    QueuedAt: null,
    CreatedAt: 1000,
    UpdatedAt: 2000,
    FinishedAt: null,
    ArchivedAt: null,
    LastSnapshotOccurredAt: 0,
    LastEventOccurredAt: 0,
    ...overrides,
  };
}

function createStartedEvent(): SimulationRunStartedEvent {
  return {
    id: "event-1",
    aggregateId: "run-1",
    aggregateType: "simulation_run",
    tenantId: TEST_TENANT_ID,
    createdAt: 1000,
    occurredAt: 1000,
    type: SIMULATION_RUN_EVENT_TYPES.STARTED,
    version: SIMULATION_EVENT_VERSIONS.STARTED,
    data: {
      scenarioRunId: "run-1",
      scenarioId: "scenario-1",
      batchRunId: "batch-1",
      scenarioSetId: "__internal__suite-1__suite",
    },
  };
}

function createFinishedEvent(): SimulationRunFinishedEvent {
  return {
    id: "event-2",
    aggregateId: "run-1",
    aggregateType: "simulation_run",
    tenantId: TEST_TENANT_ID,
    createdAt: 5000,
    occurredAt: 5000,
    type: SIMULATION_RUN_EVENT_TYPES.FINISHED,
    version: SIMULATION_EVENT_VERSIONS.FINISHED,
    data: {
      scenarioRunId: "run-1",
      results: { verdict: "success", metCriteria: [], unmetCriteria: [] },
      durationMs: 3000,
    },
  };
}

describe("suiteRunSync reactor", () => {
  describe("when ScenarioSetId is a suite set ID", () => {
    it("dispatches recordSuiteRunItemStarted on STARTED event", async () => {
      const deps = createDeps();
      const reactor = createSuiteRunSyncReactor(deps);
      const foldState = createFoldState();

      await reactor.handle(createStartedEvent(), {
        tenantId: TEST_TENANT_ID,
        aggregateId: "run-1",
        foldState,
      });

      expect(deps.recordSuiteRunItemStarted).toHaveBeenCalledWith({
        tenantId: TEST_TENANT_ID,
        batchRunId: "batch-1",
        scenarioRunId: "run-1",
        scenarioId: "scenario-1",
        occurredAt: 1000,
      });
    });

    it("dispatches completeSuiteRunItem on FINISHED event", async () => {
      const deps = createDeps();
      const reactor = createSuiteRunSyncReactor(deps);
      const foldState = createFoldState({
        Status: "SUCCESS",
        Verdict: "success",
        DurationMs: 3000,
        Reasoning: "All criteria met",
      });

      await reactor.handle(createFinishedEvent(), {
        tenantId: TEST_TENANT_ID,
        aggregateId: "run-1",
        foldState,
      });

      expect(deps.completeSuiteRunItem).toHaveBeenCalledWith({
        tenantId: TEST_TENANT_ID,
        batchRunId: "batch-1",
        scenarioRunId: "run-1",
        scenarioId: "scenario-1",
        status: "SUCCESS",
        verdict: "success",
        durationMs: 3000,
        reasoning: "All criteria met",
        error: undefined,
        occurredAt: 5000,
      });
    });
  });

  describe("when ScenarioSetId is not a suite set ID", () => {
    it("skips non-suite simulation runs", async () => {
      const deps = createDeps();
      const reactor = createSuiteRunSyncReactor(deps);
      const foldState = createFoldState({
        ScenarioSetId: "external-set-123",
      });

      await reactor.handle(createStartedEvent(), {
        tenantId: TEST_TENANT_ID,
        aggregateId: "run-1",
        foldState,
      });

      expect(deps.recordSuiteRunItemStarted).not.toHaveBeenCalled();
    });

    it("skips when ScenarioSetId is empty", async () => {
      const deps = createDeps();
      const reactor = createSuiteRunSyncReactor(deps);
      const foldState = createFoldState({ ScenarioSetId: "" });

      await reactor.handle(createStartedEvent(), {
        tenantId: TEST_TENANT_ID,
        aggregateId: "run-1",
        foldState,
      });

      expect(deps.recordSuiteRunItemStarted).not.toHaveBeenCalled();
    });
  });

  describe("when handling non-lifecycle events", () => {
    it("ignores text message events", async () => {
      const deps = createDeps();
      const reactor = createSuiteRunSyncReactor(deps);
      const foldState = createFoldState();

      const textEndEvent: SimulationTextMessageEndEvent = {
        id: "event-3",
        aggregateId: "run-1",
        aggregateType: "simulation_run",
        tenantId: TEST_TENANT_ID,
        createdAt: 3000,
        occurredAt: 3000,
        type: SIMULATION_RUN_EVENT_TYPES.TEXT_MESSAGE_END,
        version: SIMULATION_EVENT_VERSIONS.TEXT_MESSAGE_END,
        data: {
          scenarioRunId: "run-1",
          messageId: "msg-1",
          role: "assistant",
          content: "Hello",
        },
      };

      await reactor.handle(textEndEvent, {
        tenantId: TEST_TENANT_ID,
        aggregateId: "run-1",
        foldState,
      });

      expect(deps.recordSuiteRunItemStarted).not.toHaveBeenCalled();
      expect(deps.completeSuiteRunItem).not.toHaveBeenCalled();
    });
  });
});
