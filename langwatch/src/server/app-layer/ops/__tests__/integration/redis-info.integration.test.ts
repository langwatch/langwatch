import type { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startTestContainers,
  stopTestContainers,
} from "../../../../event-sourcing/__tests__/integration/testContainers";
import { computeEngineCpuPercent } from "../../redis-engine-cpu";

// Reproduces the body of OpsMetricsCollector.getRedisInfo() against the same
// IORedis client used in production, so the parsing stays honest against a
// real INFO response. Kept inline here so this test doesn't need to import a
// private method or instantiate the whole collector (which spins up timers).
async function readRedisInfo(redis: Redis): Promise<{
  usedMemoryHuman: string;
  usedMemoryBytes: number;
  maxMemoryBytes: number;
  connectedClients: number;
  usedCpuUserMainThreadSeconds: number;
  usedCpuSysMainThreadSeconds: number;
}> {
  const info = await redis.info();
  const get = (key: string): string => {
    const match = info.match(new RegExp(`${key}:(.+)`));
    return match?.[1]?.trim() ?? "?";
  };
  return {
    usedMemoryHuman: get("used_memory_human"),
    usedMemoryBytes: parseInt(get("used_memory"), 10) || 0,
    maxMemoryBytes: parseInt(get("maxmemory"), 10) || 0,
    connectedClients: parseInt(get("connected_clients"), 10) || 0,
    usedCpuUserMainThreadSeconds:
      parseFloat(get("used_cpu_user_main_thread")) || 0,
    usedCpuSysMainThreadSeconds:
      parseFloat(get("used_cpu_sys_main_thread")) || 0,
  };
}

let redis: Redis;

beforeAll(async () => {
  ({ redisConnection: redis } = await startTestContainers());
});

afterAll(async () => {
  await stopTestContainers();
});

describe("Ops metrics — Redis INFO sampling", () => {
  describe("given a real Redis instance is reachable", () => {
    describe("when INFO is queried once", () => {
      it("returns parseable memory fields", async () => {
        const info = await readRedisInfo(redis);
        expect(info.usedMemoryBytes).toBeGreaterThan(0);
        expect(info.usedMemoryHuman).not.toBe("?");
        expect(info.connectedClients).toBeGreaterThan(0);
      });

      it("returns the main-thread cumulative CPU counters", async () => {
        const info = await readRedisInfo(redis);
        // Redis exposes these as floating-point seconds since process start.
        // They are always >= 0 and they grow monotonically while Redis runs.
        expect(info.usedCpuUserMainThreadSeconds).toBeGreaterThanOrEqual(0);
        expect(info.usedCpuSysMainThreadSeconds).toBeGreaterThanOrEqual(0);
      });
    });

    describe("when INFO is queried twice with Redis activity in between", () => {
      it("derives a non-negative engine-CPU percent", async () => {
        const first = await readRedisInfo(redis);
        const sample1 = {
          userSec: first.usedCpuUserMainThreadSeconds,
          sysSec: first.usedCpuSysMainThreadSeconds,
          sampledAt: Date.now(),
        };

        // Generate real Redis work — a Lua eval that does a few thousand
        // operations. Larger than a single SET so we measurably move the
        // main-thread CPU counter even on fast CI hardware.
        await redis.eval(
          "for i=1,5000 do redis.call('SET', 'integration:cpu:'..i, i) end return 1",
          0,
        );
        await redis.eval(
          "for i=1,5000 do redis.call('GET', 'integration:cpu:'..i) end return 1",
          0,
        );
        // Cleanup
        const keys = await redis.keys("integration:cpu:*");
        if (keys.length) await redis.del(...keys);

        // Wait a tick to make sure sampledAt differs even on the fastest CPU.
        await new Promise((resolve) => setTimeout(resolve, 50));

        const second = await readRedisInfo(redis);
        const percent = computeEngineCpuPercent({
          prev: sample1,
          nextUserSec: second.usedCpuUserMainThreadSeconds,
          nextSysSec: second.usedCpuSysMainThreadSeconds,
          nextSampledAt: Date.now(),
        });

        // First sample produced a number, not null. The Redis main thread
        // can't have used more than 100% of one core (single-threaded), so
        // anything in [0, 100] is plausible. We allow a small overshoot for
        // host clock skew under heavy load.
        expect(percent).not.toBeNull();
        expect(percent!).toBeGreaterThanOrEqual(0);
        expect(percent!).toBeLessThanOrEqual(105);
      });
    });
  });
});
