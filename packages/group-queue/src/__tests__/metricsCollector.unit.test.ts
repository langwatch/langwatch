import { createRecordingMeterProvider } from "@langwatch/observability/metrics/testing";
import { createTestLogger, type TestLogLines } from "@langwatch/test-harness";
import { redisDouble } from "@langwatch/test-harness/client-doubles/redis";
import type IORedis from "ioredis";
import type { Cluster } from "ioredis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { STAGING_DEPTH_REPORT_FLOOR } from "../metrics.ts";
import { GroupQueueMetricsCollector } from "../metricsCollector.ts";
import { MIN_PLAUSIBLE_EPOCH_MS } from "../readyScore.ts";
import { GroupStagingScripts } from "../scripts.ts";

const QUEUE = "test-queue";
const PREFIX = `${QUEUE}:gq:`;

type ReadyEntry = { member: string; score: number };

/**
 * Real zrangebyscore semantics over an in-memory ready zset (exclusive
 * bounds, LIMIT offset/count, WITHSCORES). Backs both shapes the collector
 * issues per collect (eligible probe, deferred-backlog sample) with one model.
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
  const minVal = minStr === "-inf" ? -Infinity : Number(isExclusive ? minStr.slice(1) : minStr);
  const maxStr = String(max);
  const isMaxExclusive = maxStr.startsWith("(");
  const maxVal = maxStr === "+inf" ? Infinity : Number(isMaxExclusive ? maxStr.slice(1) : maxStr);

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
    .toSorted((a, b) => a.score - b.score)
    .slice(offset, offset + count)
    .flatMap((e) => (shouldIncludeScores ? [e.member, String(e.score)] : [e.member]));
}

/**
 * Minimal Redis stub exposing only the reads collect() performs. `readyZset`
 * backs both zrangebyscore calls through the model above; `headJobScores`
 * maps a group's jobs key to the [member, score] pair its zrange returns.
 */
function makeRedis(
  opts: {
    readyZset?: ReadyEntry[];
    headJobScores?: Record<string, string[]>;
    /** groupId -> HLEN of its `:data` hash. Absent means the key is gone (0). */
    stagingDepths?: Record<string, number>;
    /** groupIds whose pipelined HLEN comes back as an error reply. */
    stagingDepthErrors?: string[];
    /**
     * The pending-groups index. Defaults to the ready members; set it to
     * cover groups the ready set does not contain.
     */
    pendingGroups?: string[];
    /** Members per scan page, so a rotation can be driven deterministically. */
    scanPageSize?: number;
    /**
     * Held by the FIRST `zcard` only, which is the first read `collect` makes.
     * Later calls resolve at once, so a test can hold one cycle open and see
     * whether a second gets past the in-flight guard.
     */
    gateFirstCall?: Promise<void>;
    /** Members of the blocked set. */
    blocked?: string[];
    /** SCARD of the blocked set when it exceeds the members a scan returns. */
    blockedTotal?: number;
    /** groupId -> the [pipeline, jobType, jobName] its head job's header carries. */
    routing?: Record<string, [string, string, string]>;
    /** tenantId -> parked group count; the keys are the parked-tenants registry. */
    parked?: Record<string, number>;
  } = {},
) {
  let gateUsed = false;
  const zrangebyscore = vi.fn(async (...args: unknown[]) =>
    zrangebyscoreModel({
      entries: opts.readyZset ?? [],
      min: args[1] as string | number,
      max: args[2] as string | number,
      rest: args.slice(3),
    }),
  );
  const sscan = vi.fn(async (...args: unknown[]) => {
    const readyMembers = (opts.readyZset ?? []).map((e) => e.member);
    // Answering per key is what makes "swept the wrong index" visible: a
    // group that is parked, blocked or claimed is in pending-groups and in
    // no ready set at all.
    const key = String(args[0]);
    let members = readyMembers;
    if (key.endsWith("pending-groups")) members = opts.pendingGroups ?? readyMembers;
    else if (key.endsWith("blocked")) members = opts.blocked ?? [];
    const cursor = Number(args[1]);
    const countIdx = args.indexOf("COUNT");
    const pageSize = opts.scanPageSize ?? (countIdx >= 0 ? Number(args[countIdx + 1]) : 10);
    const page = members.slice(cursor, cursor + pageSize);
    const nextCursor = cursor + pageSize >= members.length ? "0" : String(cursor + pageSize);
    return [nextCursor, page];
  });
  const evalsha = vi.fn(
    async (_sha: string, _numKeys: number, _key: string, _prefix: string, ...ids: string[]) =>
      ids.flatMap((id) => opts.routing?.[id] ?? ["", "", ""]),
  );
  const redis = redisDouble({
    zcard: vi.fn(async (key: string) => {
      if (opts.gateFirstCall && !gateUsed) {
        gateUsed = true;
        await opts.gateFirstCall;
      }
      const parkedTenant = key.startsWith(`${PREFIX}parked:`)
        ? key.slice(`${PREFIX}parked:`.length)
        : undefined;
      return parkedTenant === undefined ? 0 : (opts.parked?.[parkedTenant] ?? 0);
    }),
    scard: vi.fn(async (key: string) =>
      key.endsWith("blocked") ? (opts.blockedTotal ?? opts.blocked?.length ?? 0) : 0,
    ),
    smembers: vi.fn(async () => Object.keys(opts.parked ?? {})),
    evalsha,
    zrangebyscore,
    sscan,
    pipeline: vi.fn(() => {
      const cmds: { op: "zrange" | "hlen"; key: string }[] = [];
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
            const groupId = key.slice(`${PREFIX}group:`.length).replace(/:data$/, "");
            if (opts.stagingDepthErrors?.includes(groupId)) {
              return [new Error("READONLY"), undefined];
            }
            return [null, opts.stagingDepths?.[groupId] ?? 0];
          }),
      };
      return chain;
    }),
  });
  return { redis, zrangebyscore, sscan, evalsha };
}

/** A logger stub whose calls a test can read. */
function makeLogger() {
  return {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  };
}

const METRICS_INTERVAL_MS = 60_000;
const realSetImmediate = setImmediate;
/** Every cycle's reads are microtasks, so one real macrotask turn lets a fired cycle finish. */
const settle = () => new Promise<void>((resolve) => realSetImmediate(resolve));
const running: GroupQueueMetricsCollector[] = [];

afterEach(() => {
  for (const collector of running.splice(0)) collector.stop();
});

/** Drives cycles through the public timer: the first fire is `start`, then interval ticks. */
function makeCollector({
  redis,
  logger = makeLogger(),
}: {
  redis: IORedis | Cluster;
  logger?: ReturnType<typeof makeLogger>;
}) {
  const collector = new GroupQueueMetricsCollector({
    scripts: new GroupStagingScripts(redis, QUEUE),
    processingQueue: { length: () => 0 } as never,
    redisConnection: redis,
    queueName: QUEUE,
    activeJobCountFn: () => 0,
    metricsIntervalMs: METRICS_INTERVAL_MS,
    logger: logger as never,
  });
  let started = false;
  const fire = () => {
    if (started) {
      vi.advanceTimersByTime(METRICS_INTERVAL_MS);
      return;
    }
    started = true;
    running.push(collector);
    collector.start();
  };
  return {
    fire,
    collect: async () => {
      fire();
      await settle();
    },
  };
}

/** One cycle on a fresh collector, which is what most cases here want. */
function runCollect(redis: IORedis | Cluster) {
  return makeCollector({ redis }).collect();
}

let meter = createRecordingMeterProvider();

/** The latest value a gauge wrote for the test queue. */
function lastGauge(name: string): number | undefined {
  return meter.valuesOf(name, { queue_name: QUEUE }).at(-1);
}

function readGauge(): number | undefined {
  return lastGauge("gq_oldest_pending_age_milliseconds");
}

describe("GroupQueueMetricsCollector — oldest pending age", () => {
  beforeEach(() => {
    meter = createRecordingMeterProvider();
    meter.install();
    // Freeze the clock so scores seeded relative to "now" keep their
    // eligible/deferred classification no matter how slowly the test runs,
    // and ages assert exactly instead of through tolerance windows.
    vi.useFakeTimers({ now: Date.now() });
  });

  afterEach(() => {
    vi.useRealTimers();
    meter.uninstall();
  });

  it("reports the age of the oldest eligible-waiting group", async () => {
    const { redis, zrangebyscore } = makeRedis({
      readyZset: [{ member: "group-abc", score: Date.now() - 5_000 }],
    });

    await runCollect(redis);

    expect(readGauge()).toBe(5_000);

    // The query must start at the plausible-epoch floor (which drops the
    // unblock sentinel and every mis-scored row alike), cap at "now", and read
    // only the single oldest member. This is the FIRST zrangebyscore call (the
    // eligible probe); the second is the deferred-backlog sample.
    const args = zrangebyscore.mock.calls[0]!;
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
    const { redis } = makeRedis({
      readyZset: [{ member: "just-unblocked", score: 1 }],
    });
    await runCollect(redis);
    expect(readGauge()).toBe(0);
  });

  it("never emits a negative age (clock skew / future score)", async () => {
    const { redis } = makeRedis({
      readyZset: [{ member: "group-future", score: Date.now() + 1_000 }],
    });
    await runCollect(redis);
    const age = readGauge();
    expect(age).toBeGreaterThanOrEqual(0);
  });
});

describe("GroupQueueMetricsCollector - scores that are not timestamps", () => {
  beforeEach(() => {
    meter = createRecordingMeterProvider();
    meter.install();
    vi.useFakeTimers({ now: Date.now() });
  });

  afterEach(() => {
    vi.useRealTimers();
    meter.uninstall();
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
      const { redis, zrangebyscore } = makeRedis({
        readyZset: [{ member: "mis-scored", score: 57_000 }],
      });

      await runCollect(redis);

      expect(readGauge()).toBe(0);
      expect(readBacklogGauge()).toBe(0);
      expect(zrangebyscore.mock.calls[0]![1]).toBe(MIN_PLAUSIBLE_EPOCH_MS);
    });

    it("leaves a healthy neighbour driving the gauge", async () => {
      const { redis } = makeRedis({
        readyZset: [
          { member: "mis-scored", score: 57_000 },
          { member: "also-mis-scored", score: 0 },
          { member: "just-unblocked", score: 1 },
          { member: "healthy", score: Date.now() - 5_000 },
        ],
      });

      await runCollect(redis);

      expect(readGauge()).toBe(5_000);
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
      const { redis } = makeRedis({
        readyZset: [{ member: "tenant/sub/trace:abc", score: Date.now() + 5_000 }],
        headJobScores: {
          [`${PREFIX}group:tenant/sub/trace:abc:jobs`]: ["job-1", "0"],
        },
      });

      await runCollect(redis);

      expect(readBacklogGauge()).toBe(0);
    });

    it("still reports a genuinely old head job, however far past it is", async () => {
      const veryOld = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const { redis } = makeRedis({
        readyZset: [{ member: "tenant/sub/trace:old", score: Date.now() + 1 }],
        headJobScores: {
          [`${PREFIX}group:tenant/sub/trace:old:jobs`]: ["job-1", String(veryOld)],
        },
      });

      await runCollect(redis);

      expect(readBacklogGauge()).toBe(30 * 24 * 60 * 60 * 1000);
    });
  });
});

function readBacklogGauge(): number | undefined {
  return lastGauge("gq_oldest_backlog_age_milliseconds");
}

describe("GroupQueueMetricsCollector — oldest backlog age", () => {
  beforeEach(() => {
    meter = createRecordingMeterProvider();
    meter.install();
    // Frozen clock: a score of now+5s must stay DEFERRED through the whole
    // test, however slowly CI runs it — otherwise the group turns eligible,
    // the deferred sample skips its head job, and the assertion flakes.
    vi.useFakeTimers({ now: Date.now() });
  });

  afterEach(() => {
    vi.useRealTimers();
    meter.uninstall();
  });

  describe("when a group is pinned in retry backoff (deferred ready score, day-old head job)", () => {
    it("reports the head job's age even though the eligible gauge reads 0", async () => {
      // Nothing eligible: the group's ready score was rewritten to now+backoff
      // by the last failed attempt (a real backoff, not the full incident
      // delay), so the eligible scan sees an empty queue.
      const headDueMs = Date.now() - 60_000;
      const { redis } = makeRedis({
        readyZset: [{ member: "tenant/sub/trace:abc", score: Date.now() + 5_000 }],
        headJobScores: {
          [`${PREFIX}group:tenant/sub/trace:abc:jobs`]: ["job-1", String(headDueMs)],
        },
      });

      await runCollect(redis);

      expect(readGauge()).toBe(0);
      expect(readBacklogGauge()).toBe(60_000);
    });
  });

  describe("when a deferred group's head job is scheduled in the future", () => {
    it("does not count it as backlog", async () => {
      const { redis } = makeRedis({
        readyZset: [{ member: "tenant/sub/trace:delayed", score: Date.now() + 5_000 }],
        headJobScores: {
          [`${PREFIX}group:tenant/sub/trace:delayed:jobs`]: [
            "job-1",
            String(Date.now() + 3_600_000),
          ],
        },
      });

      await runCollect(redis);

      expect(readBacklogGauge()).toBe(0);
    });
  });

  describe("when only an eligible group is waiting", () => {
    it("folds the eligible head into the backlog age", async () => {
      const { redis } = makeRedis({
        readyZset: [{ member: "group-abc", score: Date.now() - 5_000 }],
      });

      await runCollect(redis);

      expect(readBacklogGauge()).toBe(5_000);
    });
  });

  describe("given 50 long-delayed groups and a single day-old retry-backoff group", () => {
    describe("when metrics are collected", () => {
      it("still surfaces the retry-backoff group's age (regression: nearest-first sampling)", async () => {
        // Regression for 2026-08-05: fifty monitor-timer groups scored hours
        // out must NOT displace a retry-backoff group (seconds out) from the
        // sample. The old zrevrange(0, 49) (largest-first) would let them;
        // nearest-first zrangebyscore ranks the backoff group first.
        const now = Date.now();
        const readyZset: ReadyEntry[] = [];
        const headJobScores: Record<string, string[]> = {};

        for (let i = 0; i < 50; i++) {
          const groupId = `tenant/sub/trace:long-delayed-${i}`;
          readyZset.push({ member: groupId, score: now + 3_600_000 });
          headJobScores[`${PREFIX}group:${groupId}:jobs`] = ["job-future", String(now + 3_600_000)];
        }

        const backoffGroupId = "tenant/sub/trace:day-old-backoff";
        readyZset.push({ member: backoffGroupId, score: now + 5_000 });
        headJobScores[`${PREFIX}group:${backoffGroupId}:jobs`] = [
          "job-1",
          String(now - 86_400_000),
        ];

        const { redis } = makeRedis({ readyZset, headJobScores });

        await runCollect(redis);

        expect(readBacklogGauge()).toBe(86_400_000);
      });
    });
  });
});

/**
 * The aggregate gauges above are blind to one group holding an enormous
 * staging hash. These cover the sweep that closes that gap — and that it's
 * a rotation, not a sample, since a sample of ready's head misses the outlier.
 */
describe("GroupQueueMetricsCollector, per-group staging depth", () => {
  beforeEach(() => {
    meter = createRecordingMeterProvider();
    meter.install();
    vi.useFakeTimers({ now: Date.now() });
  });

  afterEach(() => {
    vi.useRealTimers();
    meter.uninstall();
  });

  const readMax = () => lastGauge("gq_group_staging_depth_max");

  const readOverThreshold = () => lastGauge("gq_groups_over_staging_depth");

  const ready = (...members: string[]): ReadyEntry[] =>
    members.map((member, i) => ({ member, score: Date.now() + i }));

  describe("given groups of differing depth", () => {
    describe("when a cycle reads them", () => {
      it("reports the deepest group, not the total or the average", async () => {
        const { redis } = makeRedis({
          readyZset: ready("shallow", "deep", "middling"),
          stagingDepths: { shallow: 5, deep: 900, middling: 12 },
        });

        await runCollect(redis);

        expect(readMax()).toBe(900);
      });

      it("counts how many are over the reporting threshold", async () => {
        const { redis } = makeRedis({
          readyZset: ready("a", "b", "c"),
          stagingDepths: {
            a: STAGING_DEPTH_REPORT_FLOOR,
            b: STAGING_DEPTH_REPORT_FLOOR - 1,
            c: STAGING_DEPTH_REPORT_FLOOR * 3,
          },
        });

        await runCollect(redis);

        // One hot key and a stalled drainer both raise the max; only this
        // separates them.
        // The floor is inclusive: `a` sits exactly on it and counts, `b` is
        // one below and does not. That boundary is the one most likely to be
        // chosen deliberately, so it is the one worth pinning.
        expect(readOverThreshold()).toBe(2);
      });
    });
  });

  describe("given the deep group is past the first page", () => {
    describe("when the rotation continues across cycles", () => {
      it("reports it, which a fixed sample of the head never would", async () => {
        const { redis } = makeRedis({
          readyZset: ready("g1", "g2", "g3", "deep"),
          stagingDepths: { g1: 1, g2: 2, g3: 3, deep: 250_000 },
          scanPageSize: 2,
        });
        const collector = makeCollector({ redis });

        await collector.collect();
        expect(readMax()).toBe(2);

        await collector.collect();
        expect(readMax()).toBe(250_000);
      });
    });
  });

  describe("given a group that was deep and has drained", () => {
    describe("when the next rotation reads it", () => {
      it("stops reporting the old depth instead of pinning the high-water mark", async () => {
        const depths: Record<string, number> = { quiet: 3, deep: 250_000 };
        const { redis } = makeRedis({
          readyZset: ready("quiet", "deep"),
          stagingDepths: depths,
        });
        const collector = makeCollector({ redis });

        // One cycle covers both groups, so this cycle completes a rotation.
        await collector.collect();
        expect(readMax()).toBe(250_000);

        depths.deep = 0;
        await collector.collect();

        expect(readMax()).toBe(3);
      });
    });
  });

  describe("given a group that disappeared mid-sweep", () => {
    describe("when its depth read fails or finds nothing", () => {
      it("reports no depth for it, because neither reply is evidence of one", async () => {
        const { redis } = makeRedis({
          readyZset: ready("gone", "errored", "real"),
          // "gone" drained between the scan and the read: HLEN on a missing
          // key is 0, which the stub returns for any group with no entry.
          stagingDepths: { real: 7 },
          stagingDepthErrors: ["errored"],
        });

        await runCollect(redis);

        expect(readMax()).toBe(7);
        expect(readOverThreshold()).toBe(0);
      });
    });
  });

  describe("given a deep group that is parked, blocked or in flight", () => {
    describe("when the rotation runs", () => {
      it("still reports it, because those groups are in no ready set", async () => {
        // A group is in exactly one of ready, parked, blocked or active, and
        // staging keeps filling the `:data` hash of a group in any of them.
        // Sweeping ready would report zero here, which is healthy-looking
        // precisely while something is stopping the group's drainer.
        const { redis } = makeRedis({
          readyZset: ready("draining-normally"),
          pendingGroups: ["draining-normally", "parked-and-growing"],
          stagingDepths: {
            "draining-normally": 4,
            "parked-and-growing": STAGING_DEPTH_REPORT_FLOOR * 25,
          },
        });

        await runCollect(redis);

        expect(readMax()).toBe(STAGING_DEPTH_REPORT_FLOOR * 25);
        expect(readOverThreshold()).toBe(1);
      });
    });
  });

  describe("given a cycle that is still running when the next tick fires", () => {
    describe("when the second cycle starts", () => {
      it("skips it, rather than two cycles sharing one rotation", async () => {
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const { redis, sscan } = makeRedis({
          readyZset: ready("g1", "g2"),
          stagingDepths: { g1: 1, g2: 2 },
          gateFirstCall: gate,
        });
        const collector = makeCollector({ redis });

        collector.fire();
        await collector.collect();

        // The first cycle is held before it reaches the sweep. If the second
        // got past the guard it would reach the sweep on its own, read the
        // same cursor, and advance it a second time.
        expect(sscan).not.toHaveBeenCalled();

        release();
        await settle();

        expect(sscan).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("given a group SSCAN returns on two pages", () => {
    describe("when the rotation counts groups over the threshold", () => {
      it("counts it once, because the scan promises at least once", async () => {
        const deep = STAGING_DEPTH_REPORT_FLOOR * 2;
        const { redis } = makeRedis({
          // "seen-twice" spans a page boundary, which is what a rehash part
          // way through a rotation looks like from here.
          readyZset: ready("seen-twice", "other", "seen-twice", "another"),
          stagingDepths: {
            "seen-twice": deep,
            other: 1,
            another: 2,
          },
          scanPageSize: 2,
        });
        const collector = makeCollector({ redis });

        await collector.collect();
        await collector.collect();

        expect(readOverThreshold()).toBe(1);
        expect(readMax()).toBe(deep);
      });
    });
  });

  describe("given every depth reply in a page fails", () => {
    describe("when the sweep publishes", () => {
      it("says how many it dropped, so a healthy zero is not fabricated", async () => {
        const logger = makeLogger();
        const { redis } = makeRedis({
          readyZset: ready("a", "b"),
          stagingDepthErrors: ["a", "b"],
        });

        await makeCollector({ redis, logger }).collect();

        // Both gauges read 0 here, which is indistinguishable from a quiet
        // queue. The log line is the only thing that says the sweep saw
        // nothing rather than nothing being there.
        expect(readMax()).toBe(0);
        expect(logger.debug).toHaveBeenCalledWith(
          expect.objectContaining({ dropped: 2, ofGroups: 2 }),
          expect.stringContaining("dropped replies"),
        );
      });
    });
  });

  describe("given an empty pending-groups index", () => {
    describe("when a cycle runs", () => {
      it("reports zero rather than leaving the last value standing", async () => {
        const { redis } = makeRedis({ readyZset: [] });

        await runCollect(redis);

        expect(readMax()).toBe(0);
        expect(readOverThreshold()).toBe(0);
      });
    });
  });
});

describe("GroupQueueMetricsCollector — blocked groups by pipeline and job", () => {
  beforeEach(() => {
    meter = createRecordingMeterProvider();
    meter.install();
    vi.useFakeTimers({ now: Date.now() });
  });

  afterEach(() => {
    vi.useRealTimers();
    meter.uninstall();
  });

  const traceFold = {
    pipeline_name: "trace_processing",
    job_type: "projection",
    job_name: "traceSummary",
  };
  const evalHandler = { pipeline_name: "evaluation", job_type: "handler", job_name: "runEval" };

  function blockedFor(labels: Record<string, string>): number | undefined {
    return meter.valuesOf("gq_blocked_groups", { queue_name: QUEUE, ...labels }).at(-1);
  }

  describe("given blocked groups from two jobs", () => {
    describe("when a cycle runs", () => {
      /** @scenario "Blocked groups are counted per pipeline and job" */
      it("publishes one series per pipeline and job of the groups' head jobs", async () => {
        const { redis } = makeRedis({
          blocked: ["t1/a", "t2/a", "t1/b"],
          routing: {
            "t1/a": ["trace_processing", "projection", "traceSummary"],
            "t2/a": ["trace_processing", "projection", "traceSummary"],
            "t1/b": ["evaluation", "handler", "runEval"],
          },
        });

        await runCollect(redis);

        expect(blockedFor(traceFold)).toBe(2);
        expect(blockedFor(evalHandler)).toBe(1);
      });
    });
  });

  describe("given a job whose blocked groups were all unblocked", () => {
    describe("when the next cycle runs", () => {
      /** @scenario "A cleared job's blocked series drops to zero" */
      it("sets that job's series to 0 instead of leaving its last value", async () => {
        const blocked = ["t1/a", "t1/b"];
        const { redis } = makeRedis({
          blocked,
          routing: {
            "t1/a": ["trace_processing", "projection", "traceSummary"],
            "t1/b": ["evaluation", "handler", "runEval"],
          },
        });
        const collector = makeCollector({ redis });
        await collector.collect();
        expect(blockedFor(evalHandler)).toBe(1);

        blocked.splice(1, 1);
        await collector.collect();

        expect(blockedFor(evalHandler)).toBe(0);
        expect(blockedFor(traceFold)).toBe(1);
      });
    });
  });

  describe("given a group whose head job carries no routing header", () => {
    describe("when a cycle runs", () => {
      /** @scenario "A blocked group without routing metadata counts as unknown" */
      it("counts it under unknown so the series still sum to the queue total", async () => {
        const { redis } = makeRedis({ blocked: ["t1/legacy"] });

        await runCollect(redis);

        expect(
          blockedFor({ pipeline_name: "unknown", job_type: "unknown", job_name: "unknown" }),
        ).toBe(1);
      });
    });
  });

  describe("given more blocked groups than the scan returns", () => {
    describe("when a cycle runs", () => {
      /** @scenario "A blocked group without routing metadata counts as unknown" */
      it("attributes the remainder to unknown so the series still sum to SCARD", async () => {
        const { redis } = makeRedis({
          blocked: ["t1/a", "t2/a"],
          blockedTotal: 5,
          routing: {
            "t1/a": ["trace_processing", "projection", "traceSummary"],
            "t2/a": ["trace_processing", "projection", "traceSummary"],
          },
        });

        await runCollect(redis);

        expect(blockedFor(traceFold)).toBe(2);
        expect(
          blockedFor({ pipeline_name: "unknown", job_type: "unknown", job_name: "unknown" }),
        ).toBe(3);
      });
    });
  });

  describe("given a group that stays blocked across cycles", () => {
    describe("when a later cycle runs", () => {
      it("resolves its labels once rather than every cycle", async () => {
        const { redis, evalsha } = makeRedis({
          blocked: ["t1/a"],
          routing: { "t1/a": ["trace_processing", "projection", "traceSummary"] },
        });
        const collector = makeCollector({ redis });
        await collector.collect();
        const callsAfterFirst = evalsha.mock.calls.length;

        await collector.collect();

        expect(evalsha.mock.calls.length).toBe(callsAfterFirst);
        expect(blockedFor(traceFold)).toBe(1);
      });
    });
  });
});

describe("GroupQueueMetricsCollector — oldest pending age by pipeline and job", () => {
  beforeEach(() => {
    meter = createRecordingMeterProvider();
    meter.install();
    vi.useFakeTimers({ now: Date.now() });
  });

  afterEach(() => {
    vi.useRealTimers();
    meter.uninstall();
  });

  describe("given the oldest eligible group changes between cycles", () => {
    /** @scenario "The oldest pending age names the oldest group's pipeline and job" */
    it("labels the age with the oldest group's job and zeroes the previous holder", async () => {
      const readyZset = [{ member: "t1/a", score: Date.now() - 5_000 }];
      const { redis } = makeRedis({
        readyZset,
        routing: {
          "t1/a": ["trace_processing", "projection", "traceSummary"],
          "t1/b": ["evaluation", "handler", "runEval"],
        },
      });
      const collector = makeCollector({ redis });
      await collector.collect();
      expect(
        meter
          .valuesOf("gq_oldest_pending_age_milliseconds", {
            queue_name: QUEUE,
            pipeline_name: "trace_processing",
            job_name: "traceSummary",
          })
          .at(-1),
      ).toBe(5_000);

      // The next tick advances the frozen clock by one interval before reading.
      readyZset.splice(0, 1, { member: "t1/b", score: Date.now() + METRICS_INTERVAL_MS - 2_000 });
      await collector.collect();

      const ageOf = (job_name: string) =>
        meter
          .valuesOf("gq_oldest_pending_age_milliseconds", { queue_name: QUEUE, job_name })
          .at(-1);
      expect(ageOf("traceSummary")).toBe(0);
      expect(ageOf("runEval")).toBe(2_000);
    });
  });
});

describe("GroupQueueMetricsCollector — parked tenant transitions", () => {
  beforeEach(() => {
    meter = createRecordingMeterProvider();
    meter.install();
    vi.useFakeTimers({ now: Date.now() });
  });

  afterEach(() => {
    vi.useRealTimers();
    meter.uninstall();
  });

  const parkLines = (lines: TestLogLines, fragment: string) =>
    lines.filter((line) => String(line.msg).includes(fragment));

  function collectorWithTestLogger(redis: IORedis | Cluster) {
    const { logger, lines } = createTestLogger();
    return { lines, ...makeCollector({ redis, logger: logger as never }) };
  }

  /** @scenario "A tenant's park start and stop are each logged once" */
  it("warns once when a tenant starts being parked and logs once when it stops", async () => {
    const parked: Record<string, number> = { "tenant-a": 3 };
    const { redis } = makeRedis({ parked });
    const { lines, collect } = collectorWithTestLogger(redis);

    await collect();
    parked["tenant-a"] = 7;
    await collect();
    delete parked["tenant-a"];
    await collect();
    await collect();

    const started = parkLines(lines, "started being parked");
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({
      level: 40,
      queueName: QUEUE,
      tenantId: "tenant-a",
      parkedGroups: 3,
    });
    const stopped = parkLines(lines, "stopped being parked");
    expect(stopped).toHaveLength(1);
    expect(stopped[0]).toMatchObject({ level: 30, queueName: QUEUE, tenantId: "tenant-a" });
  });

  it("treats a tenant whose parked set emptied as no longer parked", async () => {
    const parked: Record<string, number> = { "tenant-a": 2 };
    const { redis } = makeRedis({ parked });
    const { lines, collect } = collectorWithTestLogger(redis);

    await collect();
    parked["tenant-a"] = 0;
    await collect();

    expect(lines.findLine("info", "stopped being parked")).toMatchObject({ tenantId: "tenant-a" });
  });
});
