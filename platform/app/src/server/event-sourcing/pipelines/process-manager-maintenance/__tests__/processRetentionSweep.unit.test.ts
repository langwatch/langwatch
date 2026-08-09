import { register } from "prom-client";
import { describe, expect, it, vi } from "vitest";

// Registers the counter this suite reads back.
import "~/server/metrics";
import {
  CONSUMED_INBOX_RETENTION_MS,
  DEAD_OUTBOX_RETENTION_MS,
  DISPATCHED_OUTBOX_RETENTION_MS,
  type ProcessRetentionSweepDeps,
  processRetentionSweepWake,
  RETENTION_SWEEP_BATCH_SIZE,
  RETENTION_SWEEP_DEADLINE_MS,
  RETENTION_SWEEP_MAX_BATCHES_PER_WAKE,
  runProcessRetentionSweep,
} from "../process-manager/processRetentionSweep.process";

const NOW = 1_800_000_000_000;

/**
 * A family whose backlog is `available` rows, served in `limit`-sized batches
 * exactly as the durable store does, so the drain loop is exercised against
 * the same short-batch-means-drained signal it relies on in production.
 */
function backlog(available: number) {
  let remaining = available;
  return vi.fn(async ({ limit }: { before: number; limit: number }) => {
    const deleted = Math.min(remaining, limit);
    remaining -= deleted;
    return deleted;
  });
}

function deps(
  overrides: Partial<ProcessRetentionSweepDeps> = {},
): ProcessRetentionSweepDeps {
  return {
    deleteDispatchedOutboxBatch: backlog(0),
    deleteDeadOutboxBatch: backlog(0),
    deleteConsumedInboxBatch: backlog(0),
    now: () => NOW,
    ...overrides,
  };
}

describe("processRetentionSweep", () => {
  describe("given a scheduled sweep process", () => {
    describe("when the schedule wakes it", () => {
      it("emits one sweep intent keyed on the tick it woke at", () => {
        const sweep = vi.fn((key: string, payload: unknown) => ({
          key,
          payload,
        }));
        const result = processRetentionSweepWake({ lastSweepAt: null }, {
          at: NOW,
          intents: { sweep },
        } as never);

        expect(result.state).toEqual({ lastSweepAt: NOW });
        expect(sweep).toHaveBeenCalledWith(`sweep:${NOW}`, {
          scheduledFor: NOW,
        });
      });
    });
  });

  describe("given each family has a backlog", () => {
    describe("when the retention sweep runs", () => {
      it("reaps each family with its own retention window", async () => {
        const dispatched = backlog(1);
        const dead = backlog(1);
        const inbox = backlog(1);
        await runProcessRetentionSweep(
          deps({
            deleteDispatchedOutboxBatch: dispatched,
            deleteDeadOutboxBatch: dead,
            deleteConsumedInboxBatch: inbox,
          }),
        )();

        expect(dispatched).toHaveBeenCalledWith(
          expect.objectContaining({
            before: NOW - DISPATCHED_OUTBOX_RETENTION_MS,
          }),
        );
        expect(dead).toHaveBeenCalledWith(
          expect.objectContaining({ before: NOW - DEAD_OUTBOX_RETENTION_MS }),
        );
        expect(inbox).toHaveBeenCalledWith(
          expect.objectContaining({
            before: NOW - CONSUMED_INBOX_RETENTION_MS,
          }),
        );
      });

      /** @scenario "A wake stops at its batch budget" */
      it("deletes at most the per-wake budget and leaves the rest", async () => {
        const budget =
          RETENTION_SWEEP_BATCH_SIZE * RETENTION_SWEEP_MAX_BATCHES_PER_WAKE;
        const dispatched = backlog(budget + RETENTION_SWEEP_BATCH_SIZE);

        await runProcessRetentionSweep(
          deps({ deleteDispatchedOutboxBatch: dispatched }),
        )();

        expect(dispatched).toHaveBeenCalledTimes(
          RETENTION_SWEEP_MAX_BATCHES_PER_WAKE,
        );
        const deleted = (
          await Promise.all(dispatched.mock.results.map((r) => r.value))
        ).reduce((sum: number, count: number) => sum + count, 0);
        expect(deleted).toBe(budget);
      });

      /** @scenario "A family that runs dry ends its drain loop early" */
      it("stops asking for batches once one comes back short", async () => {
        const dispatched = backlog(RETENTION_SWEEP_BATCH_SIZE - 1);

        await runProcessRetentionSweep(
          deps({ deleteDispatchedOutboxBatch: dispatched }),
        )();

        expect(dispatched).toHaveBeenCalledTimes(1);
      });

      it("issues no second statement for a family that was already empty", async () => {
        const inbox = backlog(0);

        await runProcessRetentionSweep(
          deps({ deleteConsumedInboxBatch: inbox }),
        )();

        expect(inbox).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("given one family's delete fails", () => {
    describe("when the retention sweep runs", () => {
      /** @scenario "One family failing does not stop the others" */
      it("still sweeps the other families and does not fail the wake", async () => {
        const dead = backlog(1);
        const inbox = backlog(1);

        await expect(
          runProcessRetentionSweep(
            deps({
              deleteDispatchedOutboxBatch: vi.fn(async () => {
                throw new Error("relation is locked");
              }),
              deleteDeadOutboxBatch: dead,
              deleteConsumedInboxBatch: inbox,
            }),
          )(),
        ).resolves.toBeUndefined();

        expect(dead).toHaveBeenCalledTimes(1);
        expect(inbox).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("given the deletes are slow enough to outlast the wake budget", () => {
    /**
     * A clock that advances a fixed amount on every read, so each batch
     * "takes" that long. Deterministic, and it does not need real time to
     * pass: what is under test is that the loop consults the deadline at all.
     */
    function creepingClock(stepMs: number) {
      let current = NOW;
      return () => {
        const value = current;
        current += stepMs;
        return value;
      };
    }

    describe("when the retention sweep runs", () => {
      /** @scenario "A slow wake stops before its outbox lease expires" */
      it("stops draining at the deadline instead of running past the lease", async () => {
        // Each batch costs a tenth of the budget, so the family runs out of
        // time long before it runs out of its 200-batch allowance.
        const dispatched = backlog(Number.MAX_SAFE_INTEGER);

        await runProcessRetentionSweep(
          deps({
            deleteDispatchedOutboxBatch: dispatched,
            now: creepingClock(RETENTION_SWEEP_DEADLINE_MS / 10),
          }),
        )();

        expect(dispatched.mock.calls.length).toBeLessThan(
          RETENTION_SWEEP_MAX_BATCHES_PER_WAKE,
        );
      });

      it("leaves the remaining rows for the next hourly tick", async () => {
        // Stopping early is not an error. The rows are still eligible, and the
        // next wake picks them up; running past the lease would instead let a
        // second worker start a concurrent sweep on the same predicates.
        const dispatched = backlog(Number.MAX_SAFE_INTEGER);

        await expect(
          runProcessRetentionSweep(
            deps({
              deleteDispatchedOutboxBatch: dispatched,
              now: creepingClock(RETENTION_SWEEP_DEADLINE_MS),
            }),
          )(),
        ).resolves.toBeUndefined();

        // The deadline is already spent when the first batch is considered.
        expect(dispatched).not.toHaveBeenCalled();
      });
    });
  });

  describe("given rows were deleted in more than one family", () => {
    describe("when the sweep reports what it deleted", () => {
      /** @scenario "The sweep reports how much it deleted per table" */
      it("names the family each count belongs to", async () => {
        // Read the real counter rather than a spy on the module binding: the
        // claim worth pinning is that an operator can tell dispatched-outbox
        // reaping apart from inbox reaping on the metric they actually scrape.
        const counter = register.getSingleMetric(
          "process_manager_retention_swept_rows_total",
        )!;
        const before = await familyCounts(counter);

        await runProcessRetentionSweep(
          deps({
            deleteDispatchedOutboxBatch: backlog(3),
            deleteConsumedInboxBatch: backlog(7),
          }),
        )();

        const after = await familyCounts(counter);
        expect(
          (after.dispatched_outbox ?? 0) - (before.dispatched_outbox ?? 0),
        ).toBe(3);
        expect((after.inbox ?? 0) - (before.inbox ?? 0)).toBe(7);
      });
    });
  });
});

/** Current value of the swept-rows counter, broken out by its family label. */
async function familyCounts(
  counter: ReturnType<typeof register.getSingleMetric>,
): Promise<Record<string, number>> {
  const metric = await counter!.get();
  const counts: Record<string, number> = {
    dispatched_outbox: 0,
    dead_outbox: 0,
    inbox: 0,
  };
  for (const sample of metric.values) {
    const family = sample.labels.family;
    if (typeof family === "string") counts[family] = sample.value;
  }
  return counts;
}
