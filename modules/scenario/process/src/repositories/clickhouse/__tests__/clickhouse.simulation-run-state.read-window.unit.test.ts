/**
 * The scenario-run fold reads its state back within a window around the event,
 * bounded by start time in both the row read and the latest-version lookup.
 *
 * @see modules/scenario/specs/simulation-run-state-read-window.feature
 */

import {
  createTenantId,
  FoldProjectionExecutor,
  type FoldProjectionStore,
  type ProjectionStoreContext,
} from "@langwatch/eventing";
import {
  SIMULATION_EVENT_VERSIONS,
  SIMULATION_RUN_EVENT_TYPES,
  type SimulationRunStartedEvent,
} from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import {
  SIMULATION_RUN_STATE_READ_WINDOW_MS,
  type SimulationRunStateData,
  SimulationRunStateFoldProjection,
} from "../../../eventing/simulation-run-state.projection.ts";
import {
  ClickHouseSimulationRunStateRepository,
  LATEST_VERSION_LOOKUP_MARGIN_MS,
} from "../clickhouse.simulation-run-state.repository.ts";

const TENANT_ID = createTenantId("tenant-read-window");
const RUN_ID = "scenario-run-read-window";
const OCCURRED_AT = Date.UTC(2026, 9, 14, 12, 0, 0);

function started(): SimulationRunStartedEvent {
  return {
    id: "event-started",
    aggregateId: RUN_ID,
    aggregateType: "simulation_run",
    tenantId: TENANT_ID,
    createdAt: OCCURRED_AT,
    occurredAt: OCCURRED_AT,
    type: SIMULATION_RUN_EVENT_TYPES.STARTED,
    version: SIMULATION_EVENT_VERSIONS.STARTED,
    data: {
      scenarioRunId: RUN_ID,
      scenarioId: "scenario-1",
      batchRunId: "batch-1",
      scenarioSetId: "set-1",
    },
  };
}

/** A fold store that records the context of every read and finds nothing. */
function recordingStore(): {
  store: FoldProjectionStore<SimulationRunStateData>;
  reads: ProjectionStoreContext[];
} {
  const reads: ProjectionStoreContext[] = [];
  return {
    reads,
    store: {
      store: async () => {},
      get: async (_aggregateId, context) => {
        reads.push(context);
        return { kind: "empty" };
      },
    },
  };
}

describe("the scenario-run state fold", () => {
  describe("when an event of a run is folded", () => {
    /** @scenario "The scenario-run fold declares a read window around each event" */
    it("reads the run back within the declared window around the event's time", async () => {
      const { store, reads } = recordingStore();
      const projection = SimulationRunStateFoldProjection.create({ store });

      await new FoldProjectionExecutor().execute(projection, started(), {
        aggregateId: RUN_ID,
        tenantId: TENANT_ID,
      });

      expect(reads[0]?.readWindow).toEqual({
        fromMs: OCCURRED_AT - SIMULATION_RUN_STATE_READ_WINDOW_MS,
        toMs: OCCURRED_AT + SIMULATION_RUN_STATE_READ_WINDOW_MS,
      });
      expect(reads[1]?.readWindow).toBeUndefined();
    });
  });
});

describe("ClickHouseSimulationRunStateRepository.startedAtBounds", () => {
  describe("given a read window", () => {
    const window = { fromMs: 1_000_000, toMs: 2_000_000 };

    /** @scenario "A windowed read of a run bounds both the latest-version lookup and the row read by start time" */
    it("bounds the row read to the window and the latest-version lookup to a wider one", () => {
      const bounds = ClickHouseSimulationRunStateRepository.startedAtBounds({ window });

      expect(bounds.row).toBe(
        "AND t.StartedAt >= fromUnixTimestamp64Milli({fromMs:Int64}) " +
          "AND t.StartedAt <= fromUnixTimestamp64Milli({toMs:Int64})",
      );
      expect(bounds.latestVersion).toBe(
        "AND s.StartedAt >= fromUnixTimestamp64Milli({lookupFromMs:Int64}) " +
          "AND s.StartedAt <= fromUnixTimestamp64Milli({lookupToMs:Int64})",
      );
      expect(bounds.params).toEqual({
        fromMs: window.fromMs,
        toMs: window.toMs,
        lookupFromMs: window.fromMs - LATEST_VERSION_LOOKUP_MARGIN_MS,
        lookupToMs: window.toMs + LATEST_VERSION_LOOKUP_MARGIN_MS,
      });
    });
  });

  describe("given a window with fractional bounds", () => {
    it("widens them to whole milliseconds the Int64 params accept", () => {
      const bounds = ClickHouseSimulationRunStateRepository.startedAtBounds({
        window: { fromMs: 1_000.5, toMs: 2_000.5 },
      });

      expect(bounds.params.fromMs).toBe(1_000);
      expect(bounds.params.toMs).toBe(2_001);
    });
  });

  describe("given no read window", () => {
    it("adds no start-time bound and no params", () => {
      expect(ClickHouseSimulationRunStateRepository.startedAtBounds({ window: void 0 })).toEqual({
        row: "",
        latestVersion: "",
        params: {},
      });
    });
  });
});
