import type IORedis from "ioredis";
import type { Cluster } from "ioredis";
import { register } from "prom-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  gqGroupStagingDepthMax,
  gqGroupsOverStagingDepth,
  gqOldestBacklogAgeMilliseconds,
  gqOldestPendingAgeMilliseconds,
  STAGING_DEPTH_REPORT_THRESHOLD,
} from "../metrics";
import { GroupQueueMetricsCollector } from "../metricsCollector";
import { MIN_PLAUSIBLE_EPOCH_MS } from "../readyScore";
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
  const isExclusive = minStr.startsWith("(");
  const minVal =
    minStr === "-inf"
      ? -Infinity
      : Number(isExclusive ? minStr.slice(1) : minStr);
  const maxStr = String(max);
  const isMaxExclusive = maxStr.startsWith("(");
  const maxVal =
    maxStr === "+inf"
      ? Infinity
      : Number(isMaxExclusive ? maxStr.slice(1) : maxStr);

  const shouldIncludeScores = rest.includes("WITHSCORES");
  const limitIdx = rest.indexOf("LIMIT");
  const offset = limitIdx >= 0 ? Number(rest[limitIdx + 1]) : 0;
  const count = limitIdx >= 0 ? Number(rest[limitIdx + 2]) : Infinity;

  return [...entries]
    .filter(
      (e) =>
        (isExclusive ? e.score > minVal : e.score >= minVal) &&
        (isMaxExclusive ? e.score < maxVal : e.score <= maxVal),
    )
    .sort((a, b) => a.score - b.score)
    .slice(offset, offset + count)
    .flatMap((e) =>
      shouldIncludeScores ? [e.member, String(e.score)] : [e.member],
    );
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
    /** groupId -> HLEN of its `:data` hash. Absent means the key is gone (0). */
    stagingDepths?: Record<string, number>;
    /** groupIds whose pipelined HLEN comes back as an error reply. */
    stagingDepthErrors?: string[];
    /** Members per ZSCAN page, so a rotation can be driven deterministically. */
    zscanPageSize?: number;
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
    /**
     * Paged ZSCAN over the ready zset. Cursors are opaque in real Redis; an
     * index models the one guarantee the sweep relies on, that a member
     * present for a whole rotation is returned at least once, and lets a test
     * choose where the page boundary falls. The integration test alongside
     * this file runs the same sweep against real Redis so the model is not
     * the only evidence.
     */
    zscan: vi.fn(async (...args: unknown[]) => {
      const entries = opts.readyZset ?? [];
      const cursor = Number(args[1]);
      const countIdx = args.indexOf("COUNT");
      const pageSize =
        opts.zscanPageSize ?? (countIdx >= 0 ? Number(args[countIdx + 1]) : 10);
      const page = entries.slice(cursor, cursor + pageSize);
      const nextCursor =
        cursor + pageSize >= entries.length ? "0" : String(cursor + pageSize);
      return [nextCursor, page.flatMap((e) => [e.member, String(e.score)])];
    }),
    pipeline: vi.fn(() => {
      const cmds: Array<{ op: "zrange" | "hlen"; key: string }> = [];
      const chain = {
        zrange: (key: string) => {
          cmds.push({ op: "zrange", key });
          return chain;
        },
        hlen: (key: string) => {
          cmds.push({ op: "hlen", key });
          return chain;
        },
        exec: async () =>
          cmds.map(({ op, key }) => {
            if (op === "zrange") {
              return [null, opts.headJobScores?.[key] ?? []];
            }
            const groupId = key
              .slice(`${PREFIX}group:`.length)
              .replace(/:data$/, "");
            if (opts.stagingDepthErrors?.includes(groupId)) {
              return [new Error("READONLY"), undefined];
            }
            return [null, opts.stagingDepths?.[groupId] ?? 0];
          }),
      };
      return chain;
    }),
  } as unknown as (IORedis | Cluster) & {
    zrangebyscore: ReturnType<typeof vi.fn>;
    zscan: ReturnType<typeof vi.fn>;
  };
}

function makeCollector(redis: IORedis | Cluster) {
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
  // collect() is private; drive cycles directly.
  return collector as unknown as { collect: () => Promise<void> };
}

/** One cycle on a fresh collector, which is what most cases here want. */
function runCollect(redis: IORedis | Cluster) {
  return makeCollector(redis).collect();
}

async function readGauge(): Promise<number | undefined> {
  const m = await gqOldestPendingAgeMilliseconds.get();
  return m.values.find((v) => v.labels.queue_name === QUEUE)?.value;
}

describe("GroupQueueMetricsCollector — oldest pending age", () => {
  beforeEach(() => {
    register.resetMetrics();
    // Freeze the clock so scores seeded relative to "now" keep their
    // eligible/deferred classification no matter how slowly the test runs,
    // and ages assert exactly instead of through tolerance windows.
    vi.useFakeTimers({ now: Date.now() });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports the age of the oldest eligible-waiting group", async () => {
    const redis = makeRedis({
      readyZset: [{ member: "group-abc", score: Date.now() - 5_000 }],
    });

    await runCollect(redis);

    expect(await readGauge()).toBe(5_000);

    // The query must start at the plausible-epoch floor (which drops the
    // unblock sentinel and every mis-scored row alike), cap at "now", and read
    // only the single oldest member. This is the FIRST zrangebyscore call (the
    // eligible probe); the second is the deferred-backlog sample.
    const args = redis.zrangebyscore.mock.calls[0]!;
    expect(args[0]).toBe(`${PREFIX}ready`);
    expect(args[1]).toBe(MIN_PLAUSIBLE_EPOCH_MS);
    expect(args[2]).toBe(Date.now());
    expect(args).toContain("WITHSCORES");
    expect(args.slice(-3)).toEqual(["LIMIT", 0, 1]);
  });

  /**
   * A just-unblocked group carries the sentinel score (1), which the
   * plausible-epoch floor drops rather than surface as eligible.
   */
  /** @scenario "the unblock sentinel is not read as an age" */
  it("reports 0 when no group is eligible (empty / all in-flight / just unblocked)", async () => {
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

describe("GroupQueueMetricsCollector - scores that are not timestamps", () => {
  beforeEach(() => {
    register.resetMetrics();
    vi.useFakeTimers({ now: Date.now() });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("given a group staged a few seconds after the Unix epoch", () => {
    /**
     * Regression for the 2026-07-31 / 2026-08-03 spurious alert fires: a score
     * of ~2 to 57,000 made the gauge read `now - ~0`, i.e. about 56 years, and
     * the Events Backed Up rule divides that by 1000 and fires. The floor makes
     * the gauge structurally unable to report it.
     */
    /** @scenario "the oldest-pending-age gauge skips a score from just after the Unix epoch" */
    it("does not report its age, and probes from the plausible-epoch floor", async () => {
      const redis = makeRedis({
        readyZset: [{ member: "mis-scored", score: 57_000 }],
      });

      await runCollect(redis);

      expect(await readGauge()).toBe(0);
      expect(await readBacklogGauge()).toBe(0);
      expect(redis.zrangebyscore.mock.calls[0]![1]).toBe(
        MIN_PLAUSIBLE_EPOCH_MS,
      );
    });

    it("leaves a healthy neighbour driving the gauge", async () => {
      const redis = makeRedis({
        readyZset: [
          { member: "mis-scored", score: 57_000 },
          { member: "also-mis-scored", score: 0 },
          { member: "just-unblocked", score: 1 },
          { member: "healthy", score: Date.now() - 5_000 },
        ],
      });

      await runCollect(redis);

      expect(await readGauge()).toBe(5_000);
    });
  });

  describe("given a sampled group whose head job score is not a timestamp", () => {
    /**
     * A genuine backlog IS arbitrarily far in the past, so the gauge applies
     * only the absolute bound, never the staging-time skew bounds - otherwise
     * it would hide the very backlog it exists to report.
     */
    /** @scenario "the backlog gauge drops a head job score that is not a timestamp" */
    it("drops the head from the backlog age", async () => {
      const redis = makeRedis({
        readyZset: [
          { member: "tenant/sub/trace:abc", score: Date.now() + 5_000 },
        ],
        headJobScores: {
          [`${PREFIX}group:tenant/sub/trace:abc:jobs`]: ["job-1", "0"],
        },
      });

      await runCollect(redis);

      expect(await readBacklogGauge()).toBe(0);
    });

    it("still reports a genuinely old head job, however far past it is", async () => {
      const veryOld = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const redis = makeRedis({
        readyZset: [{ member: "tenant/sub/trace:old", score: Date.now() + 1 }],
        headJobScores: {
          [`${PREFIX}group:tenant/sub/trace:old:jobs`]: [
            "job-1",
            String(veryOld),
          ],
        },
      });

      await runCollect(redis);

      expect(await readBacklogGauge()).toBe(30 * 24 * 60 * 60 * 1000);
    });
  });
});

async function readBacklogGauge(): Promise<number | undefined> {
  const m = await gqOldestBacklogAgeMilliseconds.get();
  return m.values.find((v) => v.labels.queue_name === QUEUE)?.value;
}

describe("GroupQueueMetricsCollector — oldest backlog age", () => {
  beforeEach(() => {
    register.resetMetrics();
    // Frozen clock: a score of now+5s must stay DEFERRED through the whole
    // test, however slowly CI runs it — otherwise the group turns eligible,
    // the deferred sample skips its head job, and the assertion flakes.
    vi.useFakeTimers({ now: Date.now() });
  });

  afterEach(() => {
    vi.useRealTimers();
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
      expect(await readBacklogGauge()).toBe(60_000);
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

      expect(await readBacklogGauge()).toBe(5_000);
    });
  });

  describe("given 50 long-delayed groups and a single day-old retry-backoff group", () => {
    describe("when metrics are collected", () => {
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

        expect(await readBacklogGauge()).toBe(86_400_000);
      });
    });
  });
});

/**
 * The aggregate gauges above are blind to one group holding an enormous
 * staging hash: the group count is unremarkable and the head job's age says
 * nothing about how many jobs sit behind it. These cover the sweep that closes
 * that gap, and in particular that it is a rotation and not a sample, because
 * a sample of the head of ready is exactly where the outlier is not.
 */
describe("GroupQueueMetricsCollector, per-group staging depth", () => {
  beforeEach(() => {
    register.resetMetrics();
    vi.useFakeTimers({ now: Date.now() });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const readMax = async () =>
    (await gqGroupStagingDepthMax.get()).values.find(
      (v) => v.labels.queue_name === QUEUE,
    )?.value;

  const readOverThreshold = async () =>
    (await gqGroupsOverStagingDepth.get()).values.find(
      (v) => v.labels.queue_name === QUEUE,
    )?.value;

  const ready = (...members: string[]): ReadyEntry[] =>
    members.map((member, i) => ({ member, score: Date.now() + i }));

  describe("given groups of differing depth", () => {
    describe("when a cycle reads them", () => {
      it("reports the deepest group, not the total or the average", async () => {
        const redis = makeRedis({
          readyZset: ready("shallow", "deep", "middling"),
          stagingDepths: { shallow: 5, deep: 900, middling: 12 },
        });

        await runCollect(redis);

        expect(await readMax()).toBe(900);
      });

      it("counts how many are over the reporting threshold", async () => {
        const redis = makeRedis({
          readyZset: ready("a", "b", "c"),
          stagingDepths: {
            a: STAGING_DEPTH_REPORT_THRESHOLD,
            b: STAGING_DEPTH_REPORT_THRESHOLD - 1,
            c: STAGING_DEPTH_REPORT_THRESHOLD * 3,
          },
        });

        await runCollect(redis);

        // One hot key and a stalled drainer both raise the max; only this
        // separates them.
        expect(await readOverThreshold()).toBe(2);
      });
    });
  });

  describe("given the deep group is past the first page", () => {
    describe("when the rotation continues across cycles", () => {
      it("reports it, which a fixed sample of the head never would", async () => {
        const redis = makeRedis({
          readyZset: ready("g1", "g2", "g3", "deep"),
          stagingDepths: { g1: 1, g2: 2, g3: 3, deep: 250_000 },
          zscanPageSize: 2,
        });
        const collector = makeCollector(redis);

        await collector.collect();
        expect(await readMax()).toBe(2);

        await collector.collect();
        expect(await readMax()).toBe(250_000);
      });
    });
  });

  describe("given a group that was deep and has drained", () => {
    describe("when the next rotation reads it", () => {
      it("stops reporting the old depth instead of pinning the high-water mark", async () => {
        const depths: Record<string, number> = { quiet: 3, deep: 250_000 };
        const redis = makeRedis({
          readyZset: ready("quiet", "deep"),
          stagingDepths: depths,
        });
        const collector = makeCollector(redis);

        // One cycle covers both groups, so this cycle completes a rotation.
        await collector.collect();
        expect(await readMax()).toBe(250_000);

        depths.deep = 0;
        await collector.collect();

        expect(await readMax()).toBe(3);
      });
    });
  });

  describe("given a group that disappeared mid-sweep", () => {
    describe("when its depth read fails or finds nothing", () => {
      it("reports no depth for it, because neither reply is evidence of one", async () => {
        const redis = makeRedis({
          readyZset: ready("gone", "errored", "real"),
          // "gone" drained between the scan and the read: HLEN on a missing
          // key is 0, which the stub returns for any group with no entry.
          stagingDepths: { real: 7 },
          stagingDepthErrors: ["errored"],
        });

        await runCollect(redis);

        expect(await readMax()).toBe(7);
        expect(await readOverThreshold()).toBe(0);
      });
    });
  });

  describe("given an empty ready set", () => {
    describe("when a cycle runs", () => {
      it("reports zero rather than leaving the last value standing", async () => {
        const redis = makeRedis({ readyZset: [] });

        await runCollect(redis);

        expect(await readMax()).toBe(0);
        expect(await readOverThreshold()).toBe(0);
      });
    });
  });
});
