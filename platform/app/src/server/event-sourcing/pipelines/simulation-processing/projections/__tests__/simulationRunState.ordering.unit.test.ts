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
 * - metrics_recorded is emitted after the run settles, but can be delivered at
 *   any point relative to the rest
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
  SimulationRunMetricsRecordedEvent,
  SimulationRunQueuedEvent,
  SimulationRunStartedEvent,
} from "../../schemas/events";
import {
  type SimulationRunStateData,
  SimulationRunStateFoldProjection,
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
    clear() {
      rows.length = 0;
    },
    async store(state: SimulationRunStateData): Promise<void> {
      rows.push({ ...state });
    },
    async get(
      _key: string,
      _ctx: ProjectionStoreContext,
    ): Promise<SimulationRunStateData | null> {
      if (rows.length === 0) return null;
      return rows.reduce((best, row) =>
        row.UpdatedAt > best.UpdatedAt ? row : best,
      );
    },
  };
}

// --- Event factories ---
function createQueuedEvent(occurredAt = 500): SimulationRunQueuedEvent {
  return {
    id: "evt-queued",
    aggregateId: "run-1",
    aggregateType: "simulation_run",
    tenantId: TEST_TENANT_ID,
    createdAt: occurredAt + 50,
    occurredAt,
    type: SIMULATION_RUN_EVENT_TYPES.QUEUED,
    version: SIMULATION_EVENT_VERSIONS.QUEUED,
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

function createMessageSnapshotEvent(
  occurredAt = 5000,
): SimulationMessageSnapshotEvent {
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
        {
          role: "assistant",
          content: "hi there",
          id: "msg-2",
          trace_id: "trace-1",
        },
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

/**
 * A cancel reaches the fold as a `finished` event carrying status CANCELLED —
 * that is what makes the run terminal, and what a late worker finish has to
 * lose against.
 */
function createCancelledFinishedEvent(
  occurredAt = 3000,
): SimulationRunFinishedEvent {
  return {
    id: "evt-finished-cancelled",
    aggregateId: "run-1",
    aggregateType: "simulation_run",
    tenantId: TEST_TENANT_ID,
    createdAt: occurredAt + 200,
    occurredAt,
    type: SIMULATION_RUN_EVENT_TYPES.FINISHED,
    version: SIMULATION_EVENT_VERSIONS.FINISHED,
    data: {
      scenarioRunId: "run-1",
      status: "CANCELLED",
    },
  };
}

function createErrorFinishedEvent(
  occurredAt = 5200,
): SimulationRunFinishedEvent {
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
        verdict: "failure",
        reasoning: "Cannot connect to API",
        metCriteria: [],
        unmetCriteria: [],
        error: '{"name":"Error","message":"Cannot connect to API"}',
      },
      status: "ERROR",
    },
  };
}

/**
 * The run's measurement. One event per run, carrying the whole aggregate — a
 * later one replaces an earlier one outright, which is what makes ordering
 * irrelevant here in a way the per-trace predecessor's accumulator never was.
 */
function createMetricsRecordedEvent(
  occurredAt: number,
  totalCost = 0.003,
): SimulationRunMetricsRecordedEvent {
  return {
    id: `evt-metrics-${occurredAt}`,
    aggregateId: "run-1",
    aggregateType: "simulation_run",
    tenantId: TEST_TENANT_ID,
    createdAt: occurredAt + 50,
    occurredAt,
    type: SIMULATION_RUN_EVENT_TYPES.METRICS_RECORDED,
    version: SIMULATION_EVENT_VERSIONS.METRICS_RECORDED,
    data: {
      scenarioRunId: "run-1",
      traceIds: ["trace-1", "trace-2"],
      totalCost,
      roleCosts: { Agent: [0.001, 0.001], User: [0.0005, 0.0005] },
      roleLatencies: { Agent: [1000, 1000], User: [500, 500] },
    },
  };
}

/**
 * A run measured under the RETIRED per-trace metrics event.
 *
 * Nothing emits `lw.simulation_run.metrics_computed` any more and the fold has
 * no handler for it, but events committed under it are still in the log and
 * still inside the `scenarios` retention window. `apply` returns state
 * unchanged for an event it cannot dispatch, so this exists to prove what a
 * replay of such a run would rebuild.
 */
function createRetiredMetricsComputedEvent(
  occurredAt: number,
): SimulationProcessingEvent {
  return {
    id: `evt-metrics-computed-${occurredAt}`,
    aggregateId: "run-1",
    aggregateType: "simulation_run",
    tenantId: TEST_TENANT_ID,
    createdAt: occurredAt + 50,
    occurredAt,
    type: SIMULATION_RUN_EVENT_TYPES.METRICS_COMPUTED,
    version: SIMULATION_EVENT_VERSIONS.METRICS_COMPUTED,
    data: {
      scenarioRunId: "run-1",
      traceId: "trace-1",
      totalCost: 0.004,
    },
  } as unknown as SimulationProcessingEvent;
}

/**
 * Mirrors `FoldProjectionExecutor`: load, apply, and — only when the projection
 * has not declined it — replay the aggregate's history from `init()` for an
 * event that occurred before the checkpoint.
 *
 * Honouring `options.refoldOnOutOfOrder` here is the point. A harness that
 * always re-folds proves the fold is correct under a mechanism production no
 * longer runs, which is worse than proving nothing.
 */
async function processFold(
  events: SimulationProcessingEvent[],
  store: FoldProjectionStore<SimulationRunStateData> & { clear: () => void },
  projection: SimulationRunStateFoldProjection,
): Promise<SimulationRunStateData> {
  const ctx: ProjectionStoreContext = {
    aggregateId: "run-1",
    tenantId: TEST_TENANT_ID,
  };

  // Track all events seen so far (for re-fold event loader)
  const allEventsSoFar: SimulationProcessingEvent[] = [];

  store.clear();
  for (const event of events) {
    allEventsSoFar.push(event);
    const currentState = (await store.get("run-1", ctx)) ?? projection.init();

    // Capture LastEventOccurredAt before apply
    const prevLastOccurred = currentState.LastEventOccurredAt ?? 0;

    const newState = projection.apply(currentState, event);

    // Simulate FoldProjectionExecutor's out-of-order detection
    const eventOccurredAt = event.occurredAt ?? 0;
    const mayRefold = projection.options?.refoldOnOutOfOrder !== false;
    if (
      mayRefold &&
      eventOccurredAt > 0 &&
      eventOccurredAt < prevLastOccurred
    ) {
      // Re-fold from scratch in occurredAt order
      const sorted = [...allEventsSoFar].sort(
        (a, b) => (a.occurredAt ?? 0) - (b.occurredAt ?? 0),
      );
      let refolded = projection.init();
      for (const e of sorted) {
        refolded = projection.apply(refolded, e);
      }
      store.clear();
      await store.store(refolded, ctx);
    } else {
      await store.store(newState, ctx);
    }
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
  if (e.type === SIMULATION_RUN_EVENT_TYPES.METRICS_RECORDED) {
    return `${type}@${e.occurredAt}`;
  }
  return type;
}

describe("simulation run fold — event ordering invariants", () => {
  const store = createReplacingMergeTreeStore();
  const projection = new SimulationRunStateFoldProjection({ store });

  function assertCorrectFinalState(
    state: SimulationRunStateData,
    label: string,
  ) {
    expect(state.Status, `${label}: Status must be SUCCESS`).toBe("SUCCESS");
    expect(state.FinishedAt, `${label}: FinishedAt must be set`).not.toBeNull();
    expect(
      state.ScenarioSetId,
      `${label}: ScenarioSetId must be preserved`,
    ).toBe("python-examples");
    expect(state.BatchRunId, `${label}: BatchRunId must be preserved`).toBe(
      "batch-1",
    );
    expect(state.ScenarioId, `${label}: ScenarioId must be preserved`).toBe(
      "scenario-1",
    );
    expect(state.Verdict, `${label}: Verdict must be set`).toBe("success");
    // Metrics must always be preserved regardless of ordering
    expect(
      state.TotalCost,
      `${label}: TotalCost must be computed`,
    ).toBeGreaterThan(0);
    expect(
      Object.keys(state.RoleCosts).length,
      `${label}: RoleCosts must have entries`,
    ).toBeGreaterThan(0);
    expect(
      Object.keys(state.RoleLatencies).length,
      `${label}: RoleLatencies must have entries`,
    ).toBeGreaterThan(0);
  }

  // --- Distinct timestamps (finished > snapshot) ---
  describe("when snapshot and finished have distinct timestamps", () => {
    const started = createStartedEvent(1000);
    const afterStarted: SimulationProcessingEvent[] = [
      createMessageSnapshotEvent(5000),
      createFinishedEvent(5200),
      createMetricsRecordedEvent(65000),
    ];

    const allPerms = permutations(afterStarted).map((perm) => [
      started,
      ...perm,
    ]);

    describe(`when started is first, then ${afterStarted.length} events in all ${allPerms.length} orderings`, () => {
      it.each(
        allPerms.map((perm, i) => ({
          name: `[${i}] ${perm.map(eventLabel).join(" → ")}`,
          perm,
        })),
      )("$name → final state is correct", async ({ name, perm }) => {
        const state = await processFold(perm, store, projection);
        assertCorrectFinalState(state, name);
      });
    });
  });

  // --- Identical timestamps (production pattern: SDK sends snapshot and
  // finished with the same occurredAt) ---
  describe("when snapshot and finished have identical occurredAt (production SDK pattern)", () => {
    const SAME_TS = 5000;
    const started = createStartedEvent(1000);
    const afterStarted: SimulationProcessingEvent[] = [
      createMessageSnapshotEvent(SAME_TS),
      createFinishedEvent(SAME_TS),
      createMetricsRecordedEvent(65000),
    ];

    const allPerms = permutations(afterStarted).map((perm) => [
      started,
      ...perm,
    ]);

    describe(`when started is first, then ${afterStarted.length} events in all ${allPerms.length} orderings`, () => {
      it.each(
        allPerms.map((perm, i) => ({
          name: `[${i}] ${perm.map(eventLabel).join(" → ")}`,
          perm,
        })),
      )("$name → final state is correct", async ({ name, perm }) => {
        const state = await processFold(perm, store, projection);
        assertCorrectFinalState(state, name);
      });
    });
  });

  // Specific production-observed orderings
  describe("when processing in production-observed orderings", () => {
    it("started → snapshot → finished → metrics (happy path)", async () => {
      const state = await processFold(
        [
          createStartedEvent(1000),
          createMessageSnapshotEvent(5000),
          createFinishedEvent(5000),
          createMetricsRecordedEvent(65000),
        ],
        store,
        projection,
      );
      assertCorrectFinalState(state, "happy path");
    });

    it("started → finished → snapshot → metrics (finished before snapshot)", async () => {
      const state = await processFold(
        [
          createStartedEvent(1000),
          createFinishedEvent(5000),
          createMessageSnapshotEvent(5000),
          createMetricsRecordedEvent(65000),
        ],
        store,
        projection,
      );
      assertCorrectFinalState(state, "finished before snapshot");
    });

    it("started → metrics → snapshot → finished (metrics ahead of the lifecycle)", async () => {
      const state = await processFold(
        [
          createStartedEvent(1000),
          createMetricsRecordedEvent(65000),
          createMessageSnapshotEvent(5000),
          createFinishedEvent(5000),
        ],
        store,
        projection,
      );
      assertCorrectFinalState(state, "metrics ahead of the lifecycle");
    });
  });

  // A re-measure carries the whole aggregate, so it replaces rather than
  // compounds — the property the per-trace accumulator could not offer.
  describe("when the run is measured a second time", () => {
    it("takes the later measurement's values", async () => {
      const state = await processFold(
        [
          createStartedEvent(1000),
          createMessageSnapshotEvent(5000),
          createFinishedEvent(5000),
          createMetricsRecordedEvent(65000, 0.003),
          createMetricsRecordedEvent(125000, 0.008),
        ],
        store,
        projection,
      );

      assertCorrectFinalState(state, "re-measured run");
      expect(state.TotalCost, "later measurement wins").toBe(0.008);
    });

    it("does not compound the earlier measurement's per-role arrays", async () => {
      const state = await processFold(
        [
          createStartedEvent(1000),
          createMessageSnapshotEvent(5000),
          createFinishedEvent(5000),
          createMetricsRecordedEvent(65000),
          createMetricsRecordedEvent(125000),
        ],
        store,
        projection,
      );

      expect(
        state.RoleCosts.Agent,
        "one entry per trace, not per event",
      ).toEqual([0.001, 0.001]);
    });
  });

  // Late-arriving lifecycle events are applied on top of the stored state
  describe("when started event arrives after finished (late delivery)", () => {
    it("keeps the ERROR the finished event set", async () => {
      // Reproduces: queued processed → finished processed → started arrives late
      const state = await processFold(
        [
          createQueuedEvent(500),
          createErrorFinishedEvent(5200),
          createStartedEvent(1000), // late! triggers re-fold
        ],
        store,
        projection,
      );

      expect(state.Status, "Status must remain ERROR").toBe("ERROR");
      expect(state.FinishedAt, "FinishedAt must be set").not.toBeNull();
      expect(state.Verdict, "Verdict must be failure").toBe("failure");
      expect(
        state.StartedAt,
        "StartedAt must be set from started event",
      ).not.toBeNull();
    });

    it("keeps the SUCCESS the finished event set", async () => {
      const state = await processFold(
        [
          createQueuedEvent(500),
          createFinishedEvent(5200),
          createStartedEvent(1000), // late!
        ],
        store,
        projection,
      );

      expect(state.Status, "Status must remain SUCCESS").toBe("SUCCESS");
      expect(state.FinishedAt, "FinishedAt must be set").not.toBeNull();
    });

    it("preserves metadata from all events", async () => {
      const state = await processFold(
        [
          createQueuedEvent(500),
          createErrorFinishedEvent(5200),
          createStartedEvent(1000), // late!
        ],
        store,
        projection,
      );

      expect(state.Name, "Name from started should be preserved").toBe(
        "test scenario",
      );
      expect(state.ScenarioSetId).toBe("python-examples");
    });
  });

  describe("when queued event arrives after finished (late delivery)", () => {
    // This does NOT cover "Late finish does not overwrite cancelled status" —
    // it never constructs a cancelled run. That scenario is bound in
    // simulationRunState.foldProjection.unit.test.ts, where the fold's own
    // terminal-status tests live.
    it("keeps the ERROR the finished event set instead of resurrecting QUEUED", async () => {
      const state = await processFold(
        [
          createStartedEvent(1000),
          createErrorFinishedEvent(5200),
          createQueuedEvent(500), // late!
        ],
        store,
        projection,
      );

      expect(state.Status, "Status must remain ERROR").toBe("ERROR");
      expect(state.FinishedAt, "FinishedAt must be set").not.toBeNull();
    });
  });

  // A cancel lands as a `finished` event carrying status CANCELLED. The worker
  // it cancelled can still be mid-turn and POST its own `finished`-SUCCESS, and
  // that success can be DELIVERED first while carrying the later occurredAt.
  // What puts the two in the right order is the status authority ladder, not
  // arrival and not a replay: without it a run the user cancelled would read
  // back SUCCESS to billing, suite rollups and the run list.
  describe("when a late success is delivered before the cancel that preceded it", () => {
    it("takes the cancel rather than keeping the success", async () => {
      const state = await processFold(
        [
          createStartedEvent(1000),
          createFinishedEvent(5200), // delivered first, but happened last
          createCancelledFinishedEvent(3000), // late!
        ],
        store,
        projection,
      );

      expect(state.Status, "Status must be CANCELLED").toBe("CANCELLED");
      expect(state.FinishedAt, "FinishedAt must be the cancel's time").toBe(
        3000,
      );
    });
  });

  /**
   * The reason this fold declines the out-of-order replay.
   *
   * A replay derives state from the events the fold still HANDLES, and this one
   * no longer handles every event in its own log: `metrics_computed` is retired,
   * and a run measured under it has its cost in those events and on its stored
   * row, nowhere else. `metrics_recorded` cannot recover it — that measurement
   * is only ever asked for by a deadline armed on a live `finished`, and the
   * spans it would re-derive from expire on the shorter `traces` retention. So a
   * replay does not rebuild the cost, it erases it, permanently.
   */
  describe("given a run whose cost was measured under the retired per-trace event", () => {
    const ctx: ProjectionStoreContext = {
      aggregateId: "run-1",
      tenantId: TEST_TENANT_ID,
    };

    /** What the retired handler left on the row before it was removed. */
    const MEASURED = {
      TotalCost: 0.004,
      RoleCosts: { Agent: [0.004] },
      RoleLatencies: { Agent: [900] },
    };

    /** The run's committed log, retired measurement included. */
    const log: SimulationProcessingEvent[] = [
      createQueuedEvent(500),
      createStartedEvent(1000),
      createMessageSnapshotEvent(5000),
      createFinishedEvent(5200),
      createRetiredMetricsComputedEvent(65000),
    ];

    async function deliverBackdated(
      event: SimulationProcessingEvent,
    ): Promise<SimulationRunStateData> {
      store.clear();
      let measured = projection.init();
      for (const committed of log) {
        measured = projection.apply(measured, committed);
      }
      await store.store({ ...measured, ...MEASURED }, ctx);

      const current = (await store.get("run-1", ctx))!;
      const prevLastOccurred = current.LastEventOccurredAt ?? 0;
      const next = projection.apply(current, event);

      if (
        projection.options?.refoldOnOutOfOrder !== false &&
        (event.occurredAt ?? 0) < prevLastOccurred
      ) {
        let refolded = projection.init();
        for (const committed of [...log, event].sort(
          (a, b) => (a.occurredAt ?? 0) - (b.occurredAt ?? 0),
        )) {
          refolded = projection.apply(refolded, committed);
        }
        store.clear();
        await store.store(refolded, ctx);
      } else {
        await store.store(next, ctx);
      }

      return (await store.get("run-1", ctx))!;
    }

    describe("when an event that occurred before the checkpoint arrives", () => {
      it("keeps the cost on the row instead of rebuilding it as blank", async () => {
        const state = await deliverBackdated(createStartedEvent(1000));

        expect(state.TotalCost, "the measured cost must survive").toBe(
          MEASURED.TotalCost,
        );
        expect(state.RoleCosts).toEqual(MEASURED.RoleCosts);
        expect(state.RoleLatencies).toEqual(MEASURED.RoleLatencies);
      });

      // Declining the replay is not declining the event: it is applied on top
      // of the state that was loaded, so a backdated cancel still outranks the
      // success already stored — and still does not cost the run its metrics.
      it("still applies the event on top of the state it loaded", async () => {
        const state = await deliverBackdated(
          createCancelledFinishedEvent(3000),
        );

        expect(state.Status).toBe("CANCELLED");
        expect(state.FinishedAt).toBe(3000);
        expect(state.TotalCost).toBe(MEASURED.TotalCost);
      });
    });
  });

  // Full lifecycle with all events in every possible order
  describe("when all lifecycle events (queued, started, finished, metrics) arrive in any order", () => {
    const events: SimulationProcessingEvent[] = [
      createQueuedEvent(500),
      createStartedEvent(1000),
      createFinishedEvent(5200),
      createMetricsRecordedEvent(65000),
    ];

    const allPerms = permutations(events);

    it.each(
      allPerms.map((perm, i) => ({
        name: `[${i}] ${perm.map(eventLabel).join(" → ")}`,
        perm,
      })),
    )("$name → final status is SUCCESS", async ({ name, perm }) => {
      const state = await processFold(perm, store, projection);
      expect(state.Status, `${name}: Status must be SUCCESS`).toBe("SUCCESS");
      expect(
        state.FinishedAt,
        `${name}: FinishedAt must be set`,
      ).not.toBeNull();
    });
  });
});
