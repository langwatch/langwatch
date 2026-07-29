/**
 * A redelivered result must not inflate the run's counters.
 *
 * The fold accumulates: `Progress`/`CompletedCount` are `+= 1` per delivered
 * target result. That is correct — and canonical — as long as the executor can
 * tell a redelivery from a fresh event, which it does with the applied-event-id
 * watermark (`FoldProjectionExecutor.dropAlreadyApplied`).
 *
 * The watermark used to live ONLY on the Redis cache entry for this projection.
 * These tests drive the real `FoldProjectionExecutor` against the real store
 * factory and the memory repository, and exercise the two paths that matter:
 *
 *  - warm read: the watermark comes back and the redelivery is skipped;
 *  - COLD read (cache lost between the commit and the retry): the watermark now
 *    comes back from the durable row instead. Before migration 00064 and
 *    `getWithApplied` it came back empty, the executor blind-re-applied, and the
 *    run's progress bar drifted past its own total permanently — there is no
 *    re-fold path to correct it (`refoldOnOutOfOrder: false`, no
 *    `refoldOnStoreMiss`).
 *
 * The cold case is simulated by going straight to the durable store, which is
 * exactly what `CachedFoldStore` does on a cache miss.
 */
import { describe, expect, it } from "vitest";
import { createTenantId } from "../../../../domain/tenantId";
import { FoldProjectionExecutor } from "../../../../projections/foldProjectionExecutor";
import type { ProjectionStoreContext } from "../../../../projections/projectionStoreContext";
import { ExperimentRunStateRepositoryMemory } from "../../repositories/experimentRunState.memory.repository";
import {
  EXPERIMENT_RUN_EVENT_TYPES,
  EXPERIMENT_RUN_EVENT_VERSIONS,
} from "../../schemas/constants";
import type {
  ExperimentRunStartedEvent,
  TargetResultEvent,
} from "../../schemas/events";
import {
  type ExperimentRunStateData,
  ExperimentRunStateFoldProjection,
} from "../experimentRunState.foldProjection";
import { createExperimentRunStateFoldStore } from "../experimentRunState.store";

const TEST_TENANT_ID = createTenantId("tenant-1");
const AGGREGATE_ID = "exp-1:run-123";

function startedEvent(): ExperimentRunStartedEvent {
  return {
    id: "evt-started",
    aggregateId: AGGREGATE_ID,
    aggregateType: "experiment_run",
    tenantId: TEST_TENANT_ID,
    createdAt: 1000,
    occurredAt: 1000,
    type: EXPERIMENT_RUN_EVENT_TYPES.STARTED,
    version: EXPERIMENT_RUN_EVENT_VERSIONS.STARTED,
    data: {
      runId: "run-123",
      experimentId: "exp-1",
      total: 1,
      targets: [{ id: "target-1", name: "Target 1", type: "llm" }],
    },
  };
}

/** One target result. Redelivering it means folding this SAME event twice. */
function targetResultEvent(): TargetResultEvent {
  return {
    id: "evt-target-0",
    aggregateId: AGGREGATE_ID,
    aggregateType: "experiment_run",
    tenantId: TEST_TENANT_ID,
    createdAt: 2000,
    occurredAt: 2000,
    type: EXPERIMENT_RUN_EVENT_TYPES.TARGET_RESULT,
    version: EXPERIMENT_RUN_EVENT_VERSIONS.TARGET_RESULT,
    data: {
      runId: "run-123",
      experimentId: "exp-1",
      index: 0,
      targetId: "target-1",
      entry: { input: "test" },
      predicted: { output: "result" },
    },
  };
}

function makeFold() {
  const repository = new ExperimentRunStateRepositoryMemory();
  const projection = new ExperimentRunStateFoldProjection({
    store: createExperimentRunStateFoldStore(repository),
  });
  return { repository, projection, executor: new FoldProjectionExecutor() };
}

function context(deliveryAttempt: number): ProjectionStoreContext {
  return {
    aggregateId: AGGREGATE_ID,
    tenantId: TEST_TENANT_ID,
    deliveryAttempt,
  };
}

async function readState(
  repository: ExperimentRunStateRepositoryMemory,
): Promise<ExperimentRunStateData> {
  const { projection } = await repository.getProjectionWithApplied(
    AGGREGATE_ID,
    { tenantId: TEST_TENANT_ID },
  );
  return projection!.data as ExperimentRunStateData;
}

describe("experiment run fold — redelivery", () => {
  describe("given a run with one completed item", () => {
    describe("when that item's result is delivered once", () => {
      it("counts it once", async () => {
        const { repository, projection, executor } = makeFold();

        await executor.execute(projection, startedEvent(), context(1));
        await executor.execute(projection, targetResultEvent(), context(1));

        const state = await readState(repository);
        expect(state.Progress).toBe(1);
        expect(state.CompletedCount).toBe(1);
      });
    });

    describe("when that item's result is recorded more than once", () => {
      /** @scenario A repeated item result does not inflate the run */
      it("still reports one completed item", async () => {
        const { repository, projection, executor } = makeFold();

        await executor.execute(projection, startedEvent(), context(1));
        await executor.execute(projection, targetResultEvent(), context(1));

        // The queue re-dispatches the batch: same event id, second attempt.
        // The watermark read back from the durable row is what recognises it.
        await executor.execute(projection, targetResultEvent(), context(2));

        const state = await readState(repository);
        expect(state.Progress).toBe(1);
        expect(state.CompletedCount).toBe(1);
      });

      /** @scenario A repeated item result does not inflate the run */
      it("does not push the run past the total it was started with", async () => {
        const { repository, projection, executor } = makeFold();

        await executor.execute(projection, startedEvent(), context(1));
        await executor.execute(projection, targetResultEvent(), context(1));
        await executor.execute(projection, targetResultEvent(), context(2));
        await executor.execute(projection, targetResultEvent(), context(3));

        const state = await readState(repository);
        // The drift this prevents is user-visible: `Progress` is what the run
        // page renders as `{progress}/{total}`, so an inflated counter reads
        // "2/1" beside a single item row, for good.
        expect(state.Progress).toBeLessThanOrEqual(state.Total);
        expect(state.Progress).toBe(1);
      });

      /** @scenario A repeated item result does not inflate the run */
      it("counts its cost once, because the run holds no cost to inflate", async () => {
        const { repository, projection, executor } = makeFold();

        await executor.execute(projection, startedEvent(), context(1));
        await executor.execute(projection, targetResultEvent(), context(1));
        await executor.execute(projection, targetResultEvent(), context(2));

        const state = await readState(repository);
        // Cost was removed from this fold by ADR-072 and is summed from
        // `experiment_run_items` at read time. A redelivery writes the SAME
        // keyed item row, which the ReplacingMergeTree dedup collapses, so the
        // figure is counted once on both sides — there is no accumulator here
        // for a second delivery to touch. The read half is covered by
        // `experiment-run.runTotals.unit.test.ts`.
        expect(state).not.toHaveProperty("TotalCost");
        expect(state).not.toHaveProperty("TraceMetrics");
      });
    });
  });

  describe("given the fold cache was lost between the commit and the retry", () => {
    describe("when the same result is redelivered", () => {
      /** @scenario A repeated item result does not inflate the run */
      it("recognises it from the watermark persisted next to the row", async () => {
        const { repository, projection, executor } = makeFold();

        await executor.execute(projection, startedEvent(), context(1));
        await executor.execute(projection, targetResultEvent(), context(1));

        // Going straight at the durable store IS the cold-cache path: it is
        // what CachedFoldStore falls through to on a miss. Before the durable
        // watermark this read answered `[]` and the counter double-counted.
        const { appliedEventIds } = await repository.getProjectionWithApplied(
          AGGREGATE_ID,
          { tenantId: TEST_TENANT_ID },
        );
        expect(appliedEventIds).toContain("evt-target-0");

        await executor.execute(projection, targetResultEvent(), context(2));

        const state = await readState(repository);
        expect(state.Progress).toBe(1);
        expect(state.CompletedCount).toBe(1);
      });
    });
  });
});
