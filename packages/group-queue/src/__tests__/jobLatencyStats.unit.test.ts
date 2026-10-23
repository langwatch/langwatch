import { memoryRedisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { afterEach, describe, expect, it, vi } from "vitest";

import { JobLatencyStats, LATENCY_STATS_FLUSH_INTERVAL_MS } from "../jobLatencyStats.ts";

const QUEUE = "{test/gq/latency}";
const NOW_MS = 1_700_000_000_000;
const SAMPLES_KEY = `${QUEUE}:gq:stats:latencies-ms`;
const MINUTE_KEY = `${QUEUE}:gq:stats:lat-hist:m:${Math.floor(NOW_MS / 60_000)}`;
const HOUR_KEY = `${QUEUE}:gq:stats:lat-hist:h:${Math.floor(NOW_MS / 3_600_000)}`;
const ALL_KEY = `${QUEUE}:gq:stats:lat-hist:all`;

/** A Redis whose list and hash-increment commands land in plain maps, with each call logged. */
function recordingRedis({ failing = false }: { failing?: boolean } = {}) {
  const lists = new Map<string, string[]>();
  const hashes = new Map<string, Map<string, number>>();
  const calls: { command: string; args: unknown[] }[] = [];
  const redis = memoryRedisDouble({
    script: {
      lpush: async (...args: unknown[]) => {
        const [key, ...values] = args.map(String);
        calls.push({ command: "lpush", args });
        if (failing) throw new Error("redis down");
        const list = lists.get(key) ?? [];
        for (const value of values) list.unshift(value);
        lists.set(key, list);
        return list.length;
      },
      ltrim: async (...args: unknown[]) => {
        const [key = "", start, stop] = args.map(String);
        calls.push({ command: "ltrim", args });
        lists.set(key, (lists.get(key) ?? []).slice(Number(start), Number(stop) + 1));
        return "OK";
      },
      hincrby: async (...args: unknown[]) => {
        const [key = "", field = "", increment] = args.map(String);
        calls.push({ command: "hincrby", args });
        const hash = hashes.get(key) ?? new Map<string, number>();
        hash.set(field, (hash.get(field) ?? 0) + Number(increment));
        hashes.set(key, hash);
        return hash.get(field);
      },
      expire: async (...args: unknown[]) => {
        calls.push({ command: "expire", args });
        return 1;
      },
    },
  });
  return { redis, lists, hashes, calls };
}

function statsOver(redis: ReturnType<typeof recordingRedis>["redis"]): JobLatencyStats {
  return new JobLatencyStats({ redis, queueName: QUEUE, now: () => NOW_MS });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("JobLatencyStats", () => {
  describe("given three jobs finished inside one interval", () => {
    describe("when the stats flush", () => {
      it("pushes every sample in one write, the newest at the head", async () => {
        const { redis, lists, calls } = recordingRedis();
        const stats = statsOver(redis);

        stats.record(3);
        stats.record(40);
        stats.record(5.4);
        await stats.flush();

        expect(calls.filter((call) => call.command === "lpush")).toHaveLength(1);
        expect(lists.get(SAMPLES_KEY)).toEqual(["5", "40", "3"]);
      });

      it("adds each histogram field once, by the number of jobs it counted", async () => {
        const { redis, hashes, calls } = recordingRedis();
        const stats = statsOver(redis);

        stats.record(3.5);
        stats.record(4);
        stats.record(40);
        await stats.flush();

        for (const key of [MINUTE_KEY, HOUR_KEY, ALL_KEY]) {
          expect(Object.fromEntries(hashes.get(key) ?? [])).toEqual({ "4": 2, "48": 1 });
        }
        expect(calls.filter((call) => call.command === "hincrby")).toHaveLength(6);
      });

      it("keeps the minute and hour buckets expiring and the all-time bucket forever", async () => {
        const { redis, calls } = recordingRedis();
        const stats = statsOver(redis);

        stats.record(3);
        await stats.flush();

        const expired = calls.filter((call) => call.command === "expire").map((call) => call.args);
        expect(expired).toEqual([
          [MINUTE_KEY, 2 * 60 * 60],
          [HOUR_KEY, 8 * 24 * 60 * 60],
        ]);
      });
    });
  });

  describe("given more jobs than the sample list holds", () => {
    it("writes only the newest 200 samples", async () => {
      const { redis, lists } = recordingRedis();
      const stats = statsOver(redis);

      for (let ms = 1; ms <= 250; ms++) stats.record(ms);
      await stats.flush();

      const samples = lists.get(SAMPLES_KEY) ?? [];
      expect(samples).toHaveLength(200);
      expect(samples[0]).toBe("250");
      expect(samples.at(-1)).toBe("51");
    });
  });

  describe("given nothing was recorded", () => {
    it("writes nothing", async () => {
      const { redis, calls } = recordingRedis();

      await statsOver(redis).flush();

      expect(calls).toEqual([]);
    });
  });

  describe("given a job finished and nobody flushed", () => {
    it("writes it once the interval has passed", async () => {
      vi.useFakeTimers();
      const { redis, lists } = recordingRedis();
      const stats = statsOver(redis);

      stats.record(7);
      await vi.advanceTimersByTimeAsync(LATENCY_STATS_FLUSH_INTERVAL_MS - 1);
      expect(lists.get(SAMPLES_KEY)).toBeUndefined();

      await vi.advanceTimersByTimeAsync(1);
      expect(lists.get(SAMPLES_KEY)).toEqual(["7"]);
    });
  });

  describe("given Redis refuses the write", () => {
    it("resolves, and the next interval starts empty", async () => {
      const { redis, calls } = recordingRedis({ failing: true });
      const stats = statsOver(redis);

      stats.record(7);
      await expect(stats.flush()).resolves.toBeUndefined();
      calls.length = 0;
      await stats.flush();

      expect(calls).toEqual([]);
    });
  });
});
