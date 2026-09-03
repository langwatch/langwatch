import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";
import {
  SIMULATION_EVENT_VERSIONS,
  SIMULATION_PROJECTION_VERSIONS,
  SIMULATION_RUN_EVENT_TYPES,
} from "@langwatch/scenario-contract";
import type {
  SimulationRunMetricsComputedEvent,
  SimulationRunQueuedEvent,
} from "@langwatch/scenario-contract";
import { SimulationRunStateStoreAdapter } from "../simulation-eventing.adapter";
import {
  type SimulationRunStateData,
  SimulationRunStateFoldProjection,
} from "../../projections/simulation-run-state.projection";

const TENANT_ID = createTenantId("project-acme");
const RUN_ID = "scenariorun_0005FFcHZ7IBvPE1OSWymml0ikKqB";

function metricsComputedEvent(totalCost: number): SimulationRunMetricsComputedEvent {
  return {
    id: "event-metrics",
    aggregateId: RUN_ID,
    aggregateType: "simulation_run",
    tenantId: TENANT_ID,
    createdAt: 2000,
    occurredAt: 2000,
    type: SIMULATION_RUN_EVENT_TYPES.METRICS_COMPUTED,
    version: SIMULATION_EVENT_VERSIONS.METRICS_COMPUTED,
    data: {
      scenarioRunId: RUN_ID,
      traceId: "trace-1",
      totalCost,
      roleCosts: { agent: totalCost },
      roleLatencies: { agent: 120 },
    },
  };
}

function queuedEvent(): SimulationRunQueuedEvent {
  return {
    id: "event-queued",
    aggregateId: RUN_ID,
    aggregateType: "simulation_run",
    tenantId: TENANT_ID,
    createdAt: 1000,
    occurredAt: 1000,
    type: SIMULATION_RUN_EVENT_TYPES.QUEUED,
    version: SIMULATION_EVENT_VERSIONS.QUEUED,
    data: {
      scenarioRunId: RUN_ID,
      scenarioId: "scenario-1",
      batchRunId: "scenariobatch_0005FFcHZ7IBvPE1OSWymml0ikKqB",
      scenarioSetId: "set-1",
      name: "checkout flow",
    },
  };
}

describe("SimulationRunStateStoreAdapter fold store", () => {
  describe("given a run that has been queued", () => {
    /** @scenario "A run with a lifecycle event keeps writing its row" */
    it("writes the row with the cost", async () => {
      const adapter = SimulationRunStateStoreAdapter.create({ type: "memory" });
      const store = adapter.createFoldStore();
      const projection = SimulationRunStateFoldProjection.create({ store });

      let state = projection.init();
      state = projection.apply(state, queuedEvent());
      state = projection.apply(state, metricsComputedEvent(0.5));

      await store.store(state, { tenantId: TENANT_ID, aggregateId: RUN_ID });

      const stored = await adapter.getProjection(RUN_ID, { tenantId: TENANT_ID });
      expect(stored).not.toBeNull();
      const data = stored!.data as SimulationRunStateData;
      expect(data.Name).toBe("checkout flow");
      expect(data.TotalCost).toBe(0.5);
      expect(stored!.version).toBe(SIMULATION_PROJECTION_VERSIONS.RUN_STATE);
    });
  });
});
