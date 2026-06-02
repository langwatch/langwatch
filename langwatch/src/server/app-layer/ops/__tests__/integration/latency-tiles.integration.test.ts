import type { Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  startTestContainers,
  stopTestContainers,
  getTestRedisConnection,
} from "../../../../event-sourcing/__tests__/integration/testContainers";
import { GroupQueueProcessor } from "../../../../event-sourcing/queues/groupQueue/groupQueue";
import type { EventSourcedQueueDefinition } from "../../../../event-sourcing/queues/queue.types";

const hasTestcontainers = !!(
  process.env.TEST_CLICKHOUSE_URL ||
  process.env.CI_CLICKHOUSE_URL ||
  process.env.REDIS_URL ||
  process.env.CI_REDIS_URL
);

type TestPayload = { id: string; groupId: string };

/** @scenario P50 and P99 reflect recent job durations after completion */
describe.skipIf(!hasTestcontainers)("Ops dashboard latency tiles", () => {
  let redis: Redis;
  const queues: GroupQueueProcessor<TestPayload>[] = [];

  beforeAll(async () => {
    await startTestContainers();
    redis = getTestRedisConnection()!;
  });

  afterEach(async () => {
    await Promise.all(queues.map((q) => q.close().catch(() => {})));
    queues.length = 0;
    await redis.flushall();
  });

  afterAll(async () => {
    await stopTestContainers();
  });

  function createQueue(
    overrides: Partial<EventSourcedQueueDefinition<TestPayload>> & {
      process: (payload: TestPayload) => Promise<void>;
    },
  ): { queue: GroupQueueProcessor<TestPayload>; name: string } {
    const name = `{test/gq/lat/${crypto.randomUUID().slice(0, 8)}}`;
    const def: EventSourcedQueueDefinition<TestPayload> = {
      name,
      groupKey: (p) => p.groupId,
      ...overrides,
    };
    const q = new GroupQueueProcessor<TestPayload>(def, redis);
    queues.push(q);
    return { queue: q, name };
  }

  describe("given a group-queue worker has completed several jobs", () => {
    describe("when the dashboard reads the latency buffer", () => {
      it("populates :gq:stats:latencies-ms with one entry per completed job", async () => {
        const { queue, name } = createQueue({
          process: async () => {
            await new Promise((r) => setTimeout(r, 20));
          },
        });
        await queue.waitUntilReady();

        await queue.send({ id: "a", groupId: "g1" });
        await queue.send({ id: "b", groupId: "g2" });
        await queue.send({ id: "c", groupId: "g3" });

        const latencyKey = `${name}:gq:stats:latencies-ms`;
        await new Promise<void>((resolve, reject) => {
          const start = Date.now();
          const tick = async () => {
            const len = await redis.llen(latencyKey);
            if (len >= 3) return resolve();
            if (Date.now() - start > 5000)
              return reject(new Error(`only ${len} entries after 5s`));
            setTimeout(tick, 50);
          };
          void tick();
        });

        const raw = await redis.lrange(latencyKey, 0, -1);
        const durations = raw.map((s) => Number(s));
        expect(durations).toHaveLength(3);
        for (const ms of durations) {
          expect(Number.isFinite(ms)).toBe(true);
          expect(ms).toBeGreaterThanOrEqual(0);
        }
        // At least one job spent ~20ms in the handler.
        expect(Math.max(...durations)).toBeGreaterThanOrEqual(10);
      });

      it("caps the buffer at 200 entries via LTRIM", async () => {
        const { queue, name } = createQueue({
          process: async () => {
            // No work — keep the test fast. The cap check only needs the buffer
            // to grow past the limit, not real latency.
          },
        });
        await queue.waitUntilReady();

        for (let i = 0; i < 250; i++) {
          await queue.send({ id: `j${i}`, groupId: `g${i % 5}` });
        }

        const latencyKey = `${name}:gq:stats:latencies-ms`;
        await new Promise<void>((resolve, reject) => {
          const start = Date.now();
          const tick = async () => {
            const len = await redis.llen(latencyKey);
            if (len >= 200) return resolve();
            if (Date.now() - start > 15000)
              return reject(new Error(`only ${len} entries after 15s`));
            setTimeout(tick, 100);
          };
          void tick();
        });

        // Give the worker a beat to push past the cap, then re-check.
        await new Promise((r) => setTimeout(r, 200));
        const len = await redis.llen(latencyKey);
        expect(len).toBeLessThanOrEqual(200);
        expect(len).toBeGreaterThanOrEqual(190);
      });

      it("derives non-zero P50/P99 via the collector's LRANGE read path", async () => {
        const { queue, name } = createQueue({
          process: async () => {
            await new Promise((r) => setTimeout(r, 15));
          },
        });
        await queue.waitUntilReady();

        for (let i = 0; i < 5; i++) {
          await queue.send({ id: `j${i}`, groupId: `g${i}` });
        }

        const latencyKey = `${name}:gq:stats:latencies-ms`;
        await new Promise<void>((resolve, reject) => {
          const start = Date.now();
          const tick = async () => {
            const len = await redis.llen(latencyKey);
            if (len >= 5) return resolve();
            if (Date.now() - start > 5000)
              return reject(new Error(`only ${len} entries after 5s`));
            setTimeout(tick, 50);
          };
          void tick();
        });

        // Reproduce the body of OpsMetricsCollector.computeJobMetrics() that
        // reads latencies, so this test stays honest against the same shape
        // the dashboard renders.
        const queueNames = [name];
        const pipeline = redis.pipeline();
        for (const name of queueNames) {
          pipeline.lrange(`${name}:gq:stats:latencies-ms`, 0, -1);
        }
        const results = await pipeline.exec();
        const latencies: number[] = [];
        for (const [, result] of results ?? []) {
          if (!Array.isArray(result)) continue;
          for (const raw of result) {
            const ms = Number(raw);
            if (Number.isFinite(ms) && ms >= 0) latencies.push(ms);
          }
        }

        expect(latencies.length).toBeGreaterThanOrEqual(5);
        latencies.sort((a, b) => a - b);
        const p50 = latencies[Math.floor(latencies.length * 0.5)]!;
        const p99 =
          latencies[
            Math.min(latencies.length - 1, Math.floor(latencies.length * 0.99))
          ]!;
        expect(p50).toBeGreaterThan(0);
        expect(p99).toBeGreaterThanOrEqual(p50);
      });
    });
  });
});
