/**
 * Fold redelivery idempotency — end-to-end, through the real GroupQueue.
 *
 * The defect this pins: queue delivery is at-least-once, and a fold job that
 * fails AFTER its state was stored is redelivered. Four of seven fold
 * projections accumulate (`spanCount + 1`, token and cost sums, id appends),
 * so a redelivery double-counts silently.
 *
 * These drive the REAL `GroupQueueProcessor` against real Redis rather than
 * calling the executor directly, because the interesting behaviour is not in
 * the executor: it is in what the queue re-delivers after a post-store failure,
 * and specifically in the drained siblings it re-stages. A test that calls
 * `executeBatch` twice by hand cannot see that.
 *
 * Plan: dev/docs/plans/fold-idempotency-plan.md
 * Spec: specs/event-sourcing/redis-fold-cache.feature
 *
 * TWO OF THESE ARE EXPECTED TO FAIL until Phase 1 lands — they pin known bugs:
 *   - "does not re-apply drained siblings" → groupQueue.ts:1082-1088, whose
 *     comment claims nothing was persisted on failure. It is false for every
 *     throw site after the store write, and the catch re-stages up to 499
 *     already-folded siblings.
 *   - "preserves the retry budget across sibling restaging" → groupQueue.ts:1318-1325,
 *     where re-staged siblings lose `__attempt`, silently resetting the
 *     25-attempt budget.
 */
import type { Redis } from "ioredis";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  getTestRedisConnection,
  startTestContainers,
  stopTestContainers,
} from "../../../__tests__/integration/testContainers";
import { createTenantId } from "../../../domain/tenantId";
import type { Event } from "../../../domain/types";
import { GroupQueueProcessor } from "../../../queues/groupQueue/groupQueue";
import type { EventSourcedQueueDefinition } from "../../../queues/queue.types";
import { createMockFoldProjectionDefinition } from "../../../services/__tests__/testHelpers";
import { FoldProjectionExecutor } from "../../foldProjectionExecutor";
import type { FoldProjectionStore } from "../../foldProjection.types";
import type { ProjectionStoreContext } from "../../projectionStoreContext";
import { RedisCachedFoldStore } from "../../redisCachedFoldStore";

const hasTestcontainers = !!(
  process.env.TEST_CLICKHOUSE_URL ||
  process.env.CI_CLICKHOUSE_URL ||
  process.env.REDIS_URL ||
  process.env.CI_REDIS_URL
);

const TENANT = createTenantId("tenant-redelivery");
const AGGREGATE = "trace-1";

interface CounterState {
  count: number;
  UpdatedAt: number;
}

/** Payload shape the queue carries — one fold event per job. */
interface FoldJob extends Record<string, unknown> {
  eventId: string;
  groupId: string;
  occurredAt: number;
}

/**
 * Stands in for the fire-and-forget ClickHouse write: `store()` returns before
 * the row is readable. That lag is why the cache exists, so the harness has to
 * reproduce it rather than assume writes land instantly.
 */
function createDurableStore() {
  let committed: CounterState | null = null;
  const store: FoldProjectionStore<CounterState> = {
    async store(state) {
      committed = state;
    },
    async get() {
      return committed;
    },
  };
  return { store, committed: () => committed };
}

function toEvent(
  job: FoldJob,
  aggregateId: string = AGGREGATE,
  tenantId: ReturnType<typeof createTenantId> = TENANT,
): Event {
  return {
    id: job.eventId,
    aggregateId,
    aggregateType: "trace",
    tenantId,
    createdAt: job.occurredAt,
    occurredAt: job.occurredAt,
    version: "2026-01-01",
    type: "test.fold.event",
    data: {},
  } as unknown as Event;
}

describe.skipIf(!hasTestcontainers)("fold redelivery idempotency", () => {
  let redis: Redis;
  const queues: GroupQueueProcessor<FoldJob>[] = [];
  const executor = new FoldProjectionExecutor();

  beforeAll(async () => {
    await startTestContainers();
    redis = getTestRedisConnection()!;
  }, 120_000);

  beforeEach(() => {
    queues.length = 0;
  });

  afterEach(async () => {
    for (const queue of queues) await queue.close?.();
    const keys = await redis.keys("*test/fold-redelivery*");
    if (keys.length > 0) await redis.del(...keys);
    // Every fold key this suite creates, not just one prefix — a stale
    // applied-set leaking into the next test suppresses its events and shows
    // up as an unexplained timeout rather than an assertion failure.
    const foldKeys = await redis.keys("fold:it_*");
    if (foldKeys.length > 0) await redis.del(...foldKeys);
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await stopTestContainers();
  });

  /**
   * Builds a queue whose handler folds its events and then optionally throws —
   * reproducing a reactor failure after the fold state was already stored,
   * which is the window `projectionRouter.ts:1570-1581` opens.
   */
  function createFoldQueue({
    keyPrefix,
    failFirstBatch,
    failAlways,
    failures,
    coalesce,
    aggregateId = AGGREGATE,
    tenantId = TENANT,
  }: {
    keyPrefix: string;
    failFirstBatch?: boolean;
    failAlways?: boolean;
    failures?: number;
    coalesce?: number;
    aggregateId?: string;
    tenantId?: ReturnType<typeof createTenantId>;
  }) {
    const durable = createDurableStore();
    const cached = new RedisCachedFoldStore<CounterState>(durable.store, redis, {
      keyPrefix,
      checkDelayMs: 60_000,
    });

    const fold = createMockFoldProjectionDefinition("counter", {
      store: cached,
      // Empty means "every event type" — the harness emits its own type, which
      // is not in the helper's default list.
      eventTypes: [],
      init: () => ({ count: 0, UpdatedAt: 0 }),
      apply: (state: CounterState, event: Event) => {
        order.push(event.id);
        return {
          count: state.count + 1,
          UpdatedAt: Math.max(Date.now(), state.UpdatedAt + 1),
        };
      },
    });

    const context: ProjectionStoreContext = {
      aggregateId,
      tenantId,
    };

    const applied: string[][] = [];
    /** Every event id the fold actually applied, in the order it applied them. */
    const order: string[] = [];
    let failuresLeft = failAlways
      ? Number.POSITIVE_INFINITY
      : (failures ?? (failFirstBatch ? 1 : 0));

    const runBatch = async (
      jobs: FoldJob[],
      delivery?: { attempt: number },
    ) => {
      applied.push(jobs.map((job) => job.eventId));
      await executor.executeBatch(
        fold,
        jobs.map((job) => toEvent(job, aggregateId, tenantId)),
        { ...context, deliveryAttempt: delivery?.attempt },
      );
      if (failuresLeft > 0) {
        failuresLeft--;
        // The fold state is committed at this point. Everything from here to
        // the ack is the redelivery window.
        throw new Error("reactor dispatch failed after the fold was stored");
      }
    };

    const name = `{test/fold-redelivery/${crypto.randomUUID().slice(0, 8)}}`;
    const definition: EventSourcedQueueDefinition<FoldJob> = {
      name,
      groupKey: (job) => job.groupId,
      score: (job) => job.occurredAt,
      process: async (job, delivery) => runBatch([job], delivery),
      ...(coalesce
        ? {
            processBatch: async (jobs, delivery) => runBatch(jobs, delivery),
            coalesceMaxBatch: () => coalesce,
          }
        : {}),
    } as EventSourcedQueueDefinition<FoldJob>;

    const queue = new GroupQueueProcessor<FoldJob>(definition, redis, {
      consumerEnabled: true,
    });
    queues.push(queue);

    const readAppliedIds = async (): Promise<string[]> => {
      const raw = await redis.get(
        `fold:${keyPrefix}:${String(tenantId)}:${aggregateId}`,
      );
      if (raw === null) return [];
      const parsed = JSON.parse(raw) as { e?: string[] };
      return parsed.e ?? [];
    };

    return { queue, name, durable, applied, order, readAppliedIds };
  }

  describe("given a fold job that fails after its state was stored", () => {
    describe("when the queue redelivers it", () => {
      it("counts the event once, not twice", async () => {
        const { queue, durable, applied } = createFoldQueue({
          keyPrefix: "it_redeliver_single",
          failFirstBatch: true,
        });
        await queue.waitUntilReady();

        await queue.send({
          eventId: "event-1",
          groupId: AGGREGATE,
          occurredAt: Date.now(),
        });

        // Delivered at least twice: the failure, then the retry.
        await vi.waitFor(() => expect(applied.length).toBeGreaterThanOrEqual(2), {
          timeout: 15_000,
          interval: 50,
        });

        expect(durable.committed()?.count).toBe(1);
      }, 30_000);
    });
  });

  describe("given a coalesced batch that fails after its state was stored", () => {
    describe("when the queue re-stages the drained siblings", () => {
      it("does not re-apply the siblings whose events were already folded in", async () => {
        const { queue, durable, applied } = createFoldQueue({
          keyPrefix: "it_redeliver_batch",
          failFirstBatch: true,
          coalesce: 10,
        });
        await queue.waitUntilReady();

        const occurredAt = Date.now();
        for (let index = 0; index < 5; index++) {
          await queue.send({
            eventId: `event-${index}`,
            groupId: AGGREGATE,
            occurredAt: occurredAt + index,
          });
        }

        await vi.waitFor(() => expect(applied.length).toBeGreaterThanOrEqual(2), {
          timeout: 15_000,
          interval: 50,
        });

        // Five distinct events, however many times they were delivered.
        await vi.waitFor(
          () => expect(durable.committed()?.count).toBe(5),
          { timeout: 15_000, interval: 100 },
        );
      }, 30_000);
    });
  });

  describe("given a batch failure that re-stages drained siblings", () => {
    describe("when a sibling leads the next attempt", () => {
      it("still reports a retry rather than a fresh delivery", async () => {
        // A re-staged sibling carries no attempt of its own. If that read as a
        // fresh delivery it would both restart the 25-attempt budget and, for a
        // fold, discard the record of what the chain already applied — so the
        // chain counter lives on the group, not on the job.
        const { queue, name } = createFoldQueue({
          keyPrefix: "it_redeliver_attempt",
          failAlways: true,
          coalesce: 10,
        });
        await queue.waitUntilReady();

        const occurredAt = Date.now();
        for (let index = 0; index < 3; index++) {
          await queue.send({
            eventId: `event-${index}`,
            groupId: AGGREGATE,
            occurredAt: occurredAt + index,
          });
        }

        await vi.waitFor(
          async () => {
            const recorded = await redis.get(
              `${name}:gq:group:${AGGREGATE}:attempt`,
            );
            expect(Number(recorded)).toBeGreaterThan(1);
          },
          { timeout: 20_000, interval: 100 },
        );
      }, 40_000);
    });

    describe("when the chain finally succeeds", () => {
      it("clears the counter so the next delivery is fresh again", async () => {
        const { queue, name, durable } = createFoldQueue({
          keyPrefix: "it_attempt_cleared",
          failFirstBatch: true,
          coalesce: 10,
        });
        await queue.waitUntilReady();

        await queue.send({
          eventId: "cleared-1",
          groupId: AGGREGATE,
          occurredAt: Date.now(),
        });

        await vi.waitFor(() => expect(durable.committed()?.count).toBe(1), {
          timeout: 20_000,
          interval: 50,
        });
        await vi.waitFor(
          async () => {
            const recorded = await redis.get(
              `${name}:gq:group:${AGGREGATE}:attempt`,
            );
            expect(recorded).toBeNull();
          },
          { timeout: 15_000, interval: 100 },
        );
      }, 40_000);
    });
  });

  describe("given a retry chain where each attempt fails after storing", () => {
    describe("when new events arrive between attempts", () => {
      it("counts every distinct event once across the whole chain", async () => {
        // This is the case the applied-set accumulates FOR. Retry 1 skips the
        // redelivered batch and applies whatever arrived alongside it; if the
        // entry held only that last write, retry 2 — which redelivers the whole
        // set — would no longer recognise the original batch and re-apply it.
        const { queue, durable, applied } = createFoldQueue({
          keyPrefix: "it_retry_chain",
          failures: 2,
          coalesce: 10,
        });
        await queue.waitUntilReady();

        const base = Date.now();
        for (let index = 0; index < 3; index++) {
          await queue.send({
            eventId: `first-${index}`,
            groupId: AGGREGATE,
            occurredAt: base + index,
          });
        }

        await vi.waitFor(() => expect(applied.length).toBeGreaterThanOrEqual(1), {
          timeout: 15_000,
          interval: 50,
        });

        // Arrive mid-chain, so a retry batch mixes redelivered and fresh events.
        for (let index = 0; index < 2; index++) {
          await queue.send({
            eventId: `second-${index}`,
            groupId: AGGREGATE,
            occurredAt: base + 100 + index,
          });
        }

        await vi.waitFor(() => expect(durable.committed()?.count).toBe(5), {
          timeout: 20_000,
          interval: 100,
        });
        // At least one redelivery happened; how many batches the queue formed
        // is its own scheduling business and not something to assert on.
        expect(applied.length).toBeGreaterThanOrEqual(2);
      }, 40_000);
    });
  });

  describe("given the same aggregate id under two different tenants", () => {
    describe("when both fold and one is redelivered", () => {
      it("keeps their applied-sets isolated", async () => {
        // Aggregate ids are not unique across tenants — trace ids repeat — so a
        // shared applied-set would let one tenant's redelivery suppress
        // another tenant's genuinely new event.
        const other = createTenantId("tenant-redelivery-other");
        const a = createFoldQueue({
          keyPrefix: "it_tenant_a",
          failFirstBatch: true,
        });
        const b = createFoldQueue({ keyPrefix: "it_tenant_a", tenantId: other });
        await a.queue.waitUntilReady();
        await b.queue.waitUntilReady();

        const now = Date.now();
        await a.queue.send({
          eventId: "shared-event-id",
          groupId: AGGREGATE,
          occurredAt: now,
        });
        await b.queue.send({
          eventId: "shared-event-id",
          groupId: AGGREGATE,
          occurredAt: now,
        });

        await vi.waitFor(
          () => {
            expect(a.durable.committed()?.count).toBe(1);
            expect(b.durable.committed()?.count).toBe(1);
          },
          { timeout: 20_000, interval: 100 },
        );
      }, 40_000);
    });
  });

  describe("given two aggregates folding concurrently", () => {
    describe("when one of them is redelivered", () => {
      it("does not suppress or double-count the other", async () => {
        const { queue, durable } = createFoldQueue({
          keyPrefix: "it_two_aggregates",
          failFirstBatch: true,
        });
        const second = createFoldQueue({
          keyPrefix: "it_two_aggregates",
          aggregateId: "trace-2",
        });
        await queue.waitUntilReady();
        await second.queue.waitUntilReady();

        const now = Date.now();
        await queue.send({ eventId: "a1", groupId: AGGREGATE, occurredAt: now });
        await second.queue.send({
          eventId: "b1",
          groupId: "trace-2",
          occurredAt: now,
        });

        await vi.waitFor(
          () => {
            expect(durable.committed()?.count).toBe(1);
            expect(second.durable.committed()?.count).toBe(1);
          },
          { timeout: 20_000, interval: 100 },
        );
      }, 40_000);
    });
  });

  describe("given an event that arrives out of order after a redelivery", () => {
    describe("when it has an earlier occurredAt but a new id", () => {
      it("applies it rather than mistaking it for a duplicate", async () => {
        // Dedup keys on event id, deliberately not on occurredAt — a late
        // arrival is a real event, and folds carrying refoldOnOutOfOrder:false
        // are expected to apply it.
        const { queue, durable, applied } = createFoldQueue({
          keyPrefix: "it_out_of_order",
          failFirstBatch: true,
        });
        await queue.waitUntilReady();

        const base = Date.now();
        await queue.send({
          eventId: "late-anchor",
          groupId: AGGREGATE,
          occurredAt: base,
        });
        await vi.waitFor(() => expect(applied.length).toBeGreaterThanOrEqual(2), {
          timeout: 15_000,
          interval: 50,
        });

        await queue.send({
          eventId: "late-arrival",
          groupId: AGGREGATE,
          occurredAt: base - 60_000,
        });

        await vi.waitFor(() => expect(durable.committed()?.count).toBe(2), {
          timeout: 20_000,
          interval: 100,
        });
      }, 40_000);
    });
  });

  describe("given the cache entry is lost before a redelivery", () => {
    describe("when the job is retried", () => {
      it("double-counts — the known limit of a cache-held applied-set", async () => {
        // Not a bug report, a boundary. The applied-set lives in the cache
        // entry, so eviction or Redis loss takes the dedup with it. This
        // degrades to the pre-existing behaviour rather than to something
        // worse, and it is the reason the plan does not claim this closes the
        // cold path. Pinned so the limit is visible rather than folklore.
        const { queue, durable, applied } = createFoldQueue({
          keyPrefix: "it_cache_lost",
          failFirstBatch: true,
        });
        await queue.waitUntilReady();

        await queue.send({
          eventId: "event-1",
          groupId: AGGREGATE,
          occurredAt: Date.now(),
        });

        await vi.waitFor(() => expect(applied.length).toBeGreaterThanOrEqual(1), {
          timeout: 15_000,
          interval: 50,
        });

        // Keep the entry evicted for the whole retry window. Deleting once
        // races the retry: if the redelivery lands first it dedups normally and
        // the count never moves, which surfaces as an unexplained timeout.
        const evict = setInterval(() => {
          void redis
            .keys("fold:it_cache_lost:*")
            .then((keys) => (keys.length > 0 ? redis.del(...keys) : 0));
        }, 20);

        try {
          await vi.waitFor(() => expect(durable.committed()?.count).toBe(2), {
            timeout: 20_000,
            interval: 100,
          });
        } finally {
          clearInterval(evict);
        }
      }, 40_000);
    });
  });


  // ==========================================================================
  // Applied-set lifecycle.
  //
  // The set exists to recognise redeliveries. An event can only be redelivered
  // while its job is unacked, so ids from an acked batch are dead weight — and
  // today they are never dropped, which is what makes the set 91.5% of a small
  // trace's cache entry. Attempt number distinguishes the two cases: attempt 1
  // is a fresh delivery (previous chain acked, old ids dead), attempt > 1 is a
  // retry (chain still live, old ids still needed).
  // ==========================================================================

  describe("applied-set lifecycle", () => {
    describe("given consecutive batches that all succeed", () => {
      it("keeps the set at one batch instead of growing without bound", async () => {
        const { queue, readAppliedIds, durable } = createFoldQueue({
          keyPrefix: "it_lifecycle_happy",
        });
        await queue.waitUntilReady();

        const base = Date.now();
        for (let batch = 0; batch < 4; batch++) {
          await queue.send({
            eventId: `batch${batch}-e0`,
            groupId: AGGREGATE,
            occurredAt: base + batch * 1_000,
          });
          await vi.waitFor(
            () => expect(durable.committed()?.count).toBe(batch + 1),
            { timeout: 15_000, interval: 50 },
          );
        }

        // Four acked deliveries. Nothing from batches 0-2 can ever come back,
        // so carrying their ids is pure waste.
        const ids = await readAppliedIds();
        expect(ids).toEqual(["batch3-e0"]);
      }, 60_000);
    });

    describe("given a retry chain that has not yet acked", () => {
      it("accumulates across attempts so nothing in the chain is forgotten", async () => {
        const { queue, readAppliedIds, applied } = createFoldQueue({
          keyPrefix: "it_lifecycle_chain",
          failures: 2,
          coalesce: 10,
        });
        await queue.waitUntilReady();

        const base = Date.now();
        for (let index = 0; index < 3; index++) {
          await queue.send({
            eventId: `chain-${index}`,
            groupId: AGGREGATE,
            occurredAt: base + index,
          });
        }

        await vi.waitFor(() => expect(applied.length).toBeGreaterThanOrEqual(2), {
          timeout: 20_000,
          interval: 50,
        });

        const ids = await readAppliedIds();
        expect(ids).toEqual(
          expect.arrayContaining(["chain-0", "chain-1", "chain-2"]),
        );
      }, 40_000);
    });

    describe("given a chain that eventually acked", () => {
      it("drops the chain's ids once a fresh batch arrives", async () => {
        const { queue, readAppliedIds, durable } = createFoldQueue({
          keyPrefix: "it_lifecycle_reset",
          failFirstBatch: true,
          coalesce: 10,
        });
        await queue.waitUntilReady();

        const base = Date.now();
        await queue.send({
          eventId: "chain-a",
          groupId: AGGREGATE,
          occurredAt: base,
        });
        await vi.waitFor(() => expect(durable.committed()?.count).toBe(1), {
          timeout: 20_000,
          interval: 50,
        });

        // Fresh delivery after the chain acked.
        await queue.send({
          eventId: "fresh-b",
          groupId: AGGREGATE,
          occurredAt: base + 5_000,
        });
        await vi.waitFor(() => expect(durable.committed()?.count).toBe(2), {
          timeout: 20_000,
          interval: 50,
        });

        const ids = await readAppliedIds();
        expect(ids).toEqual(["fresh-b"]);
        expect(ids).not.toContain("chain-a");
      }, 60_000);
    });
  });

  // ==========================================================================
  // Things that must NOT happen.
  // ==========================================================================

  describe("negative guarantees", () => {
    describe("given a stale applied-set from an earlier batch", () => {
      it("never suppresses a genuinely new event", async () => {
        const { queue, durable, order } = createFoldQueue({
          keyPrefix: "it_negative_suppress",
        });
        await queue.waitUntilReady();

        const base = Date.now();
        for (let index = 0; index < 6; index++) {
          await queue.send({
            eventId: `distinct-${index}`,
            groupId: AGGREGATE,
            occurredAt: base + index * 500,
          });
        }

        await vi.waitFor(() => expect(durable.committed()?.count).toBe(6), {
          timeout: 25_000,
          interval: 50,
        });
        // Every event applied exactly once — none skipped, none doubled.
        expect(order).toEqual([
          "distinct-0",
          "distinct-1",
          "distinct-2",
          "distinct-3",
          "distinct-4",
          "distinct-5",
        ]);
      }, 45_000);
    });

    describe("given a redelivery", () => {
      it("skips the duplicate without dropping anything else in the batch", async () => {
        const { queue, durable, order } = createFoldQueue({
          keyPrefix: "it_negative_partial",
          failFirstBatch: true,
          coalesce: 10,
        });
        await queue.waitUntilReady();

        const base = Date.now();
        for (let index = 0; index < 3; index++) {
          await queue.send({
            eventId: `p-${index}`,
            groupId: AGGREGATE,
            occurredAt: base + index,
          });
        }
        await vi.waitFor(() => expect(durable.committed()?.count).toBe(3), {
          timeout: 20_000,
          interval: 50,
        });

        const uniqueApplied = new Set(order);
        expect(uniqueApplied.size).toBe(3);
        expect(order.length).toBe(3);
      }, 40_000);
    });
  });

  // ==========================================================================
  // Ordering. The queue guarantees per-group FIFO by score, and the executor
  // sorts a coalesced batch before folding. Dedup must not disturb either.
  // ==========================================================================

  describe("FIFO ordering", () => {
    describe("given events sent in order to one group", () => {
      it("applies them in occurredAt order", async () => {
        const { queue, durable, order } = createFoldQueue({
          keyPrefix: "it_fifo_plain",
          coalesce: 10,
        });
        await queue.waitUntilReady();

        const base = Date.now();
        for (let index = 0; index < 5; index++) {
          await queue.send({
            eventId: `o-${index}`,
            groupId: AGGREGATE,
            occurredAt: base + index * 10,
          });
        }

        await vi.waitFor(() => expect(durable.committed()?.count).toBe(5), {
          timeout: 25_000,
          interval: 50,
        });
        expect(order).toEqual(["o-0", "o-1", "o-2", "o-3", "o-4"]);
      }, 45_000);
    });

    describe("given a batch that fails and is re-formed with new arrivals", () => {
      it("still applies every event in occurredAt order overall", async () => {
        const { queue, durable, order, applied } = createFoldQueue({
          keyPrefix: "it_fifo_retry",
          failFirstBatch: true,
          coalesce: 10,
        });
        await queue.waitUntilReady();

        const base = Date.now();
        for (let index = 0; index < 3; index++) {
          await queue.send({
            eventId: `r-${index}`,
            groupId: AGGREGATE,
            occurredAt: base + index,
          });
        }
        await vi.waitFor(() => expect(applied.length).toBeGreaterThanOrEqual(1), {
          timeout: 20_000,
          interval: 50,
        });
        for (let index = 3; index < 5; index++) {
          await queue.send({
            eventId: `r-${index}`,
            groupId: AGGREGATE,
            occurredAt: base + index,
          });
        }

        await vi.waitFor(() => expect(durable.committed()?.count).toBe(5), {
          timeout: 25_000,
          interval: 50,
        });
        // Deduplication removes repeats; it must not reorder what survives.
        expect(order).toEqual(["r-0", "r-1", "r-2", "r-3", "r-4"]);
      }, 45_000);
    });
  });

  // ==========================================================================
  // Tenant guarantees beyond the shared-id case already covered above.
  // ==========================================================================

  describe("tenant guarantees", () => {
    describe("given one tenant is stuck in a retry chain", () => {
      it("does not delay or corrupt another tenant's fold of the same aggregate id", async () => {
        const other = createTenantId("tenant-redelivery-third");
        const stuck = createFoldQueue({
          keyPrefix: "it_tenant_isolation",
          failures: 2,
          coalesce: 10,
        });
        const healthy = createFoldQueue({
          keyPrefix: "it_tenant_isolation",
          tenantId: other,
        });
        await stuck.queue.waitUntilReady();
        await healthy.queue.waitUntilReady();

        const base = Date.now();
        for (let index = 0; index < 3; index++) {
          await stuck.queue.send({
            eventId: `shared-${index}`,
            groupId: AGGREGATE,
            occurredAt: base + index,
          });
          await healthy.queue.send({
            eventId: `shared-${index}`,
            groupId: AGGREGATE,
            occurredAt: base + index,
          });
        }

        await vi.waitFor(
          () => {
            expect(healthy.durable.committed()?.count).toBe(3);
            expect(stuck.durable.committed()?.count).toBe(3);
          },
          { timeout: 30_000, interval: 100 },
        );
        // Identical ids across tenants must not cross-suppress.
        expect(new Set(healthy.order).size).toBe(3);
        expect(new Set(stuck.order).size).toBe(3);
      }, 60_000);
    });
  });

});
