import type { Redis } from "ioredis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueueRedisRepository } from "../queue.redis.repository";

const QUEUE_NAME = "test-queue";
const PREFIX = `${QUEUE_NAME}:gq:`;
const COUNTER_KEY = `${PREFIX}stats:total-pending`;
const MARKER_KEY = `${PREFIX}stats:pending-recon-ts`;
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

  readonly scan = vi.fn(async () => ["0", [] as string[]] as const);
  readonly evalshaCalls: { key: string; token: string; ttlMs: number }[] = [];

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

  async sscan(
    key: string,
    cursor: string,
    _count: "COUNT",
    count: number,
  ): Promise<[string, string[]]> {
    return this.page(this.sets.get(key) ?? [], cursor, count);
  }

  private page(
    members: string[],
    cursor: string,
    count: number,
  ): [string, string[]] {
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
        self.onPipelineExec?.();
        return results;
      },
    };
  }

  async evalsha(
    _sha: string,
    _numKeys: number,
    key: string,
    token: string,
    ttlMs: number,
  ): Promise<number> {
    this.evalshaCalls.push({ key, token, ttlMs: Number(ttlMs) });
    if (this.strings.get(key) !== token) return 0;
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

      it("reads the group indexes instead of walking the keyspace", async () => {
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

        const leaseRefreshes = redis.evalshaCalls.filter(
          (call) => call.ttlMs === LEASE_MS,
        );
        expect(leaseRefreshes).toHaveLength(3);
        expect(leaseRefreshes.every((call) => call.key === MARKER_KEY)).toBe(
          true,
        );
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

        // The refresh lands after the batch that overran the window, so the
        // marker is still this pass's own when the pass releases it.
        const refreshes = redis.evalshaCalls.filter(
          (call) => call.ttlMs === LEASE_MS,
        );
        expect(refreshes.length).toBeGreaterThan(0);
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
