/**
 * Durability-gated fold cache — end-to-end proof of the ADR-046 claims.
 *
 * These run against real Redis because every claim here rests on Redis
 * semantics that a mock would simply assert back at us: that a re-registration
 * MOVES a sorted-set score rather than adding a member (which is what keeps an
 * actively-folding aggregate from ever being released), that a backstop TTL
 * really expires, and that a released key is really gone on the next read.
 *
 * Each test names the ADR-046 claim it proves. The headline is
 * "a redelivered event is not applied twice": that is the live defect the whole
 * design exists to close — four of seven fold projections accumulate
 * (`spanCount + 1`, token and cost sums, id appends), so an ordinary queue
 * retry against a warm cache double-counts.
 *
 * Spec: specs/event-sourcing/redis-fold-cache.feature
 */
import type { Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTenantId } from "../../../domain/tenantId";
import type { Event } from "../../../domain/types";
import {
  getTestRedisConnection,
  startTestContainers,
  stopTestContainers,
} from "../../../__tests__/integration/testContainers";
import {
  createMockFoldProjectionDefinition,
  createTestEvent,
} from "../../../services/__tests__/testHelpers";
import { FoldProjectionExecutor } from "../../foldProjectionExecutor";
import type { FoldProjectionStore } from "../../foldProjection.types";
import type { ProjectionStoreContext } from "../../projectionStoreContext";
import { RedisCachedFoldStore } from "../../redisCachedFoldStore";
import {
  type AggregateLivenessCheck,
  FoldCacheConfirmationProcessor,
} from "../confirmationProcessor";
import type { FoldDurabilityProbe } from "../durabilityProbe";
import { GroupQueueLivenessCheck } from "../groupQueueLivenessCheck";

interface CounterState {
  count: number;
  UpdatedAt: number;
}

const TENANT = createTenantId("tenant-integration");
const AGGREGATE = "trace-1";

/**
 * Stands in for a fire-and-forget ClickHouse write: `store()` returns before
 * the row is visible, and `visible` only advances when we say so. That lag is
 * the whole reason the cache is load-bearing, so the test has to reproduce it
 * rather than assume writes land instantly.
 */
function createDurableStore() {
  let committed: CounterState | null = null;
  let visible: CounterState | null = null;
  const reads: string[] = [];

  const store: FoldProjectionStore<CounterState> = {
    async store(state) {
      committed = state;
    },
    async get(aggregateId) {
      reads.push(aggregateId);
      return visible;
    },
  };

  return {
    store,
    reads,
    /** Make everything written so far readable, as replication catching up. */
    flush() {
      visible = committed;
    },
    committed: () => committed,
  };
}

/** A probe answering from whatever the durable store has actually made visible. */
function probeFrom(durable: ReturnType<typeof createDurableStore>): FoldDurabilityProbe {
  return {
    async confirmedUpdatedAt({ aggregateIds }) {
      const result = new Map<string, number>();
      const state = durable.committed();
      if (!state) return result;
      for (const id of aggregateIds) result.set(id, state.UpdatedAt);
      return result;
    },
  };
}

function neverConfirms(): FoldDurabilityProbe {
  return { async confirmedUpdatedAt() { return new Map(); } };
}

describe("durability-gated fold cache", () => {
  let redis: Redis;
  let keyPrefix: string;
  let counter = 0;

  const executor = new FoldProjectionExecutor();

  beforeAll(async () => {
    await startTestContainers();
    redis = getTestRedisConnection();
  }, 120_000);

  afterAll(async () => {
    await stopTestContainers();
  });

  beforeEach(() => {
    // Isolate every test's key space so a leaked entry cannot pass a later test.
    keyPrefix = `it_fold_${Date.now()}_${counter++}`;
  });

  function createStore(
    durable: ReturnType<typeof createDurableStore>,
    options: { backstopTtlSeconds?: number; checkDelayMs?: number } = {},
  ) {
    return new RedisCachedFoldStore<CounterState>(durable.store, redis, {
      keyPrefix,
      backstopTtlSeconds: options.backstopTtlSeconds ?? 3_600,
      checkDelayMs: options.checkDelayMs ?? 0,
    });
  }

  function createProcessor(
    probe: FoldDurabilityProbe,
    liveness?: AggregateLivenessCheck,
  ) {
    return new FoldCacheConfirmationProcessor({
      redis,
      targets: [{ keyPrefix, probe }],
      liveness,
      retryDelayMs: 60_000,
    });
  }

  function counterFold(store: FoldProjectionStore<CounterState>) {
    return createMockFoldProjectionDefinition("counter", {
      store,
      init: () => ({ count: 0, UpdatedAt: 0 }),
      apply: (state: CounterState, event: Event) => ({
        count: state.count + 1,
        UpdatedAt: Math.max(Date.now(), state.UpdatedAt + 1),
        LastEventOccurredAt: event.occurredAt,
      }),
    });
  }

  const context: ProjectionStoreContext = {
    aggregateId: AGGREGATE,
    tenantId: TENANT,
  };

  const cacheKey = () => `fold:${keyPrefix}:${String(TENANT)}:${AGGREGATE}`;
  const pendingKey = () => `fold:pending:${keyPrefix}`;

  describe("a redelivered event is not applied twice", () => {
    it("counts each event once when the queue redelivers a batch that already committed", async () => {
      const durable = createDurableStore();
      const fold = counterFold(createStore(durable));

      const events = [
        createTestEvent(AGGREGATE, "trace", TENANT),
        createTestEvent(AGGREGATE, "trace", TENANT),
      ];

      const first = await executor.executeBatch(fold, events, context);
      expect(first.count).toBe(2);

      // The job failed after its state was stored, so the queue re-dispatches
      // the same events. Without the applied-set this reaches 4.
      const retried = await executor.executeBatch(fold, events, context);

      expect(retried.count).toBe(2);
    });

    it("applies only the events that are genuinely new when a retry batch is re-formed", async () => {
      const durable = createDurableStore();
      const fold = counterFold(createStore(durable));

      const original = [
        createTestEvent(AGGREGATE, "trace", TENANT),
        createTestEvent(AGGREGATE, "trace", TENANT),
      ];
      await executor.executeBatch(fold, original, context);

      // A retry re-forms the batch with a sibling that arrived meanwhile —
      // the queue restages siblings at their original scores, so batch
      // composition is not stable across attempts.
      const fresh = createTestEvent(AGGREGATE, "trace", TENANT);
      const result = await executor.executeBatch(
        fold,
        [...original, fresh],
        context,
      );

      expect(result.count).toBe(3);
    });
  });

  describe("a cached entry is served without reading the durable store", () => {
    it("does not read through while the entry is present", async () => {
      const durable = createDurableStore();
      const store = createStore(durable);

      await store.store({ count: 7, UpdatedAt: 100 }, context);
      const readsBefore = durable.reads.length;

      const result = await store.get(AGGREGATE, context);

      expect(result).toEqual({ count: 7, UpdatedAt: 100 });
      expect(durable.reads.length).toBe(readsBefore);
    });
  });

  describe("a cached entry is released once the durable store holds it", () => {
    it("deletes the entry, clears the pending registration, and reads through afterwards", async () => {
      const durable = createDurableStore();
      const store = createStore(durable);

      await store.store({ count: 7, UpdatedAt: 100 }, context);
      durable.flush();

      const summary = await createProcessor(probeFrom(durable)).runOnce();

      expect(summary.confirmed).toBe(1);
      expect(await redis.exists(cacheKey())).toBe(0);
      expect(await redis.zcard(pendingKey())).toBe(0);

      // The claim that makes the design work: a miss now means the durable
      // store is authoritative, so reading through is correct.
      const readsBefore = durable.reads.length;
      const afterRelease = await store.get(AGGREGATE, context);
      expect(durable.reads.length).toBe(readsBefore + 1);
      expect(afterRelease).toEqual({ count: 7, UpdatedAt: 100 });
    });
  });

  describe("a cached entry is retained while the durable store has not caught up", () => {
    it("keeps the entry and schedules another check", async () => {
      const durable = createDurableStore();
      const store = createStore(durable);

      await store.store({ count: 7, UpdatedAt: 100 }, context);
      // Deliberately no flush: the write is committed but not yet visible,
      // which is the ordinary state inside the async-insert flush window.

      const summary = await createProcessor(neverConfirms()).runOnce();

      expect(summary.confirmed).toBe(0);
      expect(await redis.exists(cacheKey())).toBe(1);
      expect(await redis.zcard(pendingKey())).toBe(1);
    });

    it("retains the entry when the probe itself fails", async () => {
      const durable = createDurableStore();
      const store = createStore(durable);
      await store.store({ count: 7, UpdatedAt: 100 }, context);
      durable.flush();

      const failing: FoldDurabilityProbe = {
        async confirmedUpdatedAt() {
          throw new Error("clickhouse unreachable");
        },
      };
      const summary = await createProcessor(failing).runOnce();

      expect(summary.errors).toBe(1);
      expect(await redis.exists(cacheKey())).toBe(1);
    });
  });

  describe("an aggregate still being folded is never released", () => {
    it("pushes its own check further out on every write", async () => {
      const durable = createDurableStore();
      const store = createStore(durable, { checkDelayMs: 30_000 });

      await store.store({ count: 1, UpdatedAt: 100 }, context);
      const firstDue = await redis.zscore(
        pendingKey(),
        `${String(TENANT)}\u0000${AGGREGATE}`,
      );

      await new Promise((resolve) => setTimeout(resolve, 20));
      await store.store({ count: 2, UpdatedAt: 101 }, context);

      const secondDue = await redis.zscore(
        pendingKey(),
        `${String(TENANT)}\u0000${AGGREGATE}`,
      );

      // One member, moved — not two. This is what keeps a 40k-span trace from
      // being considered for release while its spans are still arriving.
      expect(await redis.zcard(pendingKey())).toBe(1);
      expect(Number(secondDue)).toBeGreaterThan(Number(firstDue));

      durable.flush();
      const summary = await createProcessor(probeFrom(durable)).runOnce();
      expect(summary.confirmed).toBe(0);
      expect(await redis.exists(cacheKey())).toBe(1);
    });
  });

  describe("an aggregate with queue work in flight is not released", () => {
    it("retains the entry even though the durable store holds the state", async () => {
      const durable = createDurableStore();
      const store = createStore(durable);
      await store.store({ count: 7, UpdatedAt: 100 }, context);
      durable.flush();

      const busy: AggregateLivenessCheck = {
        async withWorkInFlight({ aggregateIds }) {
          return new Set(aggregateIds);
        },
      };
      const summary = await createProcessor(probeFrom(durable), busy).runOnce();

      expect(summary.inFlight).toBe(1);
      expect(summary.confirmed).toBe(0);
      expect(await redis.exists(cacheKey())).toBe(1);
    });

    it("sees a real staged job through the queue's own key layout", async () => {
      const queueName = `it_queue_${keyPrefix}`;
      const liveness = new GroupQueueLivenessCheck({
        redis,
        queueName,
        projectionName: "counter",
        aggregateType: "trace",
      });

      const quiet = await liveness.withWorkInFlight({
        tenantId: String(TENANT),
        aggregateIds: [AGGREGATE],
      });
      expect(quiet.size).toBe(0);

      const groupId = `${String(TENANT)}/fold/counter/trace:${AGGREGATE}`;
      await redis.hset(`${queueName}:gq:group:${groupId}:data`, "job-1", "{}");

      const busy = await liveness.withWorkInFlight({
        tenantId: String(TENANT),
        aggregateIds: [AGGREGATE],
      });
      expect(busy.has(AGGREGATE)).toBe(true);

      await redis.del(`${queueName}:gq:group:${groupId}:data`);
    });
  });

  describe("the confirmation processor falling behind never loses state", () => {
    it("retains every entry when no confirmation pass runs at all", async () => {
      const durable = createDurableStore();
      const store = createStore(durable);

      for (let index = 0; index < 5; index++) {
        await store.store(
          { count: index, UpdatedAt: 100 + index },
          { ...context, aggregateId: `trace-${index}` },
        );
      }

      const keys = await redis.keys(`fold:${keyPrefix}:*`);
      expect(keys).toHaveLength(5);
      expect(await redis.zcard(pendingKey())).toBe(5);
    });
  });

  describe("a cached entry cannot outlive its backstop", () => {
    it("expires, and the expiry is reported as a backstop rather than a confirmation", async () => {
      const durable = createDurableStore();
      const store = createStore(durable, { backstopTtlSeconds: 1 });

      await store.store({ count: 7, UpdatedAt: 100 }, context);
      expect(await redis.exists(cacheKey())).toBe(1);

      await new Promise((resolve) => setTimeout(resolve, 1_500));
      expect(await redis.exists(cacheKey())).toBe(0);

      const summary = await createProcessor(neverConfirms()).runOnce();

      expect(summary.backstopExpired).toBe(1);
      expect(summary.confirmed).toBe(0);
      expect(await redis.zcard(pendingKey())).toBe(0);
    });
  });
});
