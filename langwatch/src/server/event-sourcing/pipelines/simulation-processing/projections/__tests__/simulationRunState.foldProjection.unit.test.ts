import { describe, expect, it } from "vitest";
import {
  simulationRunStateFoldProjection,
  type SimulationRunStateData,
} from "../simulationRunState.foldProjection";
import type {
  SimulationRunStartedEvent,
  SimulationMessageSnapshotEvent,
  SimulationRunFinishedEvent,
  SimulationProcessingEvent,
} from "../../schemas/events";
import { SIMULATION_EVENT_TYPES } from "../../schemas/constants";
import { createTenantId } from "../../../../library/domain/tenantId";

function createInitState(): SimulationRunStateData {
  return simulationRunStateFoldProjection.init();
}

function createBaseEvent() {
  return {
    id: "evt-1",
    aggregateId: "agg-1",
    aggregateType: "simulation_run" as const,
    tenantId: createTenantId("tenant-1"),
    timestamp: 1700000000000,
    occurredAt: 1700000000000,
    version: "2026-02-01",
  };
}

function createStartedEvent(
  overrides: Partial<SimulationRunStartedEvent["data"]> = {},
): SimulationRunStartedEvent {
  return {
    ...createBaseEvent(),
    type: SIMULATION_EVENT_TYPES.RUN_STARTED,
    data: {
      scenarioRunId: "run-1",
      scenarioId: "scenario-1",
      batchRunId: "batch-1",
      scenarioSetId: "set-1",
      metadata: { name: "Test Run", description: "A test" },
      ...overrides,
    },
  };
}

function createMessageSnapshotEvent(
  messages: SimulationMessageSnapshotEvent["data"]["messages"],
): SimulationMessageSnapshotEvent {
  return {
    ...createBaseEvent(),
    timestamp: 1700000001000,
    type: SIMULATION_EVENT_TYPES.MESSAGE_SNAPSHOT,
    data: {
      scenarioRunId: "run-1",
      scenarioId: "scenario-1",
      batchRunId: "batch-1",
      scenarioSetId: "set-1",
      messages,
    },
  };
}

function createFinishedEvent(
  overrides: Partial<SimulationRunFinishedEvent["data"]> = {},
): SimulationRunFinishedEvent {
  return {
    ...createBaseEvent(),
    timestamp: 1700000005000,
    type: SIMULATION_EVENT_TYPES.RUN_FINISHED,
    data: {
      scenarioRunId: "run-1",
      scenarioId: "scenario-1",
      batchRunId: "batch-1",
      scenarioSetId: "set-1",
      status: "SUCCESS",
      results: {
        verdict: "success",
        reasoning: "All good",
        metCriteria: ["criterion-1"],
        unmetCriteria: [],
      },
      ...overrides,
    },
  };
}

const { init, apply } = simulationRunStateFoldProjection;

describe("simulationRunStateFoldProjection", () => {
  describe("init()", () => {
    it("returns IN_PROGRESS status", () => {
      expect(init().Status).toBe("IN_PROGRESS");
    });

    it("returns empty JSON arrays for collection fields", () => {
      const state = init();
      expect(state.Messages).toBe("[]");
      expect(state.TraceIds).toBe("[]");
      expect(state.MetCriteria).toBe("[]");
      expect(state.UnmetCriteria).toBe("[]");
    });

    it("returns zero timestamps", () => {
      const state = init();
      expect(state.CreatedAt).toBe(0);
      expect(state.UpdatedAt).toBe(0);
    });

    it("returns null for optional fields", () => {
      const state = init();
      expect(state.Name).toBeNull();
      expect(state.Description).toBeNull();
      expect(state.Verdict).toBeNull();
      expect(state.Reasoning).toBeNull();
      expect(state.Error).toBeNull();
      expect(state.DurationMs).toBeNull();
      expect(state.FinishedAt).toBeNull();
    });
  });

  describe("apply()", () => {
    describe("when applying SimulationRunStartedEvent", () => {
      it("sets IDs, name, description, and timestamps", () => {
        const state = apply(createInitState(), createStartedEvent());

        expect(state.ScenarioRunId).toBe("run-1");
        expect(state.ScenarioId).toBe("scenario-1");
        expect(state.BatchRunId).toBe("batch-1");
        expect(state.ScenarioSetId).toBe("set-1");
        expect(state.Name).toBe("Test Run");
        expect(state.Description).toBe("A test");
        expect(state.CreatedAt).toBe(1700000000000);
        expect(state.UpdatedAt).toBe(1700000000000);
      });

      it("defaults name and description to null when metadata omits them", () => {
        const event = createStartedEvent({ metadata: {} });
        const state = apply(createInitState(), event);

        expect(state.Name).toBeNull();
        expect(state.Description).toBeNull();
      });
    });

    describe("when applying SimulationMessageSnapshotEvent", () => {
      it("overwrites Messages with latest snapshot", () => {
        const messages = [
          { role: "user", content: "hello", trace_id: "t-1" },
          { role: "assistant", content: "hi", trace_id: "t-2" },
        ];
        const state = apply(
          createInitState(),
          createMessageSnapshotEvent(messages),
        );

        expect(JSON.parse(state.Messages)).toEqual(messages);
      });

      it("extracts and deduplicates trace IDs", () => {
        const messages = [
          { trace_id: "t-1" },
          { trace_id: "t-2" },
          { trace_id: "t-1" },
        ];
        const state = apply(
          createInitState(),
          createMessageSnapshotEvent(messages),
        );

        expect(JSON.parse(state.TraceIds)).toEqual(["t-1", "t-2"]);
      });

      it("filters out messages without trace_id", () => {
        const messages = [
          { trace_id: "t-1" },
          { content: "no trace" },
          { trace_id: "t-2" },
        ];
        const state = apply(
          createInitState(),
          createMessageSnapshotEvent(messages),
        );

        expect(JSON.parse(state.TraceIds)).toEqual(["t-1", "t-2"]);
      });

      it("updates UpdatedAt timestamp", () => {
        const state = apply(
          createInitState(),
          createMessageSnapshotEvent([]),
        );

        expect(state.UpdatedAt).toBe(1700000001000);
      });
    });

    describe("when applying SimulationRunFinishedEvent", () => {
      it("sets status, verdict, reasoning, and criteria", () => {
        const started = apply(createInitState(), createStartedEvent());
        const state = apply(started, createFinishedEvent());

        expect(state.Status).toBe("SUCCESS");
        expect(state.Verdict).toBe("success");
        expect(state.Reasoning).toBe("All good");
        expect(JSON.parse(state.MetCriteria)).toEqual(["criterion-1"]);
        expect(JSON.parse(state.UnmetCriteria)).toEqual([]);
      });

      it("calculates DurationMs from CreatedAt", () => {
        const started = apply(createInitState(), createStartedEvent());
        const state = apply(started, createFinishedEvent());

        // 1700000005000 - 1700000000000 = 5000
        expect(state.DurationMs).toBe(5000);
      });

      it("sets DurationMs to null when CreatedAt is 0 (no start event)", () => {
        const state = apply(createInitState(), createFinishedEvent());

        expect(state.DurationMs).toBeNull();
      });

      it("sets FinishedAt and UpdatedAt timestamps", () => {
        const state = apply(createInitState(), createFinishedEvent());

        expect(state.FinishedAt).toBe(1700000005000);
        expect(state.UpdatedAt).toBe(1700000005000);
      });

      it("defaults results fields when results is null", () => {
        const state = apply(
          createInitState(),
          createFinishedEvent({ results: null }),
        );

        expect(state.Verdict).toBeNull();
        expect(state.Reasoning).toBeNull();
        expect(JSON.parse(state.MetCriteria)).toEqual([]);
        expect(JSON.parse(state.UnmetCriteria)).toEqual([]);
        expect(state.Error).toBeNull();
      });

      it("defaults results fields when results is undefined", () => {
        const state = apply(
          createInitState(),
          createFinishedEvent({ results: undefined }),
        );

        expect(state.Verdict).toBeNull();
        expect(state.Reasoning).toBeNull();
        expect(JSON.parse(state.MetCriteria)).toEqual([]);
        expect(JSON.parse(state.UnmetCriteria)).toEqual([]);
        expect(state.Error).toBeNull();
      });
    });

    describe("when applying unknown event type", () => {
      it("returns state unchanged", () => {
        const initial = createInitState();
        const unknownEvent = {
          ...createBaseEvent(),
          type: "lw.simulation.unknown_event",
          data: {},
        } as unknown as SimulationProcessingEvent;

        const state = apply(initial, unknownEvent);

        expect(state).toBe(initial);
      });
    });
  });
});
