import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    SimulationTextMessageEndEvent,
    SimulationTextMessageStartEvent,
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
    createdAt: 1000,
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
    createdAt: 2000,
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
    createdAt: 3000,
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
    createdAt: 4000,
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

function createTextMessageStartEvent(
  overrides: Partial<SimulationTextMessageStartEvent["data"]> = {},
  eventOverrides: Partial<SimulationTextMessageStartEvent> = {},
): SimulationTextMessageStartEvent {
  return {
    id: "event-tms-1",
    aggregateId: "scenario-run-1",
    aggregateType: "simulation_run",
    tenantId: TEST_TENANT_ID,
    createdAt: 1500,
    occurredAt: 1500,
    type: SIMULATION_RUN_EVENT_TYPES.TEXT_MESSAGE_START,
    version: SIMULATION_EVENT_VERSIONS.TEXT_MESSAGE_START,
    data: {
      scenarioRunId: "scenario-run-1",
      messageId: "msg-1",
      role: "user",
      ...overrides,
    },
    ...eventOverrides,
  };
}

function createTextMessageEndEvent(
  overrides: Partial<SimulationTextMessageEndEvent["data"]> = {},
  eventOverrides: Partial<SimulationTextMessageEndEvent> = {},
): SimulationTextMessageEndEvent {
  return {
    id: "event-tme-1",
    aggregateId: "scenario-run-1",
    aggregateType: "simulation_run",
    tenantId: TEST_TENANT_ID,
    createdAt: 2000,
    occurredAt: 2000,
    type: SIMULATION_RUN_EVENT_TYPES.TEXT_MESSAGE_END,
    version: SIMULATION_EVENT_VERSIONS.TEXT_MESSAGE_END,
    data: {
      scenarioRunId: "scenario-run-1",
      messageId: "msg-1",
      role: "user",
      content: "hello",
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

const FAKE_NOW = 99999;

describe("simulationRunStateFoldProjection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FAKE_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

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
      expect(state.ArchivedAt).toBeNull();
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
      expect(state.CreatedAt).toBe(FAKE_NOW);
      expect(state.UpdatedAt).toBe(FAKE_NOW);
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
      expect(state.UpdatedAt).toBe(FAKE_NOW);
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
          { id: "event-2a", occurredAt: 2000, createdAt: 2000 },
        ),
        // This older event arrives later but has an earlier timestamp
        createMessageSnapshotEvent(
          { messages: [{ role: "user", content: "first" }] },
          { id: "event-2b", occurredAt: 1500, createdAt: 1500 },
        ),
      ]);

      // The newer snapshot's data is preserved
      expect(state.Messages).toEqual([
        { Id: "", Role: "user", Content: "second", TraceId: "", Rest: "" },
      ]);
      expect(state.UpdatedAt).toBe(FAKE_NOW);
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
    it("sets ArchivedAt timestamp", () => {
      const state = foldEvents([
        createRunStartedEvent(),
        createRunDeletedEvent(),
      ]);

      expect(state.ArchivedAt).toBe(FAKE_NOW);
      expect(state.UpdatedAt).toBe(FAKE_NOW);
    });
  });

  describe("when TextMessageStart event is applied", () => {
    it("creates a placeholder message row", () => {
      const state = foldEvents([
        createRunStartedEvent(),
        createTextMessageStartEvent({ messageId: "msg-1", role: "user" }),
      ]);

      expect(state.Messages).toEqual([
        { Id: "msg-1", Role: "user", Content: "", TraceId: "", Rest: "" },
      ]);
      expect(state.UpdatedAt).toBe(FAKE_NOW);
    });

    it("transitions PENDING to IN_PROGRESS", () => {
      const state = foldEvents([
        createTextMessageStartEvent({ messageId: "msg-1", role: "user" }),
      ]);

      expect(state.Status).toBe("IN_PROGRESS");
      expect(state.StartedAt).toBe(1500);
    });

    it("deduplicates by messageId", () => {
      const state = foldEvents([
        createRunStartedEvent(),
        createTextMessageStartEvent({ messageId: "msg-1", role: "user" }),
        createTextMessageStartEvent(
          { messageId: "msg-1", role: "user" },
          { id: "event-tms-dup" },
        ),
      ]);

      expect(state.Messages).toHaveLength(1);
    });

    it("accumulates multiple messages in order", () => {
      const state = foldEvents([
        createRunStartedEvent(),
        createTextMessageStartEvent(
          { messageId: "msg-1", role: "user" },
          { id: "event-tms-1", occurredAt: 1500 },
        ),
        createTextMessageStartEvent(
          { messageId: "msg-2", role: "assistant" },
          { id: "event-tms-2", occurredAt: 1600 },
        ),
      ]);

      expect(state.Messages).toHaveLength(2);
      expect(state.Messages[0]!.Id).toBe("msg-1");
      expect(state.Messages[1]!.Id).toBe("msg-2");
    });
  });

  describe("when TextMessageEnd event is applied", () => {
    it("completes a placeholder from START", () => {
      const state = foldEvents([
        createRunStartedEvent(),
        createTextMessageStartEvent({ messageId: "msg-1", role: "user" }),
        createTextMessageEndEvent({
          messageId: "msg-1",
          role: "user",
          content: "hello world",
          traceId: "trace-abc",
        }),
      ]);

      expect(state.Messages).toEqual([
        { Id: "msg-1", Role: "user", Content: "hello world", TraceId: "trace-abc", Rest: "" },
      ]);
      expect(state.TraceIds).toEqual(["trace-abc"]);
    });

    it("handles missing START (out-of-order) by appending directly", () => {
      const state = foldEvents([
        createRunStartedEvent(),
        createTextMessageEndEvent({
          messageId: "msg-1",
          role: "user",
          content: "hello",
        }),
      ]);

      expect(state.Messages).toHaveLength(1);
      expect(state.Messages[0]!.Content).toBe("hello");
    });

    it("accumulates traceId without duplicates", () => {
      const state = foldEvents([
        createRunStartedEvent(),
        createTextMessageEndEvent(
          { messageId: "msg-1", role: "user", content: "hello", traceId: "trace-1" },
          { id: "event-tme-1", occurredAt: 1500 },
        ),
        createTextMessageEndEvent(
          { messageId: "msg-2", role: "assistant", content: "hi", traceId: "trace-1" },
          { id: "event-tme-2", occurredAt: 1600 },
        ),
      ]);

      // trace-1 should not be duplicated
      expect(state.TraceIds).toEqual(["trace-1"]);
    });

    it("builds Rest from extra message fields", () => {
      const state = foldEvents([
        createRunStartedEvent(),
        createTextMessageEndEvent({
          messageId: "msg-1",
          role: "assistant",
          content: "hi",
          message: { id: "msg-1", role: "assistant", content: "hi", toolCalls: [{ id: "tc1" }] },
        }),
      ]);

      expect(state.Messages[0]!.Rest).toContain("toolCalls");
    });
  });

  describe("when START→END lifecycle", () => {
    it("tracks a full message lifecycle", () => {
      const state = foldEvents([
        createRunStartedEvent(),
        createTextMessageStartEvent(
          { messageId: "msg-1", role: "user" },
          { id: "e1", occurredAt: 1500 },
        ),
        createTextMessageEndEvent(
          { messageId: "msg-1", role: "user", content: "hello", traceId: "t1" },
          { id: "e2", occurredAt: 2000 },
        ),
        createTextMessageStartEvent(
          { messageId: "msg-2", role: "assistant" },
          { id: "e3", occurredAt: 2100 },
        ),
        createTextMessageEndEvent(
          { messageId: "msg-2", role: "assistant", content: "hi back", traceId: "t2" },
          { id: "e4", occurredAt: 2500 },
        ),
      ]);

      expect(state.Messages).toHaveLength(2);
      expect(state.Messages[0]).toEqual({ Id: "msg-1", Role: "user", Content: "hello", TraceId: "t1", Rest: "" });
      expect(state.Messages[1]).toEqual({ Id: "msg-2", Role: "assistant", Content: "hi back", TraceId: "t2", Rest: "" });
      expect(state.TraceIds).toEqual(["t1", "t2"]);
    });
  });

  describe("when snapshot arrives after START/END", () => {
    it("snapshot overwrites all messages (snapshot wins)", () => {
      const state = foldEvents([
        createRunStartedEvent(),
        createTextMessageStartEvent(
          { messageId: "msg-1", role: "user" },
          { id: "e1", occurredAt: 1500 },
        ),
        createTextMessageEndEvent(
          { messageId: "msg-1", role: "user", content: "hello" },
          { id: "e2", occurredAt: 2000 },
        ),
        createMessageSnapshotEvent(
          {
            messages: [
              { role: "user", content: "snapshot-msg" },
              { role: "assistant", content: "snapshot-reply" },
            ],
            traceIds: ["snap-trace"],
          },
          { id: "e3", occurredAt: 3000, createdAt: 3000 },
        ),
      ]);

      // Snapshot replaces everything
      expect(state.Messages).toEqual([
        { Id: "", Role: "user", Content: "snapshot-msg", TraceId: "", Rest: "" },
        { Id: "", Role: "assistant", Content: "snapshot-reply", TraceId: "", Rest: "" },
      ]);
      expect(state.TraceIds).toEqual(["snap-trace"]);
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
