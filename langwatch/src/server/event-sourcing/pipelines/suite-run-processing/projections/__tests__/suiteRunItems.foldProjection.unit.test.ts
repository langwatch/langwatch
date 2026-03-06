import { describe, it, expect } from "vitest";
import {
  createSuiteRunItemsFoldProjection,
  type SuiteRunItemsData,
} from "../suiteRunItems.foldProjection";
import type { SuiteRunProcessingEvent } from "../../schemas/events";
import { SUITE_RUN_EVENT_TYPES, SUITE_RUN_EVENT_VERSIONS } from "../../schemas/constants";

function makeScenarioStartedEvent(
  overrides: Record<string, unknown> = {},
): SuiteRunProcessingEvent {
  return {
    id: "evt-started-1",
    aggregateId: "suite1:batch1",
    aggregateType: "suite_run",
    tenantId: "tenant-1",
    createdAt: 1000,
    occurredAt: 1000,
    type: SUITE_RUN_EVENT_TYPES.SCENARIO_STARTED,
    version: SUITE_RUN_EVENT_VERSIONS.SCENARIO_STARTED,
    data: {
      scenarioRunId: "sr-1",
      scenarioId: "s1",
      targetReferenceId: "t1",
      targetType: "http",
      batchRunId: "batch1",
      ...overrides,
    },
  } as SuiteRunProcessingEvent;
}

function makeScenarioResultEvent(
  status: string,
  overrides: Record<string, unknown> = {},
): SuiteRunProcessingEvent {
  return {
    id: "evt-result-1",
    aggregateId: "suite1:batch1",
    aggregateType: "suite_run",
    tenantId: "tenant-1",
    createdAt: 2000,
    occurredAt: 2000,
    type: SUITE_RUN_EVENT_TYPES.SCENARIO_RESULT,
    version: SUITE_RUN_EVENT_VERSIONS.SCENARIO_RESULT,
    data: {
      scenarioRunId: "sr-1",
      scenarioId: "s1",
      targetReferenceId: "t1",
      targetType: "http",
      status,
      verdict: "success",
      durationMs: 150,
      batchRunId: "batch1",
      ...overrides,
    },
  } as SuiteRunProcessingEvent;
}

describe("suiteRunItems fold projection", () => {
  const dummyStore = {
    store: async () => {},
    get: async () => null,
  };

  const projection = createSuiteRunItemsFoldProjection({ store: dummyStore });

  describe("when initializing", () => {
    it("returns empty items map", () => {
      const state = projection.init();
      expect(state.items).toEqual({});
    });
  });

  describe("when applying SuiteRunScenarioStartedEvent", () => {
    it("creates an IN_PROGRESS item", () => {
      const state = projection.init();
      const result = projection.apply(state, makeScenarioStartedEvent());

      expect(result.items["sr-1"]).toBeDefined();
      expect(result.items["sr-1"]!.Status).toBe("IN_PROGRESS");
      expect(result.items["sr-1"]!.ScenarioRunId).toBe("sr-1");
      expect(result.items["sr-1"]!.ScenarioId).toBe("s1");
      expect(result.items["sr-1"]!.TargetReferenceId).toBe("t1");
      expect(result.items["sr-1"]!.TargetType).toBe("http");
      expect(result.items["sr-1"]!.StartedAt).toBe(1000);
      expect(result.items["sr-1"]!.FinishedAt).toBeNull();
      expect(result.items["sr-1"]!.Verdict).toBeNull();
      expect(result.items["sr-1"]!.DurationMs).toBeNull();
    });

    it("adds multiple items for different scenarios", () => {
      let state = projection.init();
      state = projection.apply(state, makeScenarioStartedEvent());
      state = projection.apply(
        state,
        makeScenarioStartedEvent({ scenarioRunId: "sr-2", scenarioId: "s2" }),
      );

      expect(Object.keys(state.items)).toHaveLength(2);
      expect(state.items["sr-1"]).toBeDefined();
      expect(state.items["sr-2"]).toBeDefined();
    });
  });

  describe("when applying SuiteRunScenarioResultEvent", () => {
    it("updates an existing item to terminal status", () => {
      let state = projection.init();
      state = projection.apply(state, makeScenarioStartedEvent());
      state = projection.apply(state, makeScenarioResultEvent("SUCCESS"));

      const item = state.items["sr-1"]!;
      expect(item.Status).toBe("SUCCESS");
      expect(item.Verdict).toBe("success");
      expect(item.DurationMs).toBe(150);
      expect(item.FinishedAt).toBe(2000);
      expect(item.StartedAt).toBe(1000);
    });

    it("creates item from result when no prior started event", () => {
      const state = projection.init();
      const result = projection.apply(state, makeScenarioResultEvent("FAILURE"));

      const item = result.items["sr-1"]!;
      expect(item.Status).toBe("FAILURE");
      expect(item.ScenarioId).toBe("s1");
      expect(item.StartedAt).toBeNull();
      expect(item.FinishedAt).toBe(2000);
    });

    it("preserves StartedAt from prior started event", () => {
      let state = projection.init();
      state = projection.apply(state, makeScenarioStartedEvent());
      state = projection.apply(state, makeScenarioResultEvent("SUCCESS"));

      expect(state.items["sr-1"]!.StartedAt).toBe(1000);
    });
  });

  describe("when receiving unrelated events", () => {
    it("returns state unchanged for SuiteRunStartedEvent", () => {
      const state = projection.init();
      const event = {
        id: "evt-x",
        aggregateId: "suite1:batch1",
        aggregateType: "suite_run",
        tenantId: "tenant-1",
        createdAt: 1000,
        occurredAt: 1000,
        type: SUITE_RUN_EVENT_TYPES.STARTED,
        version: SUITE_RUN_EVENT_VERSIONS.STARTED,
        data: {
          suiteId: "suite1",
          batchRunId: "batch1",
          setId: "set1",
          total: 5,
          scenarioIds: [],
          targets: [],
          repeatCount: 1,
        },
      } as unknown as SuiteRunProcessingEvent;

      const result = projection.apply(state, event);
      expect(result.items).toEqual({});
    });
  });
});
