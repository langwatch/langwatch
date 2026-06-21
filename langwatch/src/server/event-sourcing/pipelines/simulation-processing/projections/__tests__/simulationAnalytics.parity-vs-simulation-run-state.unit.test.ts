import { describe, expect, it } from "vitest";
import { SimulationAnalyticsFoldProjection } from "../simulationAnalytics.foldProjection";
import { SimulationRunStateFoldProjection } from "../simulationRunState.foldProjection";
import type {
  SimulationRunFinishedEvent,
  SimulationRunMetricsComputedEvent,
  SimulationRunQueuedEvent,
  SimulationRunStartedEvent,
} from "../../schemas/events";

/**
 * ADR-034 Phase 7 parity contract — slim fold reuses the same per-event
 * semantics as `SimulationRunStateFoldProjection` for the shared fields.
 * Drives the SAME event stream through both projections and asserts shared
 * fields agree to the cent.
 */

const TENANT = "proj-sim-parity";

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

function makeFinished(verdict: string): SimulationRunFinishedEvent {
  return {
    type: "lw.simulation_run.finished",
    id: "evt-f",
    tenantId: TENANT,
    aggregateId: "run-1",
    occurredAt: 3_000,
    data: {
      scenarioRunId: "run-1",
      durationMs: 1500,
      results: { verdict },
    },
  } as unknown as SimulationRunFinishedEvent;
}

describe("simulationAnalytics fold — parity vs simulationRunState fold", () => {
  it("agrees on every shared field after a full lifecycle", () => {
    const slim = new SimulationAnalyticsFoldProjection({
      store: { store: async () => {}, get: async () => null },
    });
    const runFold = new SimulationRunStateFoldProjection({
      store: { store: async () => {}, get: async () => null },
    });

    let slimState = slim.init();
    let runState = runFold.init();
    const q = makeQueued();
    const s = makeStarted();
    const m1 = makeMetricsComputed("trace-1", 0.5);
    const m2 = makeMetricsComputed("trace-1", 0.7); // re-delivery: replaces
    const m3 = makeMetricsComputed("trace-2", 0.3);
    const f = makeFinished("success");

    slimState = slim.handleSimulationRunQueued(q, slimState);
    runState = runFold.handleSimulationRunQueued(q, runState);
    slimState = slim.handleSimulationRunStarted(s, slimState);
    runState = runFold.handleSimulationRunStarted(s, runState);
    slimState = slim.handleSimulationRunMetricsComputed(m1, slimState);
    runState = runFold.handleSimulationRunMetricsComputed(m1, runState);
    slimState = slim.handleSimulationRunMetricsComputed(m2, slimState);
    runState = runFold.handleSimulationRunMetricsComputed(m2, runState);
    slimState = slim.handleSimulationRunMetricsComputed(m3, slimState);
    runState = runFold.handleSimulationRunMetricsComputed(m3, runState);
    slimState = slim.handleSimulationRunFinished(f, slimState);
    runState = runFold.handleSimulationRunFinished(f, runState);

    expect(slimState.scenarioRunId).toBe(runState.ScenarioRunId);
    expect(slimState.scenarioId).toBe(runState.ScenarioId);
    expect(slimState.batchRunId).toBe(runState.BatchRunId);
    expect(slimState.scenarioSetId).toBe(runState.ScenarioSetId);
    expect(slimState.status).toBe(runState.Status);
    expect(slimState.verdict).toBe(runState.Verdict ?? "");
    expect(slimState.durationMs).toBe(runState.DurationMs ?? 0);
    expect(slimState.totalCost).toBe(runState.TotalCost);
  });
});
