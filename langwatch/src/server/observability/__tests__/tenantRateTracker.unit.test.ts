import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TenantRateTracker,
  tenantIdFromGroupId,
} from "../tenantRateTracker";

// Pure helper — no Redis needed.
describe("tenantIdFromGroupId", () => {
  it("extracts the prefix before the first /", () => {
    expect(tenantIdFromGroupId("proj_abc/fold/x/y")).toBe("proj_abc");
  });

  it("returns null for groupIds with no slash", () => {
    expect(tenantIdFromGroupId("no-slash-here")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(tenantIdFromGroupId("")).toBeNull();
  });

  it("returns null when the slash is the first char (no tenant)", () => {
    expect(tenantIdFromGroupId("/foo/bar")).toBeNull();
  });
});

/**
 * Minimal in-memory Redis fake. Implements just the methods the tracker
 * touches: pipeline + hmget + smembers. Pipelined commands execute in
 * order; we don't simulate Redis semantics beyond that.
 */
function fakeRedis() {
  const hashes = new Map<string, Map<string, number>>();
  const sets = new Map<string, Set<string>>();

  const ops = {
    hincrby(key: string, field: string, delta: number) {
      const h = hashes.get(key) ?? new Map<string, number>();
      h.set(field, (h.get(field) ?? 0) + delta);
      hashes.set(key, h);
    },
    expire(_key: string, _ttl: number) {
      // no-op in fake; we trust Redis on TTL
    },
    sadd(key: string, member: string) {
      const s = sets.get(key) ?? new Set<string>();
      s.add(member);
      sets.set(key, s);
    },
    hmget(key: string, ...fields: string[]) {
      const h = hashes.get(key);
      return fields.map((f) => (h?.has(f) ? String(h.get(f)) : null));
    },
    smembers(key: string) {
      return Array.from(sets.get(key) ?? new Set<string>());
    },
  };

  return {
    pipeline() {
      const queued: Array<() => void> = [];
      const pipe = {
        hincrby(key: string, field: string, delta: number) {
          queued.push(() => ops.hincrby(key, field, delta));
          return pipe;
        },
        expire(key: string, ttl: number) {
          queued.push(() => ops.expire(key, ttl));
          return pipe;
        },
        sadd(key: string, member: string) {
          queued.push(() => ops.sadd(key, member));
          return pipe;
        },
        async exec() {
          for (const fn of queued) fn();
          return [];
        },
      };
      return pipe;
    },
    async hmget(key: string, ...fields: string[]) {
      return ops.hmget(key, ...fields);
    },
    async smembers(key: string) {
      return ops.smembers(key);
    },
  } as any;
}

describe("TenantRateTracker", () => {
  let now: number;
  let nowFn: () => number;

  beforeEach(() => {
    now = 1_700_000_000_000; // fixed point in time
    nowFn = () => now;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("records enqueues against the current minute bucket", async () => {
    const redis = fakeRedis();
    const tracker = new TenantRateTracker(redis, nowFn);

    await tracker.record("proj_acme");
    await tracker.record("proj_acme");
    await tracker.record("proj_acme", 3);

    const count = await tracker.currentWindowCount("proj_acme", 60);
    expect(count).toBe(5);
  });

  it("sums across multiple minute buckets within the window", async () => {
    const redis = fakeRedis();
    const tracker = new TenantRateTracker(redis, () => now);

    await tracker.record("proj_acme");
    now += 60_000;
    await tracker.record("proj_acme", 2);
    now += 60_000;
    await tracker.record("proj_acme", 4);

    // 3 minutes back → should see all 7
    const count = await tracker.currentWindowCount("proj_acme", 180);
    expect(count).toBe(7);
  });

  it("excludes buckets outside the window", async () => {
    const redis = fakeRedis();
    const tracker = new TenantRateTracker(redis, () => now);

    await tracker.record("proj_acme", 100); // bucket T-5min
    now += 5 * 60_000;
    await tracker.record("proj_acme", 3); // bucket T0

    const recent = await tracker.currentWindowCount("proj_acme", 120);
    expect(recent).toBe(3);
  });

  it("returns 0 for tenants with no data", async () => {
    const redis = fakeRedis();
    const tracker = new TenantRateTracker(redis, nowFn);

    const count = await tracker.currentWindowCount("unknown", 300);
    expect(count).toBe(0);
  });

  it("ignores empty tenantId", async () => {
    const redis = fakeRedis();
    const tracker = new TenantRateTracker(redis, nowFn);

    await tracker.record("");
    const active = await tracker.listActiveTenants();
    expect(active).toEqual([]);
  });

  it("tracks active tenants in the index set", async () => {
    const redis = fakeRedis();
    const tracker = new TenantRateTracker(redis, nowFn);

    await tracker.record("proj_a");
    await tracker.record("proj_b");

    const active = (await tracker.listActiveTenants()).sort();
    expect(active).toEqual(["proj_a", "proj_b"]);
  });

  it("perMinuteSeries returns oldest-first series of the requested length", async () => {
    const redis = fakeRedis();
    const tracker = new TenantRateTracker(redis, () => now);

    await tracker.record("proj_acme", 1);
    now += 60_000;
    await tracker.record("proj_acme", 2);
    now += 60_000;
    await tracker.record("proj_acme", 3);

    const series = await tracker.perMinuteSeries("proj_acme", 180);
    expect(series).toEqual([1, 2, 3]);
  });
});
