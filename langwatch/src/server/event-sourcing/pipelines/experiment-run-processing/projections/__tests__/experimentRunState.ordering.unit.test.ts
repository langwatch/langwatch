/**
 * Combinatorial test for experiment run fold ordering.
 *
 * Proves that the fold produces correct final state regardless of
 * event processing order. Simulates the incremental fold pattern:
 * store.get() → apply(event) → store.store() for each event.
 *
 * The in-memory store mimics ClickHouse ReplacingMergeTree behavior:
 * multiple rows coexist, get() returns the one with highest UpdatedAt.
 *
 * Production pattern (verified from prod data):
 * - All events are bulk-inserted with the same CreatedAt
 * - started, target_result, evaluator_result, and completed can
 *   have nearly identical or even inverted occurredAt timestamps
 */
import { describe, expect, it } from "vitest";
import type { FoldProjectionStore } from "../../../../projections/foldProjection.types";
import type { ProjectionStoreContext } from "../../../../projections/projectionStoreContext";
import { createTenantId } from "../../../../domain/tenantId";
import {
  EXPERIMENT_RUN_EVENT_VERSIONS,
  EXPERIMENT_RUN_EVENT_TYPES,
} from "../../schemas/constants";
import type {
  ExperimentRunProcessingEvent,
  ExperimentRunStartedEvent,
  TargetResultEvent,
  EvaluatorResultEvent,
  ExperimentRunCompletedEvent,
} from "../../schemas/events";
import {
  ExperimentRunStateFoldProjection,
  type ExperimentRunStateData,
} from "../experimentRunState.foldProjection";

const TEST_TENANT_ID = createTenantId("tenant-1");

// --- In-memory store that mimics ReplacingMergeTree ---
function createReplacingMergeTreeStore(): FoldProjectionStore<ExperimentRunStateData> & {
  rows: ExperimentRunStateData[];
  clear: () => void;
} {
  const rows: ExperimentRunStateData[] = [];
  return {
    rows,
    clear() {
      rows.length = 0;
    },
    async store(state: ExperimentRunStateData): Promise<void> {
      rows.push({ ...state });
    },
    async get(
      _key: string,
      _ctx: ProjectionStoreContext,
    ): Promise<ExperimentRunStateData | null> {
      if (rows.length === 0) return null;
      return rows.reduce((best, row) =>
        row.UpdatedAt > best.UpdatedAt ? row : best,
      );
    },
  };
}

// --- Event factories ---
function createStartedEvent(
  occurredAt: number,
): ExperimentRunStartedEvent {
  return {
    id: "evt-started",
    aggregateId: "run-1",
    aggregateType: "experiment_run",
    tenantId: TEST_TENANT_ID,
    createdAt: occurredAt + 100,
    occurredAt,
    type: EXPERIMENT_RUN_EVENT_TYPES.STARTED,
    version: EXPERIMENT_RUN_EVENT_VERSIONS.STARTED,
    data: {
      runId: "run-1",
      experimentId: "experiment-1",
      total: 3,
      targets: [],
    },
  };
}

function createTargetResultEvent(
  index: number,
  occurredAt: number,
): TargetResultEvent {
  return {
    id: `evt-target-${index}`,
    aggregateId: "run-1",
    aggregateType: "experiment_run",
    tenantId: TEST_TENANT_ID,
    createdAt: occurredAt + 100,
    occurredAt,
    type: EXPERIMENT_RUN_EVENT_TYPES.TARGET_RESULT,
    version: EXPERIMENT_RUN_EVENT_VERSIONS.TARGET_RESULT,
    data: {
      runId: "run-1",
      experimentId: "experiment-1",
      index,
      targetId: "",
      entry: { question: `q${index}`, answer: `a${index}` },
      cost: 0.001,
      duration: 500,
    },
  };
}

function createEvaluatorResultEvent(
  index: number,
  occurredAt: number,
): EvaluatorResultEvent {
  return {
    id: `evt-eval-${index}`,
    aggregateId: "run-1",
    aggregateType: "experiment_run",
    tenantId: TEST_TENANT_ID,
    createdAt: occurredAt + 100,
    occurredAt,
    type: EXPERIMENT_RUN_EVENT_TYPES.EVALUATOR_RESULT,
    version: EXPERIMENT_RUN_EVENT_VERSIONS.EVALUATOR_RESULT,
    data: {
      runId: "run-1",
      experimentId: "experiment-1",
      index,
      targetId: "",
      evaluatorId: "sample_metric",
      evaluatorName: "sample_metric",
      status: "processed",
      score: 1,
      passed: true,
      cost: 0.0005,
    },
  };
}

function createCompletedEvent(
  occurredAt: number,
): ExperimentRunCompletedEvent {
  return {
    id: "evt-completed",
    aggregateId: "run-1",
    aggregateType: "experiment_run",
    tenantId: TEST_TENANT_ID,
    createdAt: occurredAt + 100,
    occurredAt,
    type: EXPERIMENT_RUN_EVENT_TYPES.COMPLETED,
    version: EXPERIMENT_RUN_EVENT_VERSIONS.COMPLETED,
    data: {
      runId: "run-1",
      experimentId: "experiment-1",
      finishedAt: occurredAt,
    },
  };
}

// --- Simulate incremental fold processing ---
async function processFold(
  events: ExperimentRunProcessingEvent[],
  store: FoldProjectionStore<ExperimentRunStateData> & { clear: () => void },
  projection: ExperimentRunStateFoldProjection,
): Promise<ExperimentRunStateData> {
  const ctx: ProjectionStoreContext = {
    aggregateId: "run-1",
    tenantId: TEST_TENANT_ID,
  };

  store.clear();
  for (const event of events) {
    const currentState =
      (await store.get("run-1", ctx)) ?? projection.init();
    const newState = projection.apply(currentState, event);
    await store.store(newState, ctx);
  }
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

function eventLabel(e: ExperimentRunProcessingEvent): string {
  const type = e.type.replace("lw.experiment_run.", "");
  if (
    e.type === EXPERIMENT_RUN_EVENT_TYPES.TARGET_RESULT ||
    e.type === EXPERIMENT_RUN_EVENT_TYPES.EVALUATOR_RESULT
  ) {
    return `${type}[${(e.data as any).index}]`;
  }
  return type;
}

describe("experiment run fold — event ordering invariants", () => {
  const store = createReplacingMergeTreeStore();
  const projection = new ExperimentRunStateFoldProjection({ store });

  function assertCorrectFinalState(
    state: ExperimentRunStateData,
    label: string,
  ) {
    expect(state.FinishedAt, `${label}: FinishedAt must be set`).not.toBeNull();
    expect(state.RunId, `${label}: RunId must be set`).toBe("run-1");
    expect(
      state.ExperimentId,
      `${label}: ExperimentId must be set`,
    ).toBe("experiment-1");
    expect(
      state.CompletedCount,
      `${label}: CompletedCount must be 3`,
    ).toBe(3);
    expect(state.Progress, `${label}: Progress must be 3`).toBe(3);
    expect(
      state.TotalCost,
      `${label}: TotalCost must be computed`,
    ).toBeGreaterThan(0);
    expect(
      state.ScoreCount,
      `${label}: ScoreCount must be 3`,
    ).toBe(3);
    expect(
      state.AvgScoreBps,
      `${label}: AvgScoreBps must be computed`,
    ).not.toBeNull();
    expect(
      state.PassRateBps,
      `${label}: PassRateBps must be computed`,
    ).not.toBeNull();
  }

  // Production pattern: all events bulk-inserted with same timestamp.
  // completed can have LOWER occurredAt than started/target_result.
  describe("when all events have identical occurredAt (bulk insert pattern)", () => {
    const TS = 1000;
    const started = createStartedEvent(TS);
    const afterStarted: ExperimentRunProcessingEvent[] = [
      createTargetResultEvent(0, TS),
      createTargetResultEvent(1, TS),
      createTargetResultEvent(2, TS),
      createEvaluatorResultEvent(0, TS),
      createEvaluatorResultEvent(1, TS),
      createEvaluatorResultEvent(2, TS),
      createCompletedEvent(TS),
    ];

    const allPerms = permutations(afterStarted).map((perm) => [
      started,
      ...perm,
    ]);

    describe(`started first, then ${afterStarted.length} events in all ${allPerms.length} orderings`, () => {
      it.each(
        allPerms.map((perm, i) => ({
          name: `[${i}] ${perm.map(eventLabel).join(" → ")}`,
          perm,
        })),
      )(
        "$name → final state is correct",
        async ({ name, perm }) => {
          const state = await processFold(perm, store, projection);
          assertCorrectFinalState(state, name);
        },
      );
    });
  });

  // Production-observed: completed has LOWER occurredAt than started
  describe("when completed has lower occurredAt than started (production pattern)", () => {
    it("started → targets → evals → completed (happy path)", async () => {
      const state = await processFold(
        [
          createStartedEvent(1000),
          createTargetResultEvent(0, 1001),
          createTargetResultEvent(1, 1002),
          createTargetResultEvent(2, 1003),
          createEvaluatorResultEvent(0, 1001),
          createEvaluatorResultEvent(1, 1002),
          createEvaluatorResultEvent(2, 1003),
          createCompletedEvent(999), // lower than started!
        ],
        store,
        projection,
      );
      assertCorrectFinalState(state, "completed lower occurredAt");
    });

    it("started → completed → targets → evals (completed before results)", async () => {
      const state = await processFold(
        [
          createStartedEvent(1000),
          createCompletedEvent(999),
          createTargetResultEvent(0, 1001),
          createTargetResultEvent(1, 1002),
          createTargetResultEvent(2, 1003),
          createEvaluatorResultEvent(0, 1001),
          createEvaluatorResultEvent(1, 1002),
          createEvaluatorResultEvent(2, 1003),
        ],
        store,
        projection,
      );
      assertCorrectFinalState(state, "completed before results");
    });
  });
});
