import {
  defineGroupQueue,
  GroupQueueConsumer,
  GroupQueueProducer,
} from "@langwatch/group-queue";
import type { Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { latencyAllTimeKey, latencyMinuteBucketKey } from "~/shared/ops/latency";
import {
  getTestRedisConnection,
  startTestContainers,
  stopTestContainers,
} from "../../../../event-sourcing/__tests__/integration/testContainers";
import { OpsMetricsCollector } from "../../metrics-collector";
import {
  NullQueueRepository,
  type QueueRepository,
} from "../../repositories/queue.repository";
import { SnapshotRedisRepository } from "../../snapshot/snapshot.repository";

const hasTestcontainers = !!(
  process.env.TEST_CLICKHOUSE_URL ||
  process.env.CI_CLICKHOUSE_URL ||
  process.env.REDIS_URL ||
  process.env.CI_REDIS_URL
);

type TestPayload = { id: string; groupId: string };
type TestQueue = {
  send(payload: TestPayload): Promise<void>;
  waitUntilReady(): Promise<void>;
  close(): Promise<void>;
};

/** @scenario P50 and P99 reflect recent job durations after completion */
describe.skipIf(!hasTestcontainers)("Ops dashboard latency tiles", () => {
  let redis: Redis;
  const queues: TestQueue[] = [];
  const queueNames: string[] = [];

  beforeAll(async () => {
    await startTestContainers();
    redis = getTestRedisConnection()!;
  });

  afterEach(async () => {
    await Promise.all(queues.map((q) => q.close().catch(() => {})));
    queues.length = 0;
    // Scoped cleanup: only delete keys this suite created. FLUSHALL would
    // wipe state owned by other integration tests sharing the same Redis.
    // Global collector keys (ops:known-pipelines, ops:metrics:state) are
    // intentionally left alone — they are best-effort caches; the only stale
    // state that survives is `peakLatencyP*`, and our assertion is
    // `peak >= current`, which a stale-larger peak still satisfies.
    for (const name of queueNames) {
      let cursor = "0";
      do {
        const [next, batch] = await redis.scan(cursor, "MATCH", `${name}*`, "COUNT", 200);
        if (batch.length > 0) await redis.unlink(...batch);
        cursor = next;
      } while (cursor !== "0");
    }
    queueNames.length = 0;
  });

  afterAll(async () => {
    await stopTestContainers();
  });

  function createQueue(process: (payload: TestPayload) => Promise<void>): {
    queue: TestQueue;
    name: string;
  } {
    const name = `{test/gq/lat/${crypto.randomUUID().slice(0, 8)}}`;
    const definition = defineGroupQueue({
      name,
      payload: {
        parse(value): TestPayload {
          const payload = value as Partial<TestPayload>;
          if (typeof payload.id !== "string" || typeof payload.groupId !== "string") {
            throw new Error("Invalid latency-test payload");
          }
          return payload as TestPayload;
        },
      },
      groupBy: (payload) => payload.groupId,
      identify: (payload) => payload.id,
    });
    const dependencies = { redis };
    const producer = new GroupQueueProducer(definition, dependencies);
    const consumer = new GroupQueueConsumer(definition, dependencies).handle(process);
    const queue: TestQueue = {
      send: (payload) => producer.send(payload),
      waitUntilReady: async () => {
        await Promise.all([producer.waitUntilReady(), consumer.waitUntilReady()]);
      },
      close: async () => {
        await producer.close();
        await consumer.close();
      },
    };
    queues.push(queue);
    queueNames.push(name);
    return { queue, name };
  }

  async function waitForLatencyCount(name: string, target: number, timeoutMs: number) {
    const key = `${name}:gq:stats:latencies-ms`;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const len = await redis.llen(key);
      if (len >= target) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    const finalLen = await redis.llen(key);
    throw new Error(`only ${finalLen} entries in ${key} after ${timeoutMs}ms`);
  }

  describe("given a group-queue worker has completed several jobs", () => {
    describe("when the dashboard reads the latency buffer", () => {
      it("populates :gq:stats:latencies-ms with one entry per completed job", async () => {
        const { queue, name } = createQueue(async () => {
          await new Promise((r) => setTimeout(r, 20));
        });
        await queue.waitUntilReady();

        await queue.send({ id: "a", groupId: "g1" });
        await queue.send({ id: "b", groupId: "g2" });
        await queue.send({ id: "c", groupId: "g3" });

        await waitForLatencyCount(name, 3, 5000);

        const raw = await redis.lrange(`${name}:gq:stats:latencies-ms`, 0, -1);
        const durations = raw.map((s) => Number(s));
        expect(durations).toHaveLength(3);
        for (const ms of durations) {
          expect(Number.isFinite(ms)).toBe(true);
          expect(ms).toBeGreaterThanOrEqual(0);
        }
        expect(Math.max(...durations)).toBeGreaterThanOrEqual(10);
      });

      it("caps the buffer at 200 entries via LTRIM", async () => {
        const { queue, name } = createQueue(async () => {
          // No work — keep the test fast. The cap check only needs the buffer
          // to grow past the limit, not real latency.
        });
        await queue.waitUntilReady();

        for (let i = 0; i < 250; i++) {
          await queue.send({ id: `j${i}`, groupId: `g${i % 5}` });
        }

        await waitForLatencyCount(name, 200, 15000);

        // Give the worker a beat to push past the cap, then re-check.
        await new Promise((r) => setTimeout(r, 200));
        const len = await redis.llen(`${name}:gq:stats:latencies-ms`);
        expect(len).toBeLessThanOrEqual(200);
        expect(len).toBeGreaterThanOrEqual(190);
      });

      it("surfaces non-zero P50/P99 through OpsMetricsCollector.getDashboardData()", async () => {
        const { queue, name } = createQueue(async () => {
          await new Promise((r) => setTimeout(r, 15));
        });
        await queue.waitUntilReady();

        for (let i = 0; i < 5; i++) {
          await queue.send({ id: `j${i}`, groupId: `g${i}` });
        }

        await waitForLatencyCount(name, 5, 5000);

        // Drive the real collector — stub queueRepo so it sees exactly this
        // suite's queue. Any future drift in key names, filtering, or
        // percentile math inside OpsMetricsCollector will break this test.
        const queueRepoStub: QueueRepository = Object.assign(new NullQueueRepository(), {
          discoverQueueNames: async () => [name],
        });
        const collector = new OpsMetricsCollector({
          redis,
          queueRepo: queueRepoStub,
        });
        try {
          await collector.discoverQueues();
          // Two cycles: the first establishes the baseline (hasBaseline=false
          // skips throughput math but still reads latencies), the second
          // exercises the steady-state path.
          await collector.collect();
          await collector.collect();

          const data = collector.getDashboardData();
          expect(data.latencyP50Ms).toBeGreaterThan(0);
          expect(data.latencyP99Ms).toBeGreaterThanOrEqual(data.latencyP50Ms);
          expect(data.peakLatencyP50Ms).toBeGreaterThanOrEqual(data.latencyP50Ms);
          expect(data.peakLatencyP99Ms).toBeGreaterThanOrEqual(data.latencyP99Ms);
        } finally {
          collector.stop();
        }
      });
    });
  });

  describe("given completions recorded into the time-bucketed histograms", () => {
    describe("when the writer's detail cycle runs", () => {
      /** @scenario "Windowed percentiles ride the detail artifact" */
      it("publishes hour, day, week, and all-time percentiles a reader can serve", async () => {
        const { queue, name } = createQueue(async () => {
          await new Promise((r) => setTimeout(r, 15));
        });
        await queue.waitUntilReady();

        for (let i = 0; i < 5; i++) {
          await queue.send({ id: `w${i}`, groupId: `g${i}` });
        }
        await waitForLatencyCount(name, 5, 5000);

        // The completions must have landed in all three histogram tiers.
        const allTime = await redis.hgetall(latencyAllTimeKey(name));
        expect(Object.keys(allTime).length).toBeGreaterThan(0);
        const minute = await redis.hgetall(latencyMinuteBucketKey(name, Date.now()));
        expect(Object.keys(minute).length).toBeGreaterThan(0);

        const queueRepoStub: QueueRepository = Object.assign(new NullQueueRepository(), {
          discoverQueueNames: async () => [name],
        });
        const snapshotRepo = new SnapshotRedisRepository(redis);
        const collector = new OpsMetricsCollector({
          redis,
          queueRepo: queueRepoStub,
          snapshotRepo,
        });
        try {
          await collector.discoverQueues();
          // First collect acquires the lease and kicks the (unawaited) detail
          // cycle; poll until the artifact lands.
          await collector.collect();
          const start = Date.now();
          while (!collector.getLatestDetail() && Date.now() - start < 5000) {
            await new Promise((r) => setTimeout(r, 50));
          }

          const windows = collector.getLatestDetail()?.latencyWindows;
          expect(windows?.hour?.count).toBeGreaterThanOrEqual(5);
          expect(windows?.hour?.p50Ms).toBeGreaterThan(0);
          expect(windows?.day?.count).toBe(windows?.hour?.count);
          expect(windows?.week?.count).toBe(windows?.hour?.count);
          expect(windows?.allTime?.p99Ms).toBeGreaterThanOrEqual(
            windows?.allTime?.p50Ms ?? 0,
          );

          // The reader path: the persisted artifact round-trips through the
          // wire schema with the windows intact — what any pod would serve.
          const served = await snapshotRepo.readDetail();
          expect(served?.latencyWindows?.hour?.p50Ms).toBe(windows?.hour?.p50Ms);
        } finally {
          collector.stop();
        }
      });
    });
  });
});
