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

function toEvent(job: FoldJob): Event {
  return {
    id: job.eventId,
    aggregateId: AGGREGATE,
    aggregateType: "trace",
    tenantId: TENANT,
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
    const foldKeys = await redis.keys("fold:it_redeliver*");
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
    coalesce,
  }: {
    keyPrefix: string;
    failFirstBatch?: boolean;
    failAlways?: boolean;
    coalesce?: number;
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
      apply: (state: CounterState) => ({
        count: state.count + 1,
        UpdatedAt: Math.max(Date.now(), state.UpdatedAt + 1),
      }),
    });

    const context: ProjectionStoreContext = {
      aggregateId: AGGREGATE,
      tenantId: TENANT,
    };

    const applied: string[][] = [];
    let failuresLeft = failAlways
      ? Number.POSITIVE_INFINITY
      : failFirstBatch
        ? 1
        : 0;

    const runBatch = async (jobs: FoldJob[]) => {
      applied.push(jobs.map((job) => job.eventId));
      await executor.executeBatch(fold, jobs.map(toEvent), context);
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
      process: async (job) => runBatch([job]),
      ...(coalesce
        ? {
            processBatch: async (jobs) => runBatch(jobs),
            coalesceMaxBatch: () => coalesce,
          }
        : {}),
    } as EventSourcedQueueDefinition<FoldJob>;

    const queue = new GroupQueueProcessor<FoldJob>(definition, redis, {
      consumerEnabled: true,
    });
    queues.push(queue);

    return { queue, name, durable, applied };
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
    describe("when a sibling is dispatched on the next attempt", () => {
      it("preserves the retry budget rather than restarting it", async () => {
        const { queue, name } = createFoldQueue({
          keyPrefix: "it_redeliver_attempt",
          // Keep failing, so the group stays populated long enough to inspect.
          // With a single failure the retry succeeds and drains the group
          // before the assertion can look at it.
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

        // Once the batch has failed, every re-staged job must carry the attempt
        // count. A sibling without `__attempt` reads as attempt 1 when it leads
        // the next batch, so a persistently failing group can re-apply its
        // events far more than the 25-attempt budget allows.
        // Wait for the whole group to be back in staging — the retry plus its
        // re-staged siblings. Asserting on "whatever happens to be staged"
        // would pass spuriously: vi.waitFor retries until a favourable moment,
        // and a moment where only the retry job is present trivially satisfies
        // an "all payloads carry __attempt" check.
        const staged = await vi.waitFor(
          async () => {
            const hash = await redis.hgetall(
              `${name}:gq:group:${AGGREGATE}:data`,
            );
            const payloads = Object.values(hash);
            expect(payloads.length).toBe(3);
            return payloads;
          },
          { timeout: 15_000, interval: 50 },
        );

        const withoutAttempt = staged.filter(
          (raw) => !raw.includes("__attempt"),
        );
        expect(withoutAttempt).toEqual([]);
      }, 30_000);
    });
  });
});
