import type IORedis from "ioredis";
import type { Cluster } from "ioredis";
import { register } from "prom-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  gqOldestBacklogAgeMilliseconds,
  gqOldestPendingAgeMilliseconds,
} from "../metrics";
import { GroupQueueMetricsCollector } from "../metricsCollector";
import type { GroupStagingScripts } from "../scripts";

const QUEUE = "test-queue";
const PREFIX = "gq:test:";

type ReadyEntry = { member: string; score: number };

/**
 * Real zrangebyscore semantics over an in-memory ready zset: exclusive "(x"
 * lower bound, a numeric or "+inf" upper bound, LIMIT offset/count, ascending
 * by score, and WITHSCORES flattening. The collector issues two shapes of
 * this call per collect (the eligible probe and the deferred-backlog sample),
 * so one model backs both instead of a bespoke per-test stub.
 */
function zrangebyscoreModel({
  entries,
  min,
  max,
  rest,
}: {
  entries: ReadyEntry[];
  min: string | number;
  max: string | number;
  rest: unknown[];
}): string[] {
  const minStr = String(min);
  const exclusive = minStr.startsWith("(");
  const minVal = Number(exclusive ? minStr.slice(1) : minStr);
  const maxVal = max === "+inf" ? Infinity : Number(max);

  const withScores = rest.includes("WITHSCORES");
  const limitIdx = rest.indexOf("LIMIT");
  const offset = limitIdx >= 0 ? Number(rest[limitIdx + 1]) : 0;
  const count = limitIdx >= 0 ? Number(rest[limitIdx + 2]) : Infinity;

  return [...entries]
    .filter(
      (e) =>
        (exclusive ? e.score > minVal : e.score >= minVal) && e.score <= maxVal,
    )
    .sort((a, b) => a.score - b.score)
    .slice(offset, offset + count)
    .flatMap((e) => (withScores ? [e.member, String(e.score)] : [e.member]));
}

/**
 * Minimal Redis stub exposing only the reads collect() performs. `readyZset`
 * backs both zrangebyscore calls (the eligible probe and the deferred-backlog
 * sample) through the real model above; `headJobScores` maps a group's jobs
 * key to the [member, score] pair its pipelined zrange returns.
 */
function makeRedis(
  opts: {
    readyZset?: ReadyEntry[];
    headJobScores?: Record<string, string[]>;
  } = {},
) {
  return {
    zcard: vi.fn(async () => 0),
    scard: vi.fn(async () => 0),
    smembers: vi.fn(async () => [] as string[]),
    zrangebyscore: vi.fn(async (...args: unknown[]) =>
      zrangebyscoreModel({
        entries: opts.readyZset ?? [],
        min: args[1] as string | number,
        max: args[2] as string | number,
        rest: args.slice(3),
      }),
    ),
    pipeline: vi.fn(() => {
      const cmds: string[] = [];
      const chain = {
        zrange: (key: string) => {
          cmds.push(key);
          return chain;
        },
        exec: async () =>
          cmds.map((key) => [null, opts.headJobScores?.[key] ?? []]),
      };
      return chain;
    }),
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
    // Seeded relative to Date.now() at test setup; the collector reads
    // Date.now() again at call time, so assert with a tolerance window
    // rather than an exact millisecond match.
    const redis = makeRedis({
      readyZset: [{ member: "group-abc", score: Date.now() - 5_000 }],
    });

    await runCollect(redis);

    const age = await readGauge();
    expect(age).toBeGreaterThanOrEqual(5_000);
    expect(age).toBeLessThan(15_000);

    // The query must exclude the unblock sentinel (score 1) via an exclusive
    // lower bound, cap at "now", and read only the single oldest member.
    // This is the FIRST zrangebyscore call (the eligible probe); the second
    // is the deferred-backlog sample.
    const args = redis.zrangebyscore.mock.calls[0]!;
    expect(args[0]).toBe(`${PREFIX}ready`);
    expect(args[1]).toBe("(1");
    expect(typeof args[2]).toBe("number");
    expect(Number(args[2])).toBeGreaterThan(Date.now() - 5_000);
    expect(args).toContain("WITHSCORES");
    expect(args.slice(-3)).toEqual(["LIMIT", 0, 1]);
  });

  it("reports 0 when no group is eligible (empty / all in-flight / just unblocked)", async () => {
    // A just-unblocked group carries the sentinel score (1), which the
    // exclusive "(1" lower bound must drop rather than surface as eligible.
    const redis = makeRedis({
      readyZset: [{ member: "just-unblocked", score: 1 }],
    });
    await runCollect(redis);
    expect(await readGauge()).toBe(0);
  });

  it("never emits a negative age (clock skew / future score)", async () => {
    const redis = makeRedis({
      readyZset: [{ member: "group-future", score: Date.now() + 1_000 }],
    });
    await runCollect(redis);
    const age = await readGauge();
    expect(age).toBeGreaterThanOrEqual(0);
  });
});

async function readBacklogGauge(): Promise<number | undefined> {
  const m = await gqOldestBacklogAgeMilliseconds.get();
  return m.values.find((v) => v.labels.queue_name === QUEUE)?.value;
}

describe("GroupQueueMetricsCollector — oldest backlog age", () => {
  beforeEach(() => {
    register.resetMetrics();
  });

  describe("when a group is pinned in retry backoff (deferred ready score, day-old head job)", () => {
    it("reports the head job's age even though the eligible gauge reads 0", async () => {
      // Nothing eligible: the group's ready score was rewritten to now+backoff
      // by the last failed attempt (a real backoff, not the full incident
      // delay), so the eligible scan sees an empty queue.
      const headDueMs = Date.now() - 60_000;
      const redis = makeRedis({
        readyZset: [
          { member: "tenant/sub/trace:abc", score: Date.now() + 5_000 },
        ],
        headJobScores: {
          [`${PREFIX}group:tenant/sub/trace:abc:jobs`]: [
            "job-1",
            String(headDueMs),
          ],
        },
      });

      await runCollect(redis);

      expect(await readGauge()).toBe(0);
      const backlogAge = await readBacklogGauge();
      expect(backlogAge).toBeGreaterThanOrEqual(60_000);
      expect(backlogAge).toBeLessThan(70_000);
    });
  });

  describe("when a deferred group's head job is scheduled in the future", () => {
    it("does not count it as backlog", async () => {
      const redis = makeRedis({
        readyZset: [
          { member: "tenant/sub/trace:delayed", score: Date.now() + 5_000 },
        ],
        headJobScores: {
          [`${PREFIX}group:tenant/sub/trace:delayed:jobs`]: [
            "job-1",
            String(Date.now() + 3_600_000),
          ],
        },
      });

      await runCollect(redis);

      expect(await readBacklogGauge()).toBe(0);
    });
  });

  describe("when only an eligible group is waiting", () => {
    it("folds the eligible head into the backlog age", async () => {
      const redis = makeRedis({
        readyZset: [{ member: "group-abc", score: Date.now() - 5_000 }],
      });

      await runCollect(redis);

      const backlogAge = await readBacklogGauge();
      expect(backlogAge).toBeGreaterThanOrEqual(5_000);
      expect(backlogAge).toBeLessThan(15_000);
    });
  });

  describe("when 50 long-delayed groups outnumber a single day-old retry-backoff group", () => {
    it("still surfaces the retry-backoff group's age (regression: nearest-first sampling)", async () => {
      // Regression for the 2026-08-05 incident this gauge exists to catch:
      // fifty monitor-timer groups scored hours out must NOT displace a
      // retry-backoff group (scored only seconds out) from the sample. Under
      // the old zrevrange(0, 49) sampling — largest scores first — the 50
      // far-future groups would fill the sample and this test fails; the
      // nearest-first zrangebyscore sampling ranks the backoff group first.
      const now = Date.now();
      const readyZset: ReadyEntry[] = [];
      const headJobScores: Record<string, string[]> = {};

      for (let i = 0; i < 50; i++) {
        const groupId = `tenant/sub/trace:long-delayed-${i}`;
        readyZset.push({ member: groupId, score: now + 3_600_000 });
        headJobScores[`${PREFIX}group:${groupId}:jobs`] = [
          "job-future",
          String(now + 3_600_000),
        ];
      }

      const backoffGroupId = "tenant/sub/trace:day-old-backoff";
      readyZset.push({ member: backoffGroupId, score: now + 5_000 });
      headJobScores[`${PREFIX}group:${backoffGroupId}:jobs`] = [
        "job-1",
        String(now - 86_400_000),
      ];

      const redis = makeRedis({ readyZset, headJobScores });

      await runCollect(redis);

      const backlogAge = await readBacklogGauge();
      expect(backlogAge).toBeGreaterThanOrEqual(86_400_000);
      expect(backlogAge).toBeLessThan(86_400_000 + 60_000);
    });
  });
});
