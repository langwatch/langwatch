import { describe, expect, it } from "vitest";
import { createTenantId } from "../../../../domain/tenantId";
import type { FoldProjectionStore } from "../../../../projections/foldProjection.types";
import {
    SIMULATION_EVENT_VERSIONS,
    SIMULATION_RUN_EVENT_TYPES,
} from "../../schemas/constants";
import type {
    SimulationMessageSnapshotEvent,
    SimulationProcessingEvent,
    SimulationRunDeletedEvent,
    SimulationRunFinishedEvent,
    SimulationRunStartedEvent,
} from "../../schemas/events";
import {
    createSimulationRunStateFoldProjection,
    type SimulationRunStateData,
} from "../simulationRunState.foldProjection";

// Create a dummy store -- only init/apply are tested, not persistence
const noopStore: FoldProjectionStore<SimulationRunStateData> = {
  store: async () => {},
  get: async () => null,
};
const foldProjection = createSimulationRunStateFoldProjection({ store: noopStore });

const TEST_TENANT_ID = createTenantId("tenant-1");

function createRunStartedEvent(
  overrides: Partial<SimulationRunStartedEvent["data"]> = {},
  eventOverrides: Partial<SimulationRunStartedEvent> = {},
): SimulationRunStartedEvent {
  return {
    id: "event-1",
    aggregateId: "scenario-run-1",
    aggregateType: "simulation_run",
    tenantId: TEST_TENANT_ID,
    timestamp: 1000,
    occurredAt: 1000,
    type: SIMULATION_RUN_EVENT_TYPES.STARTED,
    version: SIMULATION_EVENT_VERSIONS.STARTED,
    data: {
      scenarioRunId: "scenario-run-1",
      scenarioId: "scenario-1",
      batchRunId: "batch-1",
      scenarioSetId: "set-1",
      ...overrides,
    },
    ...eventOverrides,
  };
}

function createMessageSnapshotEvent(
  overrides: Partial<SimulationMessageSnapshotEvent["data"]> = {},
  eventOverrides: Partial<SimulationMessageSnapshotEvent> = {},
): SimulationMessageSnapshotEvent {
  return {
    id: "event-2",
    aggregateId: "scenario-run-1",
    aggregateType: "simulation_run",
    tenantId: TEST_TENANT_ID,
    timestamp: 2000,
    occurredAt: 2000,
    type: SIMULATION_RUN_EVENT_TYPES.MESSAGE_SNAPSHOT,
    version: SIMULATION_EVENT_VERSIONS.MESSAGE_SNAPSHOT,
    data: {
      scenarioRunId: "scenario-run-1",
      messages: [{ role: "user", content: "hello" }],
      traceIds: ["trace-1"],
      ...overrides,
    },
    ...eventOverrides,
  };
}

function createRunFinishedEvent(
  overrides: Partial<SimulationRunFinishedEvent["data"]> = {},
  eventOverrides: Partial<SimulationRunFinishedEvent> = {},
): SimulationRunFinishedEvent {
  return {
    id: "event-3",
    aggregateId: "scenario-run-1",
    aggregateType: "simulation_run",
    tenantId: TEST_TENANT_ID,
    timestamp: 3000,
    occurredAt: 3000,
    type: SIMULATION_RUN_EVENT_TYPES.FINISHED,
    version: SIMULATION_EVENT_VERSIONS.FINISHED,
    data: {
      scenarioRunId: "scenario-run-1",
      ...overrides,
    },
    ...eventOverrides,
  };
}

function createRunDeletedEvent(
  overrides: Partial<SimulationRunDeletedEvent["data"]> = {},
  eventOverrides: Partial<SimulationRunDeletedEvent> = {},
): SimulationRunDeletedEvent {
  return {
    id: "event-4",
    aggregateId: "scenario-run-1",
    aggregateType: "simulation_run",
    tenantId: TEST_TENANT_ID,
    timestamp: 4000,
    occurredAt: 4000,
    type: SIMULATION_RUN_EVENT_TYPES.DELETED,
    version: SIMULATION_EVENT_VERSIONS.DELETED,
    data: {
      scenarioRunId: "scenario-run-1",
      ...overrides,
    },
    ...eventOverrides,
  };
}

/**
 * Helper to fold a sequence of events through init() + apply().
 */
function foldEvents(events: SimulationProcessingEvent[]): SimulationRunStateData {
  let state = foldProjection.init();
  for (const event of events) {
    state = foldProjection.apply(state, event);
  }
  return state;
}

describe("simulationRunStateFoldProjection", () => {
  describe("init()", () => {
    it("returns PENDING status with empty fields", () => {
      const state = foldProjection.init();

      expect(state.Status).toBe("PENDING");
      expect(state.ScenarioRunId).toBe("");
      expect(state.ScenarioSetId).toBe("");
      expect(state.Messages).toEqual([]);
      expect(state.TraceIds).toEqual([]);
      expect(state.MetCriteria).toEqual([]);
      expect(state.UnmetCriteria).toEqual([]);
      expect(state.Verdict).toBeNull();
      expect(state.DeletedAt).toBeNull();
    });
  });

  describe("when RunStarted event is applied", () => {
    it("sets run identifiers and transitions to IN_PROGRESS", () => {
      const state = foldEvents([
        createRunStartedEvent({
          name: "Test Scenario",
          description: "A test description",
        }),
      ]);

      expect(state.ScenarioRunId).toBe("scenario-run-1");
      expect(state.ScenarioId).toBe("scenario-1");
      expect(state.BatchRunId).toBe("batch-1");
      expect(state.ScenarioSetId).toBe("set-1");
      expect(state.Name).toBe("Test Scenario");
      expect(state.Description).toBe("A test description");
      expect(state.Status).toBe("IN_PROGRESS");
      expect(state.StartedAt).toBe(1000);
      expect(state.CreatedAt).toBe(1000);
      expect(state.UpdatedAt).toBe(1000);
    });
  });

  describe("when MessageSnapshot event is applied", () => {
    it("updates Messages, TraceIds, and UpdatedAt", () => {
      const state = foldEvents([
        createRunStartedEvent(),
        createMessageSnapshotEvent({
          messages: [{ role: "user", content: "hello" }, { role: "assistant", content: "hi" }],
          traceIds: ["trace-1", "trace-2"],
        }),
      ]);

      expect(state.Messages).toEqual([
        { Id: "", Role: "user", Content: "hello", TraceId: "", Rest: "" },
        { Id: "", Role: "assistant", Content: "hi", TraceId: "", Rest: "" },
      ]);
      expect(state.TraceIds).toEqual(["trace-1", "trace-2"]);
      expect(state.UpdatedAt).toBe(2000);
    });

    it("updates Status when provided", () => {
      const state = foldEvents([
        createRunStartedEvent(),
        createMessageSnapshotEvent({ status: "IN_PROGRESS" }),
      ]);

      expect(state.Status).toBe("IN_PROGRESS");
    });

    it("preserves existing Status when not provided", () => {
      const state = foldEvents([
        createRunStartedEvent(),
        createMessageSnapshotEvent({ status: undefined }),
      ]);

      expect(state.Status).toBe("IN_PROGRESS");
    });

    it("ignores snapshots with older timestamps (out-of-order protection)", () => {
      const state = foldEvents([
        createRunStartedEvent(),
        createMessageSnapshotEvent(
          { messages: [{ role: "user", content: "second" }] },
          { id: "event-2a", occurredAt: 2000, timestamp: 2000 },
        ),
        // This older event arrives later but has an earlier timestamp
        createMessageSnapshotEvent(
          { messages: [{ role: "user", content: "first" }] },
          { id: "event-2b", occurredAt: 1500, timestamp: 1500 },
        ),
      ]);

      // The newer snapshot's data is preserved
      expect(state.Messages).toEqual([
        { Id: "", Role: "user", Content: "second", TraceId: "", Rest: "" },
      ]);
      expect(state.UpdatedAt).toBe(2000);
    });
  });

  describe("when RunFinished event is applied", () => {
    it("sets SUCCESS status for success verdict", () => {
      const state = foldEvents([
        createRunStartedEvent(),
        createRunFinishedEvent({
          results: {
            verdict: "success",
            reasoning: "All criteria met",
            metCriteria: ["criterion-1"],
            unmetCriteria: [],
          },
          durationMs: 5000,
        }),
      ]);

      expect(state.Status).toBe("SUCCESS");
      expect(state.Verdict).toBe("success");
      expect(state.Reasoning).toBe("All criteria met");
      expect(state.MetCriteria).toEqual(["criterion-1"]);
      expect(state.UnmetCriteria).toEqual([]);
      expect(state.DurationMs).toBe(5000);
      expect(state.FinishedAt).toBe(3000);
    });

    it("sets FAILURE status for failure verdict", () => {
      const state = foldEvents([
        createRunStartedEvent(),
        createRunFinishedEvent({
          results: {
            verdict: "failure",
            reasoning: "Criteria not met",
            metCriteria: [],
            unmetCriteria: ["criterion-1"],
            error: "Something went wrong",
          },
        }),
      ]);

      expect(state.Status).toBe("FAILURE");
      expect(state.Verdict).toBe("failure");
      expect(state.Error).toBe("Something went wrong");
    });

    it("sets FAILURE status for inconclusive verdict", () => {
      const state = foldEvents([
        createRunStartedEvent(),
        createRunFinishedEvent({
          results: {
            verdict: "inconclusive",
            reasoning: "Could not determine",
            metCriteria: [],
            unmetCriteria: [],
          },
        }),
      ]);

      expect(state.Status).toBe("FAILURE");
      expect(state.Verdict).toBe("inconclusive");
    });

    it("uses explicit status when provided", () => {
      const state = foldEvents([
        createRunStartedEvent(),
        createRunFinishedEvent({
          status: "ERROR",
        }),
      ]);

      expect(state.Status).toBe("ERROR");
    });

    it("defaults to FAILURE when no verdict and no explicit status", () => {
      const state = foldEvents([
        createRunStartedEvent(),
        createRunFinishedEvent({}),
      ]);

      expect(state.Status).toBe("FAILURE");
    });
  });

  describe("when RunDeleted event is applied", () => {
    it("sets DeletedAt timestamp", () => {
      const state = foldEvents([
        createRunStartedEvent(),
        createRunDeletedEvent(),
      ]);

      expect(state.DeletedAt).toBe(4000);
      expect(state.UpdatedAt).toBe(4000);
    });
  });

  describe("when full lifecycle events are applied", () => {
    it("tracks complete simulation run lifecycle", () => {
      const state = foldEvents([
        createRunStartedEvent({ name: "Full Test" }),
        createMessageSnapshotEvent({
          messages: [{ role: "user", content: "hello" }],
          traceIds: ["trace-1"],
        }),
        createRunFinishedEvent({
          results: {
            verdict: "success",
            reasoning: "Passed",
            metCriteria: ["criterion-1"],
            unmetCriteria: [],
          },
          durationMs: 3000,
        }),
      ]);

      expect(state.ScenarioRunId).toBe("scenario-run-1");
      expect(state.Name).toBe("Full Test");
      expect(state.Status).toBe("SUCCESS");
      expect(state.Verdict).toBe("success");
      expect(state.DurationMs).toBe(3000);
      expect(state.Messages).toHaveLength(1);
      expect(state.TraceIds).toEqual(["trace-1"]);
      expect(state.FinishedAt).toBe(3000);
    });
  });
});
