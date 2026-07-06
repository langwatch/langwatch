import { describe, expect, it } from "vitest";
import type {
  SimulationRunFinishedEvent,
  SimulationRunMetricsComputedEvent,
  SimulationRunQueuedEvent,
  SimulationRunStartedEvent,
} from "../../schemas/events";
import {
  projectSimulationAnalyticsStateToRow,
  SIMULATION_ANALYTICS_PROJECTION_VERSION_LATEST,
  SimulationAnalyticsFoldProjection,
} from "../simulationAnalytics.foldProjection";

/**
 * ADR-034 Phase 7 — slim scenario fold unit tests.
 */

const TENANT = "proj-sim";

function makeQueued(): SimulationRunQueuedEvent {
  return {
    type: "lw.simulation_run.queued",
    id: "evt-q",
    tenantId: TENANT,
    aggregateId: "run-1",
    occurredAt: 1_000,
    data: {
      scenarioRunId: "run-1",
      scenarioId: "scn-1",
      batchRunId: "batch-1",
      scenarioSetId: "set-1",
    },
    metadata: { foo: "bar", n: 42 },
  } as unknown as SimulationRunQueuedEvent;
}

function makeStarted(): SimulationRunStartedEvent {
  return {
    type: "lw.simulation_run.started",
    id: "evt-s",
    tenantId: TENANT,
    aggregateId: "run-1",
    occurredAt: 2_000,
    data: {
      scenarioRunId: "run-1",
      scenarioId: "scn-1",
      batchRunId: "batch-1",
      scenarioSetId: "set-1",
    },
  } as unknown as SimulationRunStartedEvent;
}

function makeMetricsComputed(
  traceId: string,
  totalCost: number,
): SimulationRunMetricsComputedEvent {
  return {
    type: "lw.simulation_run.metrics_computed",
    id: `evt-mc-${traceId}`,
    tenantId: TENANT,
    aggregateId: "run-1",
    occurredAt: 2_500,
    data: {
      scenarioRunId: "run-1",
      traceId,
      totalCost,
      roleCosts: {},
      roleLatencies: {},
    },
  } as unknown as SimulationRunMetricsComputedEvent;
}

function makeFinished(
  verdict: string | undefined,
  durationMs: number,
): SimulationRunFinishedEvent {
  return {
    type: "lw.simulation_run.finished",
    id: "evt-f",
    tenantId: TENANT,
    aggregateId: "run-1",
    occurredAt: 3_000,
    data: {
      scenarioRunId: "run-1",
      durationMs,
      results: verdict ? { verdict } : undefined,
    },
  } as unknown as SimulationRunFinishedEvent;
}

describe("SimulationAnalyticsFoldProjection", () => {
  describe("given a queued → started → finished(success) event stream", () => {
    it("hoists dimensions onto root columns and stamps SUCCESS status", () => {
      const slim = new SimulationAnalyticsFoldProjection({
        store: { store: async () => {}, get: async () => null },
      });
      let state = slim.init();
      state = slim.handleSimulationRunQueued(makeQueued(), state);
      state = slim.handleSimulationRunStarted(makeStarted(), state);
      state = slim.handleSimulationRunFinished(
        makeFinished("success", 1500),
        state,
      );

      expect(state.scenarioRunId).toBe("run-1");
      expect(state.scenarioId).toBe("scn-1");
      expect(state.batchRunId).toBe("batch-1");
      expect(state.scenarioSetId).toBe("set-1");
      expect(state.status).toBe("SUCCESS");
      expect(state.verdict).toBe("success");
      expect(state.durationMs).toBe(1500);
    });
  });

  describe("given multiple metrics_computed events for the same traceId", () => {
    it("replaces (not accumulates) the per-trace cost (legacy fold parity)", () => {
      const slim = new SimulationAnalyticsFoldProjection({
        store: { store: async () => {}, get: async () => null },
      });
      let state = slim.init();
      state = slim.handleSimulationRunMetricsComputed(
        makeMetricsComputed("trace-1", 0.5),
        state,
      );
      state = slim.handleSimulationRunMetricsComputed(
        makeMetricsComputed("trace-1", 0.8),
        state,
      );
      state = slim.handleSimulationRunMetricsComputed(
        makeMetricsComputed("trace-2", 0.2),
        state,
      );

      expect(state.totalCost).toBeCloseTo(1.0, 5);
    });
  });

  describe("when projected to a row", () => {
    it("trims event metadata into the Attributes map", () => {
      const slim = new SimulationAnalyticsFoldProjection({
        store: { store: async () => {}, get: async () => null },
      });
      let state = slim.init();
      state = slim.handleSimulationRunQueued(makeQueued(), state);
      state = {
        ...state,
        LastEventOccurredAt: 1234,
        createdAt: 1234,
        updatedAt: 1234,
      };
      const row = projectSimulationAnalyticsStateToRow({
        state,
        tenantId: TENANT,
        version: SIMULATION_ANALYTICS_PROJECTION_VERSION_LATEST,
      });
      // foo + n hoisted into attributes — trim service keeps both (short).
      expect(row.attributes.foo).toBe("bar");
      expect(row.attributes.n).toBe("42");
      expect(row.scenarioId).toBe("scn-1");
    });
  });
});
