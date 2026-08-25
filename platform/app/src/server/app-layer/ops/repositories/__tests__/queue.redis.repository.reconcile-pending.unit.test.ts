import type { Redis } from "ioredis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueueRedisRepository } from "../queue.redis.repository";

const QUEUE_NAME = "test-queue";
const PREFIX = `${QUEUE_NAME}:gq:`;
const COUNTER_KEY = `${PREFIX}stats:total-pending`;
const MARKER_KEY = `${PREFIX}stats:pending-recon-ts`;
const DRIFT_KEY = `${PREFIX}stats:pending-drift`;
const SINGLE_FLIGHT_WINDOW_MS = 55_000;
const LEASE_MS = 30_000;

/**
 * Minimal in-memory stand-in for the Redis commands a reconcile pass issues.
 *
 * `zscan`/`sscan` page for real (a page holds at most COUNT entries) so the
 * paging loops are exercised rather than short-circuited, and `scan` is a spy
 * that records any keyspace walk so a test can assert none happens.
 *
 * `evalsha` models the marker-TTL script rather than running it; the Lua itself
 * is covered against a real Redis in
 * `__tests__/integration/pending-counter-reconcile.integration.test.ts`.
 */
class FakeRedis {
  readonly strings = new Map<string, string>();
  readonly expiries = new Map<string, number>();
  readonly zsets = new Map<string, string[]>();
  readonly sets = new Map<string, string[]>();

  /** ZCARD keys whose pipeline entry resolves to an error instead of a count. */
  readonly failingZcardKeys = new Set<string>();

  /** Runs after every pipeline `exec`, so a test can simulate a slow pass. */
  onPipelineExec: (() => void) | null = null;

  /** Runs between the last lease re-arm and the fenced counter write. */
  onBeforeFencedWrite: (() => void) | null = null;

  /**
   * Ordered log of lease re-arms and ZCARD batches, so a test can tell which
   * phase of the pass a re-arm belongs to.
   */
  readonly events: ("lease-refresh" | "zcard-batch")[] = [];

  /**
   * Keyspace SCAN over the jobs keys the fake holds, paged like the real one.
   * Matches on key existence, so it finds a group whatever index it is in.
   */
  readonly scan = vi.fn(
    // biome-ignore lint/complexity/useMaxParams: mirrors ioredis's positional scan signature
    async (
      cursor: string,
      _match: "MATCH",
      pattern: string,
      _count: "COUNT",
      count: number,
    ): Promise<[string, string[]]> => {
      const re = new RegExp(
        `^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
      );
      // Redis drops a collection when its last member goes, so a drained group
      // has no key for SCAN to return. Modelling that matters here: it is what
      // stops the sweep treating an empty group as something to adopt.
      const keys = [...this.zsets.entries()]
        .filter(([k, members]) => members.length > 0 && re.test(k))
        .map(([k]) => k)
        .sort();
      const offset = Number(cursor);
      const page = keys.slice(offset, offset + count);
      const next = offset + page.length;
      return [next >= keys.length ? "0" : String(next), page];
    },
  );
  readonly evalshaCalls: {
    key: string;
    token: string;
    ttlMs: number;
    /** Whether the marker still carried the caller's token at that moment. */
    isHeldByCaller: boolean;
  }[] = [];

  async set(
    key: string,
    value: string,
    ...options: (string | number)[]
  ): Promise<string | null> {
    if (options.includes("NX") && this.strings.has(key)) return null;
    this.strings.set(key, value);
    const pxIndex = options.indexOf("PX");
    if (pxIndex >= 0) {
      this.expiries.set(key, Number(options[pxIndex + 1]));
    }
    return "OK";
  }

  async get(key: string): Promise<string | null> {
    return this.strings.get(key) ?? null;
  }

  /** Runs after every `sadd`, so a test can disturb a multi-batch adoption. */
  onSadd: (() => void) | null = null;

  /** How many SADD batches adoption issued, to show when it stopped. */
  saddBatches = 0;

  async sadd(key: string, ...members: string[]): Promise<number> {
    const existing = this.sets.get(key) ?? [];
    let added = 0;
    for (const member of members) {
      if (existing.includes(member)) continue;
      existing.push(member);
      added += 1;
    }
    this.sets.set(key, existing);
    this.saddBatches += 1;
    this.onSadd?.();
    return added;
  }

  // biome-ignore lint/complexity/useMaxParams: mirrors ioredis's positional zscan signature
  async zscan(
    key: string,
    cursor: string,
    _count: "COUNT",
    count: number,
  ): Promise<[string, string[]]> {
    const members = this.zsets.get(key) ?? [];
    const [nextCursor, page] = this.page(members, cursor, count);
    // A ZSCAN page alternates [member, score, member, score, ...].
    return [nextCursor, page.flatMap((member) => [member, "1"])];
  }

  // biome-ignore lint/complexity/useMaxParams: mirrors ioredis's positional sscan signature
  async sscan(
    key: string,
    cursor: string,
    _count: "COUNT",
    count: number,
  ): Promise<[string, string[]]> {
    return this.page(this.sets.get(key) ?? [], cursor, count);
  }

  private page(members: string[], cursor: string, count: number): [string, string[]] {
    const offset = Number(cursor);
    const page = members.slice(offset, offset + count);
    const next = offset + page.length;
    return [next >= members.length ? "0" : String(next), page];
  }

  pipeline() {
    const keys: string[] = [];
    const self = this;
    return {
      zcard(key: string) {
        keys.push(key);
        return this;
      },
      async exec(): Promise<[Error | null, unknown][]> {
        const results = keys.map((key): [Error | null, unknown] =>
          self.failingZcardKeys.has(key)
            ? [new Error("ZCARD failed"), null]
            : [null, (self.zsets.get(key) ?? []).length],
        );
        self.events.push("zcard-batch");
        self.onPipelineExec?.();
        return results;
      },
    };
  }

  /**
   * Replace the marker as another instance would: a different token, so the
   * holder's compare-and-set no longer matches.
   */
  stealMarker(key: string): void {
    this.strings.set(key, "other-instance-token");
  }

  /** Expire the marker as a lapsed lease would, leaving it unowned. */
  expireKey(key: string): void {
    this.strings.delete(key);
    this.expiries.delete(key);
  }

  /**
   * Models the three cached scripts, told apart by their first key: the fenced
   * counter write and the marker re-arm both act on the marker (and are then
   * separated by arity), while the prune acts on the pending index.
   */
  // biome-ignore lint/complexity/useMaxParams: mirrors ioredis's positional evalsha signature
  async evalsha(
    _sha: string,
    numKeys: number,
    key: string,
    ...rest: (string | number)[]
  ): Promise<number> {
    if (key.endsWith("pending-groups")) {
      return this.applyPrune(key, rest as string[]);
    }
    // Three keys is the fenced write (marker, counter, drift); the marker re-arm
    // takes one. Keyed on the script's own arity rather than on the argument
    // count, so adding an argument to either does not silently reroute it here.
    if (numKeys === 3) {
      // Fires in the one window the fence exists for: after the last lease
      // re-arm succeeded, before the write lands.
      this.onBeforeFencedWrite?.();
      const [counterKey, driftKey, token, value, drift] = rest as [
        string,
        string,
        string,
        string,
        string,
      ];
      if (this.strings.get(key) !== token) return 0;
      this.strings.set(counterKey, String(value));
      this.strings.set(driftKey, String(drift));
      return 1;
    }
    const [token, ttlMs] = rest as [string, number];
    return this.applyMarkerTtl(key, token, Number(ttlMs));
  }

  /** SREM each id whose jobs zset re-reads as empty, atomically per the script. */
  private applyPrune(indexKey: string, args: string[]): number {
    const members = this.sets.get(indexKey) ?? [];
    let pruned = 0;
    for (let i = 0; i < args.length; i += 2) {
      const groupId = args[i]!;
      const jobsKey = args[i + 1]!;
      if ((this.zsets.get(jobsKey) ?? []).length > 0) continue;
      const at = members.indexOf(groupId);
      if (at >= 0) {
        members.splice(at, 1);
        pruned += 1;
      }
    }
    this.sets.set(indexKey, members);
    return pruned;
  }

  private applyMarkerTtl(key: string, token: string, ttlMs: number): number {
    const isHeldByCaller = this.strings.get(key) === token;
    this.evalshaCalls.push({
      key,
      token,
      ttlMs: Number(ttlMs),
      isHeldByCaller,
    });
    if (Number(ttlMs) === LEASE_MS) this.events.push("lease-refresh");
    if (!isHeldByCaller) return 0;
    if (Number(ttlMs) <= 0) {
      this.strings.delete(key);
      this.expiries.delete(key);
      return 1;
    }
    this.expiries.set(key, Number(ttlMs));
    return 1;
  }

  /** Seeds a group with `jobCount` staged jobs, indexed under `index`. */
  seedGroup(params: {
    groupId: string;
    jobCount: number;
    index: string;
    indexType: "zset" | "set";
  }): void {
    const jobs = Array.from(
      { length: params.jobCount },
      (_, i) => `${params.groupId}-job-${i}`,
    );
    this.zsets.set(`${PREFIX}group:${params.groupId}:jobs`, jobs);
    const container =
      params.indexType === "zset"
        ? (this.zsets.get(params.index) ?? [])
        : (this.sets.get(params.index) ?? []);
    container.push(params.groupId);
    if (params.indexType === "zset") this.zsets.set(params.index, container);
    else this.sets.set(params.index, container);
  }

  asRedis(): Redis {
    return this as unknown as Redis;
  }
}

describe("QueueRedisRepository.reconcileTotalPending", () => {
  let redis: FakeRedis;
  let repo: QueueRedisRepository;

  beforeEach(() => {
    redis = new FakeRedis();
    repo = new QueueRedisRepository(redis.asRedis());
  });

  describe("given groups indexed under ready, blocked and parked", () => {
    beforeEach(() => {
      redis.seedGroup({
        groupId: "tenant-a/ready-group",
        jobCount: 3,
        index: `${PREFIX}ready`,
        indexType: "zset",
      });
      redis.seedGroup({
        groupId: "tenant-a/blocked-group",
        jobCount: 2,
        index: `${PREFIX}blocked`,
        indexType: "set",
      });
      redis.sets.set(`${PREFIX}parked-tenants`, ["tenant-b"]);
      redis.seedGroup({
        groupId: "tenant-b/parked-group",
        jobCount: 4,
        index: `${PREFIX}parked:tenant-b`,
        indexType: "zset",
      });
      redis.strings.set(COUNTER_KEY, "100");
    });

    describe("when reconcile runs", () => {
      it("sums the jobs of every indexed group and heals the counter", async () => {
        const result = await repo.reconcileTotalPending(QUEUE_NAME);

        expect(result).toEqual({ counter: 100, groundTruth: 9, drift: 91 });
        expect(redis.strings.get(COUNTER_KEY)).toBe("9");
      });

      it("reads the indexes instead of walking the keyspace once adoption is done", async () => {
        // The steady state, which is what the cost claim rests on: with nothing
        // left to adopt the sweep is not due, and a pass touches only the
        // indexes. The keyspace walk is reserved for adopting groups the index
        // does not know about yet.
        redis.strings.set(
          `${PREFIX}stats:pending-recon-sweep-due`,
          String(Date.now() + 60_000),
        );

        await repo.reconcileTotalPending(QUEUE_NAME);

        expect(redis.scan).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a group listed in two indexes at once", () => {
    beforeEach(() => {
      redis.seedGroup({
        groupId: "tenant-a/moving-group",
        jobCount: 5,
        index: `${PREFIX}ready`,
        indexType: "zset",
      });
      redis.sets.set(`${PREFIX}blocked`, ["tenant-a/moving-group"]);
    });

    describe("when reconcile runs", () => {
      it("counts the group's jobs once", async () => {
        const result = await repo.reconcileTotalPending(QUEUE_NAME);

        expect(result?.groundTruth).toBe(5);
      });
    });
  });

  describe("given more groups than fit in one index page or ZCARD batch", () => {
    const groupCount = 2500;

    beforeEach(() => {
      for (let i = 0; i < groupCount; i++) {
        redis.seedGroup({
          groupId: `tenant-a/group-${i}`,
          jobCount: 1,
          index: `${PREFIX}ready`,
          indexType: "zset",
        });
      }
    });

    describe("when reconcile runs", () => {
      it("counts every group across all pages", async () => {
        const result = await repo.reconcileTotalPending(QUEUE_NAME);

        expect(result?.groundTruth).toBe(groupCount);
      });

      it("re-arms the single-flight marker after each ZCARD batch", async () => {
        await repo.reconcileTotalPending(QUEUE_NAME);

        const batches = redis.events.filter((event) => event === "zcard-batch").length;
        expect(batches).toBe(3);

        // One re-arm per batch, each landing after its batch.
        const refreshesAfterFirstBatch = redis.events
          .slice(redis.events.indexOf("zcard-batch"))
          .filter((event) => event === "lease-refresh").length;
        expect(refreshesAfterFirstBatch).toBe(batches);

        const leaseRefreshes = redis.evalshaCalls.filter(
          (call) => call.ttlMs === LEASE_MS,
        );
        expect(leaseRefreshes.every((call) => call.key === MARKER_KEY)).toBe(true);
      });

      it("re-arms the single-flight marker while paging the indexes, before any ZCARD runs", async () => {
        await repo.reconcileTotalPending(QUEUE_NAME);

        // Collection is a paging walk of its own and on a large queue can outlast
        // a lease before the first ZCARD is ever issued. If nothing re-armed
        // during that phase, the marker could lapse and another instance could
        // start a second pass over the same counter.
        const firstBatchAt = redis.events.indexOf("zcard-batch");
        const refreshesBeforeAnyBatch = redis.events
          .slice(0, firstBatchAt)
          .filter((event) => event === "lease-refresh").length;

        expect(refreshesBeforeAnyBatch).toBeGreaterThan(0);
      });
    });
  });

  describe("given a reconcile pass is already running on another instance", () => {
    beforeEach(() => {
      redis.strings.set(MARKER_KEY, "other-instance-token");
      redis.strings.set(COUNTER_KEY, "42");
    });

    describe("when reconcile runs", () => {
      it("declines the pass and leaves the counter untouched", async () => {
        const result = await repo.reconcileTotalPending(QUEUE_NAME);

        expect(result).toBeNull();
        expect(redis.strings.get(COUNTER_KEY)).toBe("42");
        expect(redis.strings.get(MARKER_KEY)).toBe("other-instance-token");
      });
    });
  });

  describe("given a pass that finishes inside the single-flight window", () => {
    beforeEach(() => {
      redis.seedGroup({
        groupId: "tenant-a/group",
        jobCount: 1,
        index: `${PREFIX}ready`,
        indexType: "zset",
      });
    });

    describe("when reconcile completes", () => {
      it("leaves the marker holding the unspent remainder of the window", async () => {
        await repo.reconcileTotalPending(QUEUE_NAME, SINGLE_FLIGHT_WINDOW_MS);

        expect(redis.strings.has(MARKER_KEY)).toBe(true);
        const remainder = redis.expiries.get(MARKER_KEY)!;
        expect(remainder).toBeGreaterThan(SINGLE_FLIGHT_WINDOW_MS - 1_000);
        expect(remainder).toBeLessThanOrEqual(SINGLE_FLIGHT_WINDOW_MS);
      });
    });
  });

  describe("given a pass that outlives the single-flight window", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      redis.seedGroup({
        groupId: "tenant-a/group",
        jobCount: 1,
        index: `${PREFIX}ready`,
        indexType: "zset",
      });
      redis.onPipelineExec = () => {
        vi.advanceTimersByTime(SINGLE_FLIGHT_WINDOW_MS * 2);
      };
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    describe("when reconcile completes", () => {
      it("releases the marker so the next cycle is not made to wait", async () => {
        await repo.reconcileTotalPending(QUEUE_NAME, SINGLE_FLIGHT_WINDOW_MS);

        expect(redis.strings.has(MARKER_KEY)).toBe(false);
      });

      it("holds the marker for the whole pass rather than letting it lapse mid-pass", async () => {
        await repo.reconcileTotalPending(QUEUE_NAME, SINGLE_FLIGHT_WINDOW_MS);

        // Ownership is the claim, not the call count: every re-arm has to find
        // this pass's own token still on the marker. A count-only assertion
        // could not fail for the reason this test exists.
        const refreshes = redis.evalshaCalls.filter((call) => call.ttlMs === LEASE_MS);
        expect(refreshes.length).toBeGreaterThan(0);
        expect(refreshes.every((call) => call.isHeldByCaller)).toBe(true);
      });
    });
  });

  describe("given the pass loses its marker to another instance mid-pass", () => {
    beforeEach(() => {
      redis.seedGroup({
        groupId: "tenant-a/group",
        jobCount: 4,
        index: `${PREFIX}pending-groups`,
        indexType: "set",
      });
      redis.strings.set(COUNTER_KEY, "99");
      // The marker changes hands while this pass is between batches, which is
      // what happens when a lease lapses and another instance acquires it.
      redis.onPipelineExec = () => redis.stealMarker(MARKER_KEY);
    });

    describe("when reconcile finishes computing", () => {
      /** @scenario "A pass that loses the marker mid-run publishes nothing" */
      it("discards the pass instead of publishing its count", async () => {
        const result = await repo.reconcileTotalPending(QUEUE_NAME);

        expect(result).toBeNull();
      });

      it("leaves the counter for the instance that now holds the marker", async () => {
        await repo.reconcileTotalPending(QUEUE_NAME);

        // Writing 4 here would put this pass's count over whatever the newer
        // holder has since published.
        expect(redis.strings.get(COUNTER_KEY)).toBe("99");
      });
    });
  });

  describe("given the marker changes hands after the last lease check", () => {
    beforeEach(() => {
      redis.seedGroup({
        groupId: "tenant-a/group",
        jobCount: 7,
        index: `${PREFIX}pending-groups`,
        indexType: "set",
      });
      redis.strings.set(COUNTER_KEY, "42");
      // Every lease re-arm succeeds, so the pass runs to completion believing it
      // still holds the marker. It changes hands in the gap the re-arms cannot
      // cover: after the final one, before the write.
      redis.onBeforeFencedWrite = () => redis.stealMarker(MARKER_KEY);
    });

    describe("when reconcile goes to write its result", () => {
      /** @scenario "The counter write itself refuses to run without the marker" */
      it("does not publish, because the write itself checks ownership", async () => {
        const result = await repo.reconcileTotalPending(QUEUE_NAME);

        expect(result).toBeNull();
        expect(redis.strings.get(COUNTER_KEY)).toBe("42");
      });

      /**
       * @scenario "A pass that loses the marker publishes neither the count nor the drift"
       *
       * The drift describes the count published beside it, so it has to be
       * behind the same ownership check. Written before it, this pass would
       * announce a drift of 35 for a heal it never landed.
       */
      it("publishes no drift either, having published no count", async () => {
        await repo.reconcileTotalPending(QUEUE_NAME);

        expect(redis.strings.get(DRIFT_KEY)).toBeUndefined();
      });
    });
  });

  describe("given the marker expires mid-pass and nobody else takes it", () => {
    beforeEach(() => {
      redis.seedGroup({
        groupId: "tenant-a/group",
        jobCount: 2,
        index: `${PREFIX}pending-groups`,
        indexType: "set",
      });
      redis.strings.set(COUNTER_KEY, "50");
      redis.onPipelineExec = () => redis.expireKey(MARKER_KEY);
    });

    describe("when reconcile finishes computing", () => {
      /** @scenario "A pass whose marker lapses unclaimed publishes nothing" */
      it("still declines to write, having lost the right to", async () => {
        const result = await repo.reconcileTotalPending(QUEUE_NAME);

        expect(result).toBeNull();
        expect(redis.strings.get(COUNTER_KEY)).toBe("50");
      });
    });
  });

  describe("given a group that moves between lifecycle indexes during the pass", () => {
    beforeEach(() => {
      // The pending index is what the group is counted from. It is written with
      // the job itself, so it holds the group no matter which lifecycle index the
      // group happens to be sitting in when each of those is read.
      redis.seedGroup({
        groupId: "tenant-a/moving-group",
        jobCount: 6,
        index: `${PREFIX}pending-groups`,
        indexType: "set",
      });
      // In no lifecycle index at all: mid-transition, in neither the one already
      // read nor the one still to be read.
      redis.strings.set(COUNTER_KEY, "0");
    });

    describe("when reconcile runs", () => {
      it("still counts the group's jobs", async () => {
        const result = await repo.reconcileTotalPending(QUEUE_NAME);

        expect(result?.groundTruth).toBe(6);
      });
    });
  });

  describe("given a group known only to the lifecycle indexes", () => {
    beforeEach(() => {
      // No pending-index entry: staged before the index existed, or by a pod on
      // the previous release during a rollout.
      redis.seedGroup({
        groupId: "tenant-a/legacy",
        jobCount: 4,
        index: `${PREFIX}ready`,
        indexType: "zset",
      });
      redis.strings.set(COUNTER_KEY, "0");
    });

    describe("when reconcile runs", () => {
      it("counts it and adopts it into the pending index", async () => {
        const result = await repo.reconcileTotalPending(QUEUE_NAME);

        expect(result?.groundTruth).toBe(4);
        // Adopted on first sight, so later passes no longer depend on reading the
        // lifecycle indexes in sequence to find it.
        expect(redis.sets.get(`${PREFIX}pending-groups`)).toContain("tenant-a/legacy");
      });
    });
  });

  describe("given an unindexed group that moves between the lifecycle reads", () => {
    beforeEach(() => {
      // The counterexample the lifecycle legs cannot cover: holding jobs, in the
      // pending index nowhere, and in no lifecycle index at the moment each of
      // those is read — unblocked into an already-scanned `ready` before
      // `blocked` was reached.
      redis.zsets.set(`${PREFIX}group:tenant-a/mover:jobs`, [
        "j1",
        "j2",
        "j3",
        "j4",
        "j5",
      ]);
      redis.strings.set(COUNTER_KEY, "0");
    });

    describe("when reconcile runs", () => {
      /** @scenario "A group no index lists is still counted and adopted" */
      it("counts it from the keyspace and adopts it for later passes", async () => {
        const result = await repo.reconcileTotalPending(QUEUE_NAME);

        expect(result?.groundTruth).toBe(5);
        expect(redis.sets.get(`${PREFIX}pending-groups`)).toContain("tenant-a/mover");
      });
    });
  });

  describe("given the keyspace sweep has nothing left to adopt", () => {
    beforeEach(() => {
      redis.seedGroup({
        groupId: "tenant-a/known",
        jobCount: 1,
        index: `${PREFIX}pending-groups`,
        indexType: "set",
      });
    });

    describe("when reconcile runs twice", () => {
      it("stops walking the keyspace once the index is complete", async () => {
        await repo.reconcileTotalPending(QUEUE_NAME, 0);
        const afterFirst = redis.scan.mock.calls.length;
        expect(afterFirst).toBeGreaterThan(0);

        await repo.reconcileTotalPending(QUEUE_NAME, 0);

        // Nothing was adopted, so the sweep backs off instead of paying the
        // keyspace walk on every pass.
        expect(redis.scan.mock.calls.length).toBe(afterFirst);
      });
    });
  });

  describe("given the sweep has backed off to its backstop interval", () => {
    const BACKSTOP_MS = 60 * 60 * 1000;

    beforeEach(() => {
      vi.useFakeTimers();
      redis.seedGroup({
        groupId: "tenant-a/known",
        jobCount: 1,
        index: `${PREFIX}pending-groups`,
        indexType: "set",
      });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    /** Passes between sweeps, none of which should touch the deadline. */
    const runPassesOver = async (totalMs: number, passes: number) => {
      for (let i = 0; i < passes; i++) {
        vi.advanceTimersByTime(Math.floor(totalMs / passes));
        await repo.reconcileTotalPending(QUEUE_NAME, 0);
      }
    };

    describe("when reconciles keep running before the deadline", () => {
      /** @scenario "Reconciles between sweeps do not postpone the scheduled sweep" */
      it("still sweeps once the backstop elapses", async () => {
        // First pass sweeps and finds nothing to adopt, so the next is scheduled
        // a backstop away.
        await repo.reconcileTotalPending(QUEUE_NAME, 0);
        const afterFirstSweep = redis.scan.mock.calls.length;
        expect(afterFirstSweep).toBeGreaterThan(0);

        // Passes covering most of the interval must leave the deadline alone.
        await runPassesOver(BACKSTOP_MS - 60_000, 30);
        expect(redis.scan.mock.calls.length).toBe(afterFirstSweep);

        // Once the interval has genuinely elapsed, the sweep comes due.
        vi.advanceTimersByTime(120_000);
        await repo.reconcileTotalPending(QUEUE_NAME, 0);

        expect(redis.scan.mock.calls.length).toBeGreaterThan(afterFirstSweep);
      });
    });

    describe("when a sweep finds a group the index does not list", () => {
      /** @scenario "A sweep that adopts keeps sweeping on the next pass" */
      it("sweeps again on the very next pass", async () => {
        await repo.reconcileTotalPending(QUEUE_NAME, 0);
        const afterFirstSweep = redis.scan.mock.calls.length;

        // Arrives after the first sweep, indexed nowhere: the state a pod on the
        // previous release leaves behind mid-rollout.
        redis.zsets.set(`${PREFIX}group:tenant-a/late:jobs`, ["j1"]);
        vi.advanceTimersByTime(BACKSTOP_MS + 1);
        await repo.reconcileTotalPending(QUEUE_NAME, 0);
        const afterAdoptingSweep = redis.scan.mock.calls.length;
        expect(afterAdoptingSweep).toBeGreaterThan(afterFirstSweep);

        // That sweep adopted, so the next pass sweeps again without waiting.
        await repo.reconcileTotalPending(QUEUE_NAME, 0);

        expect(redis.scan.mock.calls.length).toBeGreaterThan(afterAdoptingSweep);
      });
    });

    describe("when a drained group is still listed in a lifecycle index", () => {
      /** @scenario "A drained group listed in a lifecycle index does not pin the sweep" */
      it("does not keep the expensive walk running on it", async () => {
        // Listed in ready with no jobs: adopted, pruned for being empty, and
        // found again next pass. Counting it as an adoption would answer
        // "sweep again" forever.
        redis.zsets.set(`${PREFIX}ready`, ["tenant-a/drained"]);
        redis.zsets.set(`${PREFIX}group:tenant-a/drained:jobs`, []);

        await repo.reconcileTotalPending(QUEUE_NAME, 0);
        const afterFirstSweep = redis.scan.mock.calls.length;

        await repo.reconcileTotalPending(QUEUE_NAME, 0);

        expect(redis.scan.mock.calls.length).toBe(afterFirstSweep);
      });
    });
  });

  describe("given the lease is lost while adopting a multi-batch backlog", () => {
    beforeEach(() => {
      for (let i = 0; i < 2500; i++) {
        redis.seedGroup({
          groupId: `tenant-a/legacy-${i}`,
          jobCount: 1,
          index: `${PREFIX}ready`,
          indexType: "zset",
        });
      }
      redis.strings.set(COUNTER_KEY, "9999");
      // Adoption spans several SADD batches; the marker changes hands during it.
      redis.onSadd = () => redis.stealMarker(MARKER_KEY);
    });

    describe("when reconcile runs", () => {
      it("stops adopting instead of finishing the batches on someone else's marker", async () => {
        // 2500 groups is three SADD batches. The publish is already safe without
        // this check — summation re-arms the lease and would abort before writing
        // — so what is under test is that the work stops, rather than the pass
        // grinding through the rest of a backlog for an instance that has moved
        // on. That overlap is the cost the marker exists to prevent.
        const result = await repo.reconcileTotalPending(QUEUE_NAME);

        expect(redis.saddBatches).toBe(1);
        expect(result).toBeNull();
        expect(redis.strings.get(COUNTER_KEY)).toBe("9999");
      });
    });
  });

  describe("given a group in the pending index whose jobs have drained", () => {
    beforeEach(() => {
      redis.sets.set(`${PREFIX}pending-groups`, ["tenant-a/drained"]);
      redis.zsets.set(`${PREFIX}group:tenant-a/drained:jobs`, []);
      redis.strings.set(COUNTER_KEY, "3");
    });

    describe("when reconcile runs", () => {
      it("counts it as zero and prunes it from the index", async () => {
        const result = await repo.reconcileTotalPending(QUEUE_NAME);

        expect(result?.groundTruth).toBe(0);
        expect(redis.sets.get(`${PREFIX}pending-groups`)).toEqual([]);
      });
    });
  });

  describe("given a ZCARD in the pipeline fails", () => {
    beforeEach(() => {
      redis.seedGroup({
        groupId: "tenant-a/good-group",
        jobCount: 3,
        index: `${PREFIX}ready`,
        indexType: "zset",
      });
      redis.seedGroup({
        groupId: "tenant-a/flaky-group",
        jobCount: 4,
        index: `${PREFIX}ready`,
        indexType: "zset",
      });
      redis.failingZcardKeys.add(`${PREFIX}group:tenant-a/flaky-group:jobs`);
      redis.strings.set(COUNTER_KEY, "77");
    });

    describe("when reconcile runs", () => {
      it("aborts without writing a partial under-count", async () => {
        const result = await repo.reconcileTotalPending(QUEUE_NAME);

        expect(result).toBeNull();
        expect(redis.strings.get(COUNTER_KEY)).toBe("77");
      });
    });
  });
});
