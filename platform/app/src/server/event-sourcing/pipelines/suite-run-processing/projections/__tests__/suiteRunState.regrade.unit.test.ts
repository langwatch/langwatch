import { describe, expect, it } from "vitest";
import { createTenantId } from "../../../../domain/tenantId";
import type { FoldProjectionStore } from "../../../../projections/foldProjection.types";
import {
  SUITE_RUN_EVENT_TYPES,
  SUITE_RUN_EVENT_VERSIONS,
} from "../../schemas/constants";
import type {
  SuiteRunItemCompletedEvent,
  SuiteRunItemRegradedEvent,
  SuiteRunProcessingEvent,
  SuiteRunStartedEvent,
} from "../../schemas/events";
import {
  type SuiteRunStateData,
  SuiteRunStateFoldProjection,
} from "../suiteRunState.foldProjection";

const noopStore: FoldProjectionStore<SuiteRunStateData> = {
  store: async () => {},
  get: async () => null,
};
const projection = new SuiteRunStateFoldProjection({ store: noopStore });

const TENANT_ID = createTenantId("tenant-1");

function startedEvent(total: number): SuiteRunStartedEvent {
  return {
    id: "event-1",
    aggregateId: "batch-1",
    aggregateType: "suite_run",
    tenantId: TENANT_ID,
    createdAt: 1000,
    occurredAt: 1000,
    type: SUITE_RUN_EVENT_TYPES.STARTED,
    version: SUITE_RUN_EVENT_VERSIONS.STARTED,
    data: {
      batchRunId: "batch-1",
      scenarioSetId: "set-1",
      suiteId: "suite-1",
      total,
      scenarioIds: ["s1", "s2"],
      targetIds: ["t1"],
    },
  };
}

function completedEvent(
  scenarioRunId: string,
  data: Partial<SuiteRunItemCompletedEvent["data"]> = {},
): SuiteRunItemCompletedEvent {
  return {
    id: `completed-${scenarioRunId}`,
    aggregateId: "batch-1",
    aggregateType: "suite_run",
    tenantId: TENANT_ID,
    createdAt: 4000,
    occurredAt: 4000,
    type: SUITE_RUN_EVENT_TYPES.ITEM_COMPLETED,
    version: SUITE_RUN_EVENT_VERSIONS.ITEM_COMPLETED,
    data: {
      batchRunId: "batch-1",
      scenarioRunId,
      scenarioId: "s1",
      status: "SUCCESS",
      verdict: "success",
      ...data,
    },
  };
}

function regradedEvent(
  data: Partial<SuiteRunItemRegradedEvent["data"]> = {},
): SuiteRunItemRegradedEvent {
  return {
    id: "regraded-1",
    aggregateId: "batch-1",
    aggregateType: "suite_run",
    tenantId: TENANT_ID,
    createdAt: 6000,
    occurredAt: 6000,
    type: SUITE_RUN_EVENT_TYPES.ITEM_REGRADED,
    version: SUITE_RUN_EVENT_VERSIONS.ITEM_REGRADED,
    data: {
      batchRunId: "batch-1",
      scenarioRunId: "run-1",
      scenarioId: "s1",
      previousStatus: "SUCCESS",
      previousVerdict: "success",
      status: "FAILURE",
      verdict: "failure",
      ...data,
    },
  };
}

function fold(events: SuiteRunProcessingEvent[]): SuiteRunStateData {
  let state = projection.init();
  for (const event of events) {
    state = projection.apply(state, event);
  }
  return state;
}

describe("suiteRunState fold projection, regrade", () => {
  describe("when a passed item is regraded to a failure after the suite run finished", () => {
    /** @scenario "A suite run recounts when an evaluated event changes the verdict" */
    it("moves the item to the failed side and the suite run to FAILURE", () => {
      const state = fold([
        startedEvent(2),
        completedEvent("run-1"),
        completedEvent("run-2"),
        regradedEvent(),
      ]);

      expect(state.CompletedCount).toBe(1);
      expect(state.FailedCount).toBe(1);
      expect(state.Progress).toBe(2);
      expect(state.GradedCount).toBe(2);
      expect(state.PassedCount).toBe(1);
      expect(state.PassRateBps).toBe(5000);
      expect(state.Status).toBe("FAILURE");
      expect(state.FinishedAt).toBe(4000);
    });
  });

  describe("when a failed item is regraded back to a pass", () => {
    it("moves it back and the suite run reads SUCCESS again", () => {
      const state = fold([
        startedEvent(1),
        completedEvent("run-1", { status: "FAILURE", verdict: "failure" }),
        regradedEvent({
          previousStatus: "FAILURE",
          previousVerdict: "failure",
          status: "SUCCESS",
          verdict: "success",
        }),
      ]);

      expect(state.CompletedCount).toBe(1);
      expect(state.FailedCount).toBe(0);
      expect(state.PassedCount).toBe(1);
      expect(state.GradedCount).toBe(1);
      expect(state.PassRateBps).toBe(10000);
      expect(state.Status).toBe("SUCCESS");
    });
  });

  describe("when the suite run is still in progress", () => {
    it("moves the counts and leaves the status alone", () => {
      const state = fold([
        startedEvent(3),
        completedEvent("run-1"),
        regradedEvent(),
      ]);

      expect(state.FailedCount).toBe(1);
      expect(state.CompletedCount).toBe(0);
      expect(state.Status).toBe("IN_PROGRESS");
      expect(state.FinishedAt).toBeNull();
    });
  });

  describe("when a regrade names a bucket the item never counted in", () => {
    it("never drives a counter below zero", () => {
      const state = fold([
        startedEvent(1),
        completedEvent("run-1", { status: "ERROR", verdict: undefined }),
        regradedEvent(),
      ]);

      expect(state.CompletedCount).toBe(0);
      expect(state.PassedCount).toBe(0);
      expect(state.FailedCount).toBeGreaterThanOrEqual(0);
      expect(state.GradedCount).toBeGreaterThanOrEqual(0);
      expect(state.Progress).toBe(state.CompletedCount + state.FailedCount);
    });
  });
});
