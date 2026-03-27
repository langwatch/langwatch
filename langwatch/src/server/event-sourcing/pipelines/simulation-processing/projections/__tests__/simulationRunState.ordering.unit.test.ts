/**
 * Combinatorial test for simulation run fold ordering.
 *
 * Proves that the fold produces correct final state regardless of
 * event processing order. Simulates the incremental fold pattern:
 * store.get() → apply(event) → store.store() for each event.
 *
 * The in-memory store mimics ClickHouse ReplacingMergeTree behavior:
 * multiple rows coexist, get() returns the one with highest UpdatedAt.
 *
 * Production constraint (verified from prod data):
 * - started is ALWAYS the first event (lowest createdAt)
 * - finished is ALWAYS after message_snapshot
 * - metrics_computed can arrive at any point after started
 */
import { describe, expect, it } from "vitest";
import { createTenantId } from "../../../../domain/tenantId";
import type { FoldProjectionStore } from "../../../../projections/foldProjection.types";
import type { ProjectionStoreContext } from "../../../../projections/projectionStoreContext";
import {
  SIMULATION_EVENT_VERSIONS,
  SIMULATION_RUN_EVENT_TYPES,
} from "../../schemas/constants";
import type {
  SimulationMessageSnapshotEvent,
  SimulationProcessingEvent,
  SimulationRunFinishedEvent,
  SimulationRunMetricsComputedEvent,
  SimulationRunStartedEvent,
} from "../../schemas/events";
import {
  createSimulationRunStateFoldProjection,
  type SimulationRunStateData,
} from "../simulationRunState.foldProjection";

const TEST_TENANT_ID = createTenantId("tenant-1");

// --- In-memory store that mimics ReplacingMergeTree ---
function createReplacingMergeTreeStore(): FoldProjectionStore<SimulationRunStateData> & {
  rows: SimulationRunStateData[];
  clear: () => void;
} {
  const rows: SimulationRunStateData[] = [];
  return {
    rows,
    clear() { rows.length = 0; },
    async store(state: SimulationRunStateData): Promise<void> {
      rows.push({ ...state });
    },
    async get(_key: string, _ctx: ProjectionStoreContext): Promise<SimulationRunStateData | null> {
      if (rows.length === 0) return null;
      return rows.reduce((best, row) =>
        row.UpdatedAt > best.UpdatedAt ? row : best
      );
    },
  };
}

// --- Event factories ---
function createStartedEvent(occurredAt = 1000): SimulationRunStartedEvent {
  return {
    id: "evt-started",
    aggregateId: "run-1",
    aggregateType: "simulation_run",
    tenantId: TEST_TENANT_ID,
    createdAt: occurredAt + 100,
    occurredAt,
    type: SIMULATION_RUN_EVENT_TYPES.STARTED,
    version: SIMULATION_EVENT_VERSIONS.STARTED,
    data: {
      scenarioRunId: "run-1",
      scenarioId: "scenario-1",
      batchRunId: "batch-1",
      scenarioSetId: "python-examples",
      name: "test scenario",
      description: "test",
    },
  };
}

function createMessageSnapshotEvent(occurredAt = 5000): SimulationMessageSnapshotEvent {
  return {
    id: "evt-snapshot",
    aggregateId: "run-1",
    aggregateType: "simulation_run",
    tenantId: TEST_TENANT_ID,
    createdAt: occurredAt + 100,
    occurredAt,
    type: SIMULATION_RUN_EVENT_TYPES.MESSAGE_SNAPSHOT,
    version: SIMULATION_EVENT_VERSIONS.MESSAGE_SNAPSHOT,
    data: {
      scenarioRunId: "run-1",
      messages: [
        { role: "user", content: "hello", id: "msg-1", trace_id: "trace-1" },
        { role: "assistant", content: "hi there", id: "msg-2", trace_id: "trace-1" },
      ],
      traceIds: ["trace-1", "trace-2"],
    },
  };
}

function createFinishedEvent(occurredAt = 5200): SimulationRunFinishedEvent {
  return {
    id: "evt-finished",
    aggregateId: "run-1",
    aggregateType: "simulation_run",
    tenantId: TEST_TENANT_ID,
    createdAt: occurredAt + 200,
    occurredAt,
    type: SIMULATION_RUN_EVENT_TYPES.FINISHED,
    version: SIMULATION_EVENT_VERSIONS.FINISHED,
    data: {
      scenarioRunId: "run-1",
      results: {
        verdict: "success",
        reasoning: "All criteria met",
        metCriteria: ["criterion-1"],
        unmetCriteria: [],
      },
      status: "SUCCESS",
    },
  };
}

function createMetricsComputedEvent(
  traceId: string,
  occurredAt: number,
): SimulationRunMetricsComputedEvent {
  return {
    id: `evt-metrics-${traceId}-${occurredAt}`,
    aggregateId: "run-1",
    aggregateType: "simulation_run",
    tenantId: TEST_TENANT_ID,
    createdAt: occurredAt + 50,
    occurredAt,
    type: SIMULATION_RUN_EVENT_TYPES.METRICS_COMPUTED,
    version: SIMULATION_EVENT_VERSIONS.METRICS_COMPUTED,
    data: {
      scenarioRunId: "run-1",
      traceId,
      totalCost: 0.003,
      roleCosts: { Agent: 0.002, User: 0.001 },
      roleLatencies: { Agent: 2000, User: 1000 },
    },
  };
}

// --- Simulate incremental fold processing ---
async function processFold(
  events: SimulationProcessingEvent[],
  store: FoldProjectionStore<SimulationRunStateData> & { clear: () => void },
  projection: ReturnType<typeof createSimulationRunStateFoldProjection>,
): Promise<SimulationRunStateData> {
  const ctx: ProjectionStoreContext = {
    aggregateId: "run-1",
    tenantId: TEST_TENANT_ID,
  };

  store.clear();
  for (const event of events) {
    const currentState = await store.get("run-1", ctx) ?? projection.init();
    const newState = projection.apply(currentState, event);
    await store.store(newState, ctx);
  }
  // Return what ReplacingMergeTree would return
  return (await store.get("run-1", ctx))!;
}

// --- Permutation helper ---
function permutations<T>(arr: T[]): T[][] {
  if (arr.length <= 1) return [arr];
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const perm of permutations(rest)) {
      result.push([arr[i]!, ...perm]);
    }
  }
  return result;
}

function eventLabel(e: SimulationProcessingEvent): string {
  const type = e.type.replace("lw.simulation_run.", "");
  if (e.type === SIMULATION_RUN_EVENT_TYPES.METRICS_COMPUTED) {
    return `${type}(${(e.data as any).traceId})`;
  }
  return type;
}

describe("simulation run fold — event ordering invariants", () => {
  const store = createReplacingMergeTreeStore();
  const projection = createSimulationRunStateFoldProjection({ store });

  // Events that can be reordered after started.
  // In production: started is always first, finished always after snapshot.
  // metrics_computed can interleave anywhere.
  const afterStarted: SimulationProcessingEvent[] = [
    createMessageSnapshotEvent(5000),
    createFinishedEvent(5200),
    createMetricsComputedEvent("trace-1", 65000),
    createMetricsComputedEvent("trace-2", 65100),
  ];

  const started = createStartedEvent(1000);

  // Generate all permutations of the post-started events, prepend started
  const allPerms = permutations(afterStarted).map(perm => [started, ...perm]);

  function assertCorrectFinalState(state: SimulationRunStateData, label: string) {
    expect(state.Status, `${label}: Status must be SUCCESS`).toBe("SUCCESS");
    expect(state.FinishedAt, `${label}: FinishedAt must be set`).not.toBeNull();
    expect(state.ScenarioSetId, `${label}: ScenarioSetId must be preserved`).toBe("python-examples");
    expect(state.BatchRunId, `${label}: BatchRunId must be preserved`).toBe("batch-1");
    expect(state.ScenarioId, `${label}: ScenarioId must be preserved`).toBe("scenario-1");
    expect(state.Verdict, `${label}: Verdict must be set`).toBe("success");
  }

  describe(`when started is first, then ${afterStarted.length} events in all ${allPerms.length} orderings`, () => {
    it.each(allPerms.map((perm, i) => ({
      name: `[${i}] ${perm.map(eventLabel).join(" → ")}`,
      perm,
    })))("$name → final state is correct", async ({ name, perm }) => {
      const state = await processFold(perm, store, projection);
      assertCorrectFinalState(state, name);
    });
  });

  // Specific production-observed orderings
  describe("when processing in production-observed orderings", () => {
    it("started → snapshot → finished → metrics × 2 (happy path)", async () => {
      const state = await processFold([
        started,
        createMessageSnapshotEvent(5000),
        createFinishedEvent(5200),
        createMetricsComputedEvent("trace-1", 65000),
        createMetricsComputedEvent("trace-2", 65100),
      ], store, projection);
      assertCorrectFinalState(state, "happy path");
      expect(state.TotalCost).toBeGreaterThan(0);
    });

    it("started → finished → snapshot → metrics × 2 (finished before snapshot)", async () => {
      const state = await processFold([
        started,
        createFinishedEvent(5200),
        createMessageSnapshotEvent(5000),
        createMetricsComputedEvent("trace-1", 65000),
        createMetricsComputedEvent("trace-2", 65100),
      ], store, projection);
      assertCorrectFinalState(state, "finished before snapshot");
    });

    it("started → metrics → snapshot → finished → metrics (metrics interleaved)", async () => {
      const state = await processFold([
        started,
        createMetricsComputedEvent("trace-1", 65000),
        createMessageSnapshotEvent(5000),
        createFinishedEvent(5200),
        createMetricsComputedEvent("trace-2", 65100),
      ], store, projection);
      assertCorrectFinalState(state, "metrics interleaved");
    });
  });

  // Test with duplicate 60s-delayed metrics (ECST fires twice)
  describe("when duplicate delayed metrics arrive after finished", () => {
    it("preserves SUCCESS with all metrics applied", async () => {
      const state = await processFold([
        started,
        createMessageSnapshotEvent(5000),
        createFinishedEvent(5200),
        createMetricsComputedEvent("trace-1", 65000),
        createMetricsComputedEvent("trace-2", 65100),
        // Duplicate ECST fire
        createMetricsComputedEvent("trace-1", 125000),
        createMetricsComputedEvent("trace-2", 125100),
      ], store, projection);
      assertCorrectFinalState(state, "duplicate delayed metrics");
      expect(state.TotalCost).toBeGreaterThan(0);
    });
  });
});
