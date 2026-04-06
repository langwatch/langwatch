import { describe, expect, it, vi } from "vitest";
import { createTraceMetricsSyncReactor } from "../traceMetricsSync.reactor";
import type { TraceMetricsSyncReactorDeps } from "../traceMetricsSync.reactor";
import type { SimulationRunStateData } from "../../projections/simulationRunState.foldProjection";
import { createTenantId } from "../../../../domain/tenantId";

const TEST_TENANT = createTenantId("tenant-1");

function makeDeps(overrides: Partial<TraceMetricsSyncReactorDeps> = {}): TraceMetricsSyncReactorDeps {
  return {
    computeRunMetrics: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeSimState(overrides: Partial<SimulationRunStateData> = {}): SimulationRunStateData {
  return {
    ScenarioRunId: "run-1",
    ScenarioId: "scenario-1",
    BatchRunId: "batch-1",
    ScenarioSetId: "set-1",
    Status: "SUCCESS",
    Name: "test",
    Description: null,
    Metadata: null,
    Messages: [],
    TraceIds: ["trace-1"],
    Verdict: null,
    Reasoning: null,
    MetCriteria: [],
    UnmetCriteria: [],
    Error: null,
    DurationMs: null,
    TotalCost: null,
    RoleCosts: {},
    RoleLatencies: {},
    TraceMetrics: {},
    StartedAt: 1000,
    QueuedAt: null,
    CreatedAt: 1000,
    UpdatedAt: 2000,
    FinishedAt: 3000,
    ArchivedAt: null,
    LastSnapshotOccurredAt: 1000,
    LastEventOccurredAt: 0,
    ...overrides,
  };
}

function makeFinishedEvent() {
  return {
    id: "evt-1",
    aggregateId: "run-1",
    aggregateType: "simulation_run",
    tenantId: TEST_TENANT,
    createdAt: 2000,
    occurredAt: 2000,
    type: "lw.simulation_run.finished" as const,
    version: "2026-02-01",
    data: {
      scenarioRunId: "run-1",
      results: { verdict: "success" },
    },
  } as any;
}

describe("traceMetricsSync reactor (simulation-side)", () => {
  describe("when computeRunMetrics dispatch fails", () => {
    it("rethrows so the GroupQueue retries", async () => {
      const dispatchError = new Error("Redis connection lost");
      const deps = makeDeps({
        computeRunMetrics: vi.fn().mockRejectedValue(dispatchError),
      });

      const reactor = createTraceMetricsSyncReactor(deps);

      await expect(
        reactor.handle(makeFinishedEvent(), {
          tenantId: TEST_TENANT,
          aggregateId: "run-1",
          foldState: makeSimState(),
        }),
      ).rejects.toThrow("Redis connection lost");
    });
  });

  describe("when trace already has metrics in TraceMetrics", () => {
    it("skips the trace", async () => {
      const deps = makeDeps();
      const reactor = createTraceMetricsSyncReactor(deps);

      await reactor.handle(makeFinishedEvent(), {
        tenantId: TEST_TENANT,
        aggregateId: "run-1",
        foldState: makeSimState({
          TraceMetrics: {
            "trace-1": { totalCost: 0.003, roleCosts: { Agent: 0.003 }, roleLatencies: { Agent: 4000 } },
          },
        }),
      });

      expect(deps.computeRunMetrics).not.toHaveBeenCalled();
    });
  });

  describe("when trace has no metrics yet", () => {
    it("dispatches computeRunMetrics in pull mode", async () => {
      const deps = makeDeps();
      const reactor = createTraceMetricsSyncReactor(deps);

      await reactor.handle(makeFinishedEvent(), {
        tenantId: TEST_TENANT,
        aggregateId: "run-1",
        foldState: makeSimState(),
      });

      expect(deps.computeRunMetrics).toHaveBeenCalledWith(
        expect.objectContaining({
          scenarioRunId: "run-1",
          traceId: "trace-1",
          retryCount: 0,
        }),
      );
    });
  });
});
