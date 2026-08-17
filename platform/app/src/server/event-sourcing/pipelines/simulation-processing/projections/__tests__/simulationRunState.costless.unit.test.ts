import { describe, expect, it } from "vitest";

import { createTenantId } from "../../../../domain/tenantId";
import type { FoldProjectionStore } from "../../../../projections/foldProjection.types";
import {
  SIMULATION_EVENT_VERSIONS,
  SIMULATION_RUN_EVENT_TYPES,
} from "../../schemas/constants";
import type { SimulationRunMetricsComputedEvent } from "../../schemas/events";
import {
  type SimulationRunStateData,
  SimulationRunStateFoldProjection,
} from "../simulationRunState.foldProjection";

const noopStore: FoldProjectionStore<SimulationRunStateData> = {
  store: async () => {},
  get: async () => null,
};
const foldProjection = new SimulationRunStateFoldProjection({
  store: noopStore,
});

const TEST_TENANT_ID = createTenantId("tenant-1");

function costlessMetricsEvent(
  traceId: string,
): SimulationRunMetricsComputedEvent {
  return {
    id: `evt-metrics-${traceId}`,
    aggregateId: "run-1",
    aggregateType: "simulation_run",
    tenantId: TEST_TENANT_ID,
    createdAt: 1050,
    occurredAt: 1000,
    type: SIMULATION_RUN_EVENT_TYPES.METRICS_COMPUTED,
    version: SIMULATION_EVENT_VERSIONS.METRICS_COMPUTED,
    data: {
      scenarioRunId: "run-1",
      traceId,
      totalCost: 0,
      roleCosts: {},
      roleLatencies: {},
    },
  };
}

describe("SimulationRunStateFoldProjection", () => {
  describe("when a run is recorded as costless", () => {
    /**
     * Exhausting the metrics retries on a trace that honestly has no cost now
     * emits zeroes rather than logging an error, so this is the shape the fold
     * must render sensibly: "no cost", never a misleading $0.00.
     *
     * @scenario "A costless run does not display a zero price"
     */
    it("reports the total cost as absent rather than zero", () => {
      const state = foldProjection.apply(
        foldProjection.init(),
        costlessMetricsEvent("trace-1"),
      );

      expect(state.TotalCost).toBeNull();
    });

    it("still records the per-trace entry so the run is not mistaken for unmeasured", () => {
      const state = foldProjection.apply(
        foldProjection.init(),
        costlessMetricsEvent("trace-1"),
      );

      expect(state.TraceMetrics).toHaveProperty("trace-1");
    });

    it("does not suppress a later trace that does have cost", () => {
      const withCost = costlessMetricsEvent("trace-2");
      withCost.data.totalCost = 0.004;

      let state = foldProjection.apply(
        foldProjection.init(),
        costlessMetricsEvent("trace-1"),
      );
      state = foldProjection.apply(state, withCost);

      expect(state.TotalCost).toBe(0.004);
    });
  });
});
