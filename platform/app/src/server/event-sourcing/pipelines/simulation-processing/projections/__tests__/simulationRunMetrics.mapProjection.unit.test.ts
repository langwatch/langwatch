import { describe, expect, it, vi } from "vitest";
import { createTenantId } from "../../../..";
import {
  SIMULATION_EVENT_VERSIONS,
  SIMULATION_RUN_EVENT_TYPES,
} from "../../schemas/constants";
import type { SimulationRunMetricsComputedEvent } from "../../schemas/events";
import { SimulationRunMetricsMapProjection } from "../simulationRunMetrics.mapProjection";
import { SimulationRunMetricsAppendStore } from "../simulationRunMetrics.store";

function makeMetricsComputedEvent(): SimulationRunMetricsComputedEvent {
  return {
    id: "event-1",
    type: SIMULATION_RUN_EVENT_TYPES.METRICS_COMPUTED,
    version: SIMULATION_EVENT_VERSIONS.METRICS_COMPUTED,
    aggregateType: "simulation_run",
    aggregateId: "run-1",
    tenantId: createTenantId("tenant-1"),
    occurredAt: 1_700_000_000_000,
    createdAt: 1_700_000_000_001,
    data: {
      scenarioRunId: "run-1",
      traceId: "trace-1",
      totalCost: 0.003,
      roleCosts: { agent: 0.002, judge: 0.001 },
      roleLatencies: { agent: 1200, judge: 300 },
    },
  };
}

describe("SimulationRunMetricsMapProjection", () => {
  it("maps a metrics_computed event to a simulation_run_metrics row", () => {
    const projection = new SimulationRunMetricsMapProjection({
      store: { append: vi.fn() },
    });

    const record = projection.map(makeMetricsComputedEvent());

    expect(record).toEqual({
      TenantId: "tenant-1",
      ScenarioRunId: "run-1",
      TraceId: "trace-1",
      TotalCost: 0.003,
      RoleCosts: { agent: 0.002, judge: 0.001 },
      RoleLatencies: { agent: 1200, judge: 300 },
      OccurredAt: 1_700_000_000_000,
      EventId: "event-1",
    });
  });

  it("returns null for unrelated event types", () => {
    const projection = new SimulationRunMetricsMapProjection({
      store: { append: vi.fn() },
    });

    expect(
      projection.map({ type: "lw.simulation_run.finished" } as any),
    ).toBeNull();
  });

  it("subscribes to metrics_computed only", () => {
    const projection = new SimulationRunMetricsMapProjection({
      store: { append: vi.fn() },
    });

    expect(projection.eventTypes).toEqual([
      SIMULATION_RUN_EVENT_TYPES.METRICS_COMPUTED,
    ]);
  });
});

describe("SimulationRunMetricsAppendStore", () => {
  it("delegates single appends to the repository", async () => {
    const repository = { insertRow: vi.fn(), insertRows: vi.fn() };
    const store = new SimulationRunMetricsAppendStore(repository);
    const record = { TenantId: "tenant-1" } as any;

    await store.append(record, {} as any);

    expect(repository.insertRow).toHaveBeenCalledWith(record);
  });

  it("delegates bulk appends to the repository", async () => {
    const repository = { insertRow: vi.fn(), insertRows: vi.fn() };
    const store = new SimulationRunMetricsAppendStore(repository);
    const records = [{ TenantId: "tenant-1" } as any];

    await store.bulkAppend(records, {} as any);

    expect(repository.insertRows).toHaveBeenCalledWith(records);
  });
});
