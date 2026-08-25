import { describe, expect, it } from "vitest";
import { createTenantId } from "../../../../domain/tenantId";
import type { Projection } from "../../../../domain/types";
import type { ProjectionStore } from "../../../../stores/projectionStore.types";
import {
  SIMULATION_EVENT_VERSIONS,
  SIMULATION_PROJECTION_VERSIONS,
  SIMULATION_RUN_EVENT_TYPES,
} from "../../schemas/constants";
import type {
  SimulationRunMetricsComputedEvent,
  SimulationRunQueuedEvent,
  SimulationRunStartedEvent,
} from "../../schemas/events";
import {
  type SimulationRunStateData,
  SimulationRunStateFoldProjection,
} from "../simulationRunState.foldProjection";
import { SimulationRunStateFoldStore } from "../simulationRunState.store";

const TENANT_ID = createTenantId("project-acme");
const RUN_ID = "scenariorun_0005FFcHZ7IBvPE1OSWymml0ikKqB";

/** Records what reached the durable side, which is what the UI lists. */
function recordingRepository(): {
  repository: ProjectionStore<Projection>;
  written: Projection[];
} {
  const written: Projection[] = [];
  return {
    written,
    repository: {
      getProjection: async () => null,
      storeProjection: async (projection) => {
        written.push(projection);
      },
    },
  };
}

function makeStore() {
  const { repository, written } = recordingRepository();
  return {
    written,
    store: new SimulationRunStateFoldStore({
      repository,
      version: SIMULATION_PROJECTION_VERSIONS.RUN_STATE,
    }),
  };
}

function metricsComputedEvent(
  totalCost: number,
): SimulationRunMetricsComputedEvent {
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

function startedEvent(): SimulationRunStartedEvent {
  return {
    id: "event-started",
    aggregateId: RUN_ID,
    aggregateType: "simulation_run",
    tenantId: TENANT_ID,
    createdAt: 1500,
    occurredAt: 1500,
    type: SIMULATION_RUN_EVENT_TYPES.STARTED,
    version: SIMULATION_EVENT_VERSIONS.STARTED,
    data: {
      scenarioRunId: RUN_ID,
      scenarioId: "scenario-1",
      batchRunId: "scenariobatch_0005FFcHZ7IBvPE1OSWymml0ikKqB",
      scenarioSetId: "set-1",
      name: "checkout flow",
    },
  };
}

const projection = new SimulationRunStateFoldProjection({
  store: { store: async () => {}, get: async () => null },
});

type FoldedEvent =
  | SimulationRunMetricsComputedEvent
  | SimulationRunQueuedEvent
  | SimulationRunStartedEvent;

function fold(events: FoldedEvent[]): SimulationRunStateData {
  return events.reduce(
    (state, event) => projection.apply(state, event),
    projection.init(),
  );
}

const context = { tenantId: TENANT_ID, aggregateId: RUN_ID };

describe("SimulationRunStateFoldStore", () => {
  describe("given an aggregate with no lifecycle event", () => {
    /** @scenario "Cost metrics for an unknown run write no run row" */
    it("writes no run row for cost metrics alone", async () => {
      const { store, written } = makeStore();
      await store.store(fold([metricsComputedEvent(1.25)]), context);
      expect(written).toEqual([]);
    });

    it("drops the same state out of a batch and keeps the rest", async () => {
      const { store, written } = makeStore();
      await store.storeBatch([
        { state: fold([metricsComputedEvent(1.25)]), context },
        { state: fold([queuedEvent()]), context },
      ]);
      expect(written).toHaveLength(1);
      expect((written[0]!.data as SimulationRunStateData).ScenarioRunId).toBe(
        RUN_ID,
      );
    });
  });

  describe("when cost metrics arrive before the run", () => {
    /** @scenario "Cost that arrives before the run starts reaches the row" */
    it("carries the cost into the row the started event writes", async () => {
      const { store, written } = makeStore();
      const withMetrics = fold([metricsComputedEvent(1.25)]);
      await store.store(withMetrics, context);
      expect(written).toEqual([]);

      await store.store(projection.apply(withMetrics, startedEvent()), context);
      expect(written).toHaveLength(1);
      const stored = written[0]!.data as SimulationRunStateData;
      expect(stored.ScenarioRunId).toBe(RUN_ID);
      expect(stored.TotalCost).toBe(1.25);
    });
  });

  describe("given a run that has been queued", () => {
    /** @scenario "A run with a lifecycle event keeps writing its row" */
    it("writes the row with the cost", async () => {
      const { store, written } = makeStore();
      await store.store(
        fold([queuedEvent(), metricsComputedEvent(0.5)]),
        context,
      );
      expect(written).toHaveLength(1);
      const stored = written[0]!.data as SimulationRunStateData;
      expect(stored.Name).toBe("checkout flow");
      expect(stored.TotalCost).toBe(0.5);
    });
  });
});
