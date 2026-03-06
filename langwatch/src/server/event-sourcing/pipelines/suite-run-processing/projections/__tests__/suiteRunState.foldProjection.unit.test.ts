import { describe, it, expect } from "vitest";
import {
  createSuiteRunStateFoldProjection,
  type SuiteRunStateData,
} from "../suiteRunState.foldProjection";
import type { SuiteRunProcessingEvent } from "../../schemas/events";
import { SUITE_RUN_EVENT_TYPES, SUITE_RUN_EVENT_VERSIONS } from "../../schemas/constants";

function makeStartedEvent(overrides: Partial<SuiteRunProcessingEvent> = {}): SuiteRunProcessingEvent {
  return {
    id: "evt-1",
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
      scenarioIds: ["s1", "s2"],
      targets: [{ id: "t1", type: "http" }],
      repeatCount: 1,
    },
    ...overrides,
  } as SuiteRunProcessingEvent;
}

function makeScenarioResultEvent(
  status: string,
  overrides: Partial<Record<string, unknown>> = {},
): SuiteRunProcessingEvent {
  return {
    id: "evt-2",
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
      verdict: null,
      durationMs: 100,
      batchRunId: "batch1",
      ...overrides,
    },
  } as SuiteRunProcessingEvent;
}

function makeCompletedEvent(): SuiteRunProcessingEvent {
  return {
    id: "evt-3",
    aggregateId: "suite1:batch1",
    aggregateType: "suite_run",
    tenantId: "tenant-1",
    createdAt: 3000,
    occurredAt: 3000,
    type: SUITE_RUN_EVENT_TYPES.COMPLETED,
    version: SUITE_RUN_EVENT_VERSIONS.COMPLETED,
    data: {
      finishedAt: 3000,
    },
  } as SuiteRunProcessingEvent;
}

describe("suiteRunState fold projection", () => {
  const dummyStore = {
    store: async () => {},
    get: async () => null,
  };

  const projection = createSuiteRunStateFoldProjection({ store: dummyStore });

  describe("when applying SuiteRunStartedEvent", () => {
    it("sets suite metadata and status to IN_PROGRESS", () => {
      const state = projection.init();
      const result = projection.apply(state, makeStartedEvent());

      expect(result.SuiteId).toBe("suite1");
      expect(result.BatchRunId).toBe("batch1");
      expect(result.SetId).toBe("set1");
      expect(result.Total).toBe(5);
      expect(result.Status).toBe("IN_PROGRESS");
      expect(result.StartedAt).toBe(1000);
      expect(result.ScenarioIds).toBe('["s1","s2"]');
      expect(result.Targets).toBe('[{"id":"t1","type":"http"}]');
      expect(result.RepeatCount).toBe(1);
    });
  });

  describe("when applying SuiteRunScenarioResultEvent", () => {
    it("increments CompletedCount for SUCCESS status", () => {
      const state = projection.apply(projection.init(), makeStartedEvent());
      const result = projection.apply(state, makeScenarioResultEvent("SUCCESS"));

      expect(result.CompletedCount).toBe(1);
      expect(result.FailedCount).toBe(0);
      expect(result.Progress).toBe(1);
    });

    it("increments FailedCount for FAILURE status", () => {
      const state = projection.apply(projection.init(), makeStartedEvent());
      const result = projection.apply(state, makeScenarioResultEvent("FAILURE"));

      expect(result.FailedCount).toBe(1);
      expect(result.CompletedCount).toBe(0);
      expect(result.Progress).toBe(1);
    });

    it("increments ErroredCount for ERROR status", () => {
      const state = projection.apply(projection.init(), makeStartedEvent());
      const result = projection.apply(state, makeScenarioResultEvent("ERROR"));

      expect(result.ErroredCount).toBe(1);
      expect(result.Progress).toBe(1);
    });

    it("increments CancelledCount for CANCELLED status", () => {
      const state = projection.apply(projection.init(), makeStartedEvent());
      const result = projection.apply(state, makeScenarioResultEvent("CANCELLED"));

      expect(result.CancelledCount).toBe(1);
      expect(result.Progress).toBe(1);
    });

    it("calculates PassRateBps correctly", () => {
      let state = projection.apply(projection.init(), makeStartedEvent());
      state = projection.apply(state, makeScenarioResultEvent("SUCCESS"));
      state = projection.apply(state, makeScenarioResultEvent("FAILURE"));

      // 1 success / (1 success + 1 failure) = 50% = 5000 bps
      expect(state.PassRateBps).toBe(5000);
    });

    it("returns null PassRateBps when no graded results", () => {
      let state = projection.apply(projection.init(), makeStartedEvent());
      state = projection.apply(state, makeScenarioResultEvent("ERROR"));

      expect(state.PassRateBps).toBeNull();
    });
  });

  describe("when auto-completing", () => {
    it("sets Status to COMPLETED when Progress equals Total", () => {
      const startedEvent = makeStartedEvent();
      (startedEvent.data as { total: number }).total = 2;
      let state = projection.apply(projection.init(), startedEvent);

      state = projection.apply(state, makeScenarioResultEvent("SUCCESS"));
      expect(state.Status).toBe("IN_PROGRESS");

      state = projection.apply(state, makeScenarioResultEvent("FAILURE"));
      expect(state.Status).toBe("COMPLETED");
      expect(state.FinishedAt).toBeDefined();
      expect(state.FinishedAt).not.toBeNull();
    });

    it("does not auto-complete when Progress is less than Total", () => {
      let state = projection.apply(projection.init(), makeStartedEvent());
      state = projection.apply(state, makeScenarioResultEvent("SUCCESS"));

      expect(state.Progress).toBe(1);
      expect(state.Total).toBe(5);
      expect(state.Status).toBe("IN_PROGRESS");
    });
  });

  describe("when applying SuiteRunCompletedEvent", () => {
    it("forces Status to COMPLETED", () => {
      let state = projection.apply(projection.init(), makeStartedEvent());
      state = projection.apply(state, makeCompletedEvent());

      expect(state.Status).toBe("COMPLETED");
      expect(state.FinishedAt).toBe(3000);
    });
  });
});
