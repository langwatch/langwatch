import {
  createTenantId,
  type BulkAppendContext,
  type ProjectionStoreContext,
} from "@langwatch/eventing";
import { describe, expect, it, vi } from "vitest";
import {
  SIMULATION_EVENT_VERSIONS,
  SIMULATION_RUN_EVENT_TYPES,
} from "@langwatch/scenario-contract";
import type { SimulationRunMetricsComputedEvent } from "@langwatch/scenario-contract";
import { SimulationRunMetricsMapProjection } from "../src/projections/simulation-run-metrics.projection";
import { SimulationRunMetricsAppendStore } from "../src/stores/eventing/eventing.simulation-run-metrics.store";
import type { SimulationRunMetricsRepository } from "../src/repositories/simulation-run-metrics.repository";
import type { SimulationRunMetricsProjectionRecord } from "../src/projections/simulation-run-metrics.projection";

const projectionStoreContext: ProjectionStoreContext = {
  aggregateId: "run-1",
  tenantId: createTenantId("tenant-1"),
};

const bulkAppendContext: BulkAppendContext = {
  tenantId: createTenantId("tenant-1"),
};

function makeMetricsRecord(): SimulationRunMetricsProjectionRecord {
  return {
    TenantId: "tenant-1",
    ScenarioRunId: "run-1",
    TraceId: "trace-1",
    TotalCost: 0.003,
    RoleCosts: { agent: 0.003 },
    RoleLatencies: { agent: 1200 },
    OccurredAt: 1_700_000_000_000,
    EventId: "event-1",
  };
}

function makeRepository(): SimulationRunMetricsRepository {
  return {
    insertRow: vi.fn(async (_record: SimulationRunMetricsProjectionRecord) => {}),
    insertRows: vi.fn(async (_records: SimulationRunMetricsProjectionRecord[]) => {}),
  };
}

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
    const projection = SimulationRunMetricsMapProjection.create({
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
    const projection = SimulationRunMetricsMapProjection.create({
      store: { append: vi.fn() },
    });

    expect(projection.map({ type: "lw.simulation_run.finished" })).toBeNull();
  });

  it("subscribes to metrics_computed only", () => {
    const projection = SimulationRunMetricsMapProjection.create({
      store: { append: vi.fn() },
    });

    expect(projection.eventTypes).toEqual([SIMULATION_RUN_EVENT_TYPES.METRICS_COMPUTED]);
  });
});

describe("SimulationRunMetricsAppendStore", () => {
  it("delegates single appends to the repository", async () => {
    const repository = makeRepository();
    const store = new SimulationRunMetricsAppendStore(repository);
    const record = makeMetricsRecord();

    await store.append(record, projectionStoreContext);

    expect(repository.insertRow).toHaveBeenCalledWith(record);
  });

  it("delegates bulk appends to the repository", async () => {
    const repository = makeRepository();
    const store = new SimulationRunMetricsAppendStore(repository);
    const records = [makeMetricsRecord()];

    await store.bulkAppend(records, bulkAppendContext);

    expect(repository.insertRows).toHaveBeenCalledWith(records);
  });
});
