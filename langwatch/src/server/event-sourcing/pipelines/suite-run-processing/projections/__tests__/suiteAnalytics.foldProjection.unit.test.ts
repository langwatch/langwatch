import { describe, expect, it } from "vitest";
import {
  projectSuiteAnalyticsStateToRow,
  SuiteAnalyticsFoldProjection,
  SUITE_ANALYTICS_PROJECTION_VERSION_LATEST,
} from "../suiteAnalytics.foldProjection";
import type {
  SuiteRunItemCompletedEvent,
  SuiteRunItemStartedEvent,
  SuiteRunStartedEvent,
} from "../../schemas/events";

const TENANT = "proj-suite";

function makeStarted(total: number): SuiteRunStartedEvent {
  return {
    type: "lw.suite_run.started",
    id: "evt-s",
    tenantId: TENANT,
    aggregateId: "suite-run-1",
    occurredAt: 1_000,
    data: {
      batchRunId: "batch-1",
      scenarioSetId: "set-1",
      suiteId: "suite-1",
      total,
      scenarioIds: [],
      targetIds: [],
    },
  } as unknown as SuiteRunStartedEvent;
}

function makeItemStarted(): SuiteRunItemStartedEvent {
  return {
    type: "lw.suite_run.item_started",
    id: `evt-is-${Math.random()}`,
    tenantId: TENANT,
    aggregateId: "suite-run-1",
    occurredAt: 1_500,
    data: {
      batchRunId: "batch-1",
      scenarioRunId: "scn-run-1",
      scenarioId: "scn-1",
    },
  } as unknown as SuiteRunItemStartedEvent;
}

function makeItemCompleted({
  status,
  verdict,
}: {
  status: string;
  verdict?: string;
}): SuiteRunItemCompletedEvent {
  return {
    type: "lw.suite_run.item_completed",
    id: `evt-ic-${Math.random()}`,
    tenantId: TENANT,
    aggregateId: "suite-run-1",
    occurredAt: 2_000,
    data: {
      batchRunId: "batch-1",
      scenarioRunId: "scn-run-1",
      scenarioId: "scn-1",
      status,
      verdict,
    },
  } as unknown as SuiteRunItemCompletedEvent;
}

describe("SuiteAnalyticsFoldProjection", () => {
  describe("given start + 2 success items + 1 failure (total=3)", () => {
    it("rolls into FAILURE status with PassRateBps reflecting graded items", () => {
      const slim = new SuiteAnalyticsFoldProjection({
        store: { store: async () => {}, get: async () => null },
      });
      let state = slim.init();
      state = slim.handleSuiteRunStarted(makeStarted(3), state);
      state = slim.handleSuiteRunItemCompleted(
        makeItemCompleted({ status: "SUCCESS", verdict: "success" }),
        state,
      );
      state = slim.handleSuiteRunItemCompleted(
        makeItemCompleted({ status: "SUCCESS", verdict: "success" }),
        state,
      );
      state = slim.handleSuiteRunItemCompleted(
        makeItemCompleted({ status: "FAILURE", verdict: "failure" }),
        state,
      );

      expect(state.batchRunId).toBe("batch-1");
      expect(state.scenarioSetId).toBe("set-1");
      expect(state.suiteId).toBe("suite-1");
      expect(state.total).toBe(3);
      expect(state.progress).toBe(3);
      expect(state.completedCount).toBe(2);
      expect(state.failedCount).toBe(1);
      expect(state.status).toBe("FAILURE");
      // 2 / 3 graded passed = 6666 bps
      expect(state.passRateBps).toBe(6667);
    });
  });

  describe("given all 2 items pass (total=2)", () => {
    it("rolls into SUCCESS status with PassRateBps=10000", () => {
      const slim = new SuiteAnalyticsFoldProjection({
        store: { store: async () => {}, get: async () => null },
      });
      let state = slim.init();
      state = slim.handleSuiteRunStarted(makeStarted(2), state);
      state = slim.handleSuiteRunItemCompleted(
        makeItemCompleted({ status: "SUCCESS", verdict: "success" }),
        state,
      );
      state = slim.handleSuiteRunItemCompleted(
        makeItemCompleted({ status: "SUCCESS", verdict: "success" }),
        state,
      );

      expect(state.status).toBe("SUCCESS");
      expect(state.passRateBps).toBe(10000);
    });
  });

  describe("when projected to a row before completion", () => {
    it("keeps suiteRunId, Total, Status, Attributes (empty)", () => {
      const slim = new SuiteAnalyticsFoldProjection({
        store: { store: async () => {}, get: async () => null },
      });
      let state = slim.init();
      state = slim.handleSuiteRunStarted(makeStarted(3), state);
      state = slim.handleSuiteRunItemStarted(makeItemStarted(), state);
      state = {
        ...state,
        suiteRunId: "suite-run-1",
        LastEventOccurredAt: 1_500,
        createdAt: 1_000,
        updatedAt: 1_500,
      };
      const row = projectSuiteAnalyticsStateToRow({
        state,
        tenantId: TENANT,
        version: SUITE_ANALYTICS_PROJECTION_VERSION_LATEST,
      });
      expect(row.suiteRunId).toBe("suite-run-1");
      expect(row.total).toBe(3);
      expect(row.status).toBe("IN_PROGRESS");
    });
  });
});
