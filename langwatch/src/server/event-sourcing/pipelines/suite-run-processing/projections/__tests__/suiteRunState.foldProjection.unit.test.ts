import { describe, expect, it } from "vitest";
import { createTenantId } from "../../../../domain/tenantId";
import type { FoldProjectionStore } from "../../../../projections/foldProjection.types";
import {
  SUITE_RUN_EVENT_TYPES,
  SUITE_RUN_EVENT_VERSIONS,
} from "../../schemas/constants";
import type {
  SuiteRunStartedEvent,
  SuiteRunItemStartedEvent,
  SuiteRunItemCompletedEvent,
} from "../../schemas/events";
import {
  SuiteRunStateFoldProjection,
  type SuiteRunStateData,
} from "../suiteRunState.foldProjection";

const noopStore: FoldProjectionStore<SuiteRunStateData> = {
  store: async () => {},
  get: async () => null,
};
const projection = new SuiteRunStateFoldProjection({ store: noopStore });

const TEST_TENANT_ID = createTenantId("tenant-1");

function createStartedEvent(
  overrides: Partial<SuiteRunStartedEvent["data"]> = {},
): SuiteRunStartedEvent {
  return {
    id: "event-1",
    aggregateId: "batch-1",
    aggregateType: "suite_run",
    tenantId: TEST_TENANT_ID,
    createdAt: 1000,
    occurredAt: 1000,
    type: SUITE_RUN_EVENT_TYPES.STARTED,
    version: SUITE_RUN_EVENT_VERSIONS.STARTED,
    data: {
      batchRunId: "batch-1",
      scenarioSetId: "set-1",
      suiteId: "suite-1",
      total: 5,
      scenarioIds: ["s1", "s2", "s3", "s4", "s5"],
      targetIds: ["t1"],
      ...overrides,
    },
  };
}

function createItemStartedEvent(
  overrides: Partial<SuiteRunItemStartedEvent["data"]> = {},
): SuiteRunItemStartedEvent {
  return {
    id: "event-2",
    aggregateId: "batch-1",
    aggregateType: "suite_run",
    tenantId: TEST_TENANT_ID,
    createdAt: 2000,
    occurredAt: 2000,
    type: SUITE_RUN_EVENT_TYPES.ITEM_STARTED,
    version: SUITE_RUN_EVENT_VERSIONS.ITEM_STARTED,
    data: {
      batchRunId: "batch-1",
      scenarioRunId: "run-1",
      scenarioId: "s1",
      ...overrides,
    },
  };
}

function createItemCompletedEvent(
  overrides: Partial<SuiteRunItemCompletedEvent["data"]> = {},
): SuiteRunItemCompletedEvent {
  return {
    id: "event-4",
    aggregateId: "batch-1",
    aggregateType: "suite_run",
    tenantId: TEST_TENANT_ID,
    createdAt: 4000,
    occurredAt: 4000,
    type: SUITE_RUN_EVENT_TYPES.ITEM_COMPLETED,
    version: SUITE_RUN_EVENT_VERSIONS.ITEM_COMPLETED,
    data: {
      batchRunId: "batch-1",
      scenarioRunId: "run-1",
      scenarioId: "s1",
      status: "SUCCESS",
      verdict: "success",
      durationMs: 1500,
      ...overrides,
    },
  };
}

describe("suiteRunState fold projection", () => {
  describe("when applying STARTED event", () => {
    it("sets IDs, total, and status to IN_PROGRESS", () => {
      const state = projection.init();
      const result = projection.apply(state, createStartedEvent());

      expect(result.BatchRunId).toBe("batch-1");
      expect(result.ScenarioSetId).toBe("set-1");
      expect(result.SuiteId).toBe("suite-1");
      expect(result.Total).toBe(5);
      expect(result.Status).toBe("IN_PROGRESS");
      expect(result.StartedAt).toBe(1000);
    });
  });

  describe("when applying ITEM_STARTED event", () => {
    it("increments StartedCount", () => {
      let state = projection.init();
      state = projection.apply(state, createStartedEvent());
      state = projection.apply(state, createItemStartedEvent());

      expect(state.StartedCount).toBe(1);
    });
  });

  describe("when applying ITEM_COMPLETED event", () => {
    it("increments CompletedCount for SUCCESS status", () => {
      let state = projection.init();
      state = projection.apply(state, createStartedEvent({ total: 3 }));
      state = projection.apply(state, createItemCompletedEvent({ status: "SUCCESS" }));

      expect(state.CompletedCount).toBe(1);
      expect(state.FailedCount).toBe(0);
      expect(state.Progress).toBe(1);
    });

    it("increments FailedCount for FAILURE status", () => {
      let state = projection.init();
      state = projection.apply(state, createStartedEvent({ total: 3 }));
      state = projection.apply(state, createItemCompletedEvent({ status: "FAILURE" }));

      expect(state.CompletedCount).toBe(0);
      expect(state.FailedCount).toBe(1);
      expect(state.Progress).toBe(1);
    });

    it("increments FailedCount for ERROR status", () => {
      let state = projection.init();
      state = projection.apply(state, createStartedEvent({ total: 3 }));
      state = projection.apply(state, createItemCompletedEvent({ status: "ERROR" }));

      expect(state.FailedCount).toBe(1);
    });

    it("computes PassRateBps from verdict", () => {
      let state = projection.init();
      state = projection.apply(state, createStartedEvent({ total: 3 }));
      state = projection.apply(state, createItemCompletedEvent({
        scenarioRunId: "run-1",
        status: "SUCCESS",
        verdict: "success",
      }));
      state = projection.apply(state, createItemCompletedEvent({
        scenarioRunId: "run-2",
        status: "SUCCESS",
        verdict: "failure",
      }));

      expect(state.PassedCount).toBe(1);
      expect(state.GradedCount).toBe(2);
      expect(state.PassRateBps).toBe(5000); // 50%
    });

    it("sets PassRateBps to null when no verdicts", () => {
      let state = projection.init();
      state = projection.apply(state, createStartedEvent({ total: 1 }));
      state = projection.apply(state, createItemCompletedEvent({
        status: "SUCCESS",
        verdict: undefined,
      }));

      expect(state.PassRateBps).toBeNull();
    });

    it("derives final status SUCCESS when all items pass", () => {
      let state = projection.init();
      state = projection.apply(state, createStartedEvent({ total: 2 }));
      state = projection.apply(state, createItemCompletedEvent({
        scenarioRunId: "run-1",
        status: "SUCCESS",
      }));
      state = projection.apply(state, createItemCompletedEvent({
        scenarioRunId: "run-2",
        status: "SUCCESS",
      }));

      expect(state.Status).toBe("SUCCESS");
      expect(state.FinishedAt).toBe(4000);
    });

    it("derives final status FAILURE when any item fails", () => {
      let state = projection.init();
      state = projection.apply(state, createStartedEvent({ total: 2 }));
      state = projection.apply(state, createItemCompletedEvent({
        scenarioRunId: "run-1",
        status: "SUCCESS",
      }));
      state = projection.apply(state, createItemCompletedEvent({
        scenarioRunId: "run-2",
        status: "FAILURE",
      }));

      expect(state.Status).toBe("FAILURE");
      expect(state.FinishedAt).toBe(4000);
    });

    it("stays IN_PROGRESS when not all items are done", () => {
      let state = projection.init();
      state = projection.apply(state, createStartedEvent({ total: 3 }));
      state = projection.apply(state, createItemCompletedEvent({
        status: "SUCCESS",
      }));

      expect(state.Status).toBe("IN_PROGRESS");
      expect(state.FinishedAt).toBeNull();
    });
  });
});
