import { describe, it, expect, beforeEach, vi } from "vitest";
import { register } from "prom-client";
import type IORedis from "ioredis";
import type { Cluster } from "ioredis";
import { GroupQueueMetricsCollector } from "../metricsCollector";
import { gqOldestPendingAgeMilliseconds } from "../metrics";
import type { GroupStagingScripts } from "../scripts";

const QUEUE = "test-queue";
const PREFIX = "gq:test:";

type ZRangeByScore = (...args: unknown[]) => Promise<string[]>;

/** Minimal Redis stub exposing only the reads collect() performs. */
function makeRedis(zrangebyscore: ZRangeByScore) {
  return {
    zcard: vi.fn(async () => 0),
    scard: vi.fn(async () => 0),
    smembers: vi.fn(async () => [] as string[]),
    zrangebyscore: vi.fn(zrangebyscore),
  } as unknown as (IORedis | Cluster) & {
    zrangebyscore: ReturnType<typeof vi.fn>;
  };
}

function runCollect(redis: IORedis | Cluster) {
  const collector = new GroupQueueMetricsCollector({
    scripts: { getKeyPrefix: () => PREFIX } as unknown as GroupStagingScripts,
    processingQueue: { length: () => 0 } as never,
    redisConnection: redis,
    queueName: QUEUE,
    activeJobCountFn: () => 0,
    metricsIntervalMs: 60_000,
    logger: {
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    } as never,
  });
  // collect() is private; drive one cycle directly.
  return (collector as unknown as { collect: () => Promise<void> }).collect();
}

async function readGauge(): Promise<number | undefined> {
  const m = await gqOldestPendingAgeMilliseconds.get();
  return m.values.find((v) => v.labels.queue_name === QUEUE)?.value;
}

describe("GroupQueueMetricsCollector — oldest pending age", () => {
  beforeEach(() => {
    register.resetMetrics();
  });

  it("reports the age of the oldest eligible-waiting group", async () => {
    // Stub returns a group whose ready score is (query max) - 5000, so the
    // computed age is exactly 5000ms regardless of wall-clock timing.
    const redis = makeRedis(async (...args) => {
      const max = Number(args[2]);
      return ["group-abc", String(max - 5000)];
    });

    await runCollect(redis);

    expect(await readGauge()).toBe(5000);

    // The query must exclude the unblock sentinel (score 1) via an exclusive
    // lower bound, cap at "now", and read only the single oldest member.
    const args = redis.zrangebyscore.mock.calls.at(-1)!;
    expect(args[0]).toBe(`${PREFIX}ready`);
    expect(args[1]).toBe("(1");
    expect(typeof args[2]).toBe("number");
    expect(Number(args[2])).toBeGreaterThan(Date.now() - 5_000);
    expect(args).toContain("WITHSCORES");
    expect(args.slice(-3)).toEqual(["LIMIT", 0, 1]);
  });

  it("reports 0 when no group is eligible (empty / all in-flight / just unblocked)", async () => {
    const redis = makeRedis(async () => []);
    await runCollect(redis);
    expect(await readGauge()).toBe(0);
  });

  it("never emits a negative age (clock skew / future score)", async () => {
    const redis = makeRedis(async (...args) => {
      const max = Number(args[2]);
      return ["group-future", String(max + 1000)];
    });
    await runCollect(redis);
    const age = await readGauge();
    expect(age).toBeGreaterThanOrEqual(0);
  });
});
