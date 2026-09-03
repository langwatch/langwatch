/**
 * The writer's detail cycle publishes windowed (hour/day/week/all-time)
 * percentiles alongside the strip's last-200-jobs tiles — real time windows
 * need time-bucketed data, not a sample.
 *
 * Spec: packages/features/ops/specs/dashboard-latency-windows.feature
 */
import IORedis, { type Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { latencyAllTimeKey, latencyMinuteBucketKey } from "@langwatch/ops-contract";
import { GroupQueueProcessor } from "@langwatch/group-queue";
import { OpsMetricsCollector } from "../ops-metrics-collector.service";
import { OpsMetricsTestAdapter } from "./ops-metrics.fixture";
import { RedisOpsSnapshotRepository } from "../../repositories/redis/redis.ops-snapshot.repository";
import { DefaultOpsSnapshotService } from "../ops-snapshot-reader.service";
import type { OpsSnapshotRedisPort } from "../../ports/ops-snapshot-redis.port";

const redisUrl = process.env.REDIS_URL ?? process.env.CI_REDIS_URL;
const hasRedis = !!redisUrl;

type TestPayload = { id: string; groupId: string };

/** @scenario P50 and P99 reflect recent job durations after completion */
describe.skipIf(!hasRedis)("Ops dashboard latency tiles", () => {
  let redis: Redis;
  const queues: GroupQueueProcessor<TestPayload>[] = [];
  const queueNames: string[] = [];

  beforeAll(() => {
    redis = new IORedis(redisUrl!);
  });

  afterEach(async () => {
    await Promise.all(queues.map((q) => q.close().catch(() => {})));
    queues.length = 0;
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
    await redis?.quit();
  });

  function createQueue(
    overrides: Partial<ConstructorParameters<typeof GroupQueueProcessor<TestPayload>>[0]> & {
      process: (payload: TestPayload) => Promise<void>;
    },
  ): { queue: GroupQueueProcessor<TestPayload>; name: string } {
    const name = `{test/gq/lat/${crypto.randomUUID().slice(0, 8)}}`;
    const def: ConstructorParameters<typeof GroupQueueProcessor<TestPayload>>[0] = {
      name,
      groupKey: (p) => p.groupId,
      // The production factory (packages/eventing's groupQueueFactory)
      // supplies this default when it builds a processor from an
      // EventSourcedQueueDefinition; constructing the processor directly
      // here needs the same default explicitly.
      identify: () => crypto.randomUUID(),
      ...overrides,
    };
    const q = new GroupQueueProcessor<TestPayload>(def, redis);
    queues.push(q);
    queueNames.push(name);
    return { queue: q, name };
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

  describe("given completions recorded into the time-bucketed histograms", () => {
    describe("when the writer's detail cycle runs", () => {
      /** @scenario "Windowed percentiles ride the detail artifact" */
      it("publishes hour, day, week, and all-time percentiles a reader can serve", async () => {
        const { queue, name } = createQueue({
          process: async () => {
            await new Promise((r) => setTimeout(r, 15));
          },
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

        const ops = OpsMetricsTestAdapter.create();
        ops.setQueueNames([name]);
        const snapshotRepository = RedisOpsSnapshotRepository.create(
          redis as unknown as OpsSnapshotRedisPort,
        );
        const snapshots = DefaultOpsSnapshotService.create(snapshotRepository);
        const collector = new OpsMetricsCollector({ redis, ops, snapshots });
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
          expect(windows?.allTime?.p99Ms).toBeGreaterThanOrEqual(windows?.allTime?.p50Ms ?? 0);

          // The reader path: the persisted artifact round-trips through the
          // wire schema with the windows intact — what any pod would serve.
          const served = await snapshotRepository.tryReadDetail();
          expect(served?.latencyWindows?.hour?.p50Ms).toBe(windows?.hour?.p50Ms);
        } finally {
          collector.stop();
        }
      });
    });
  });
});
