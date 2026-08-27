import Redis from "ioredis";
import { MemoryFeatureFlagService } from "@langwatch/feature-flag-server/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RedisTenantRateTrackerAdapter } from "../src/adapters/redis-tenant-rate-tracker.adapter";

function redisFake() {
  const redis = new Redis({ lazyConnect: true, enableOfflineQueue: false });
  const hashes = new Map<string, Map<string, string>>();
  const sets = new Map<string, Set<string>>();
  const values = new Map<string, string>();
  const pipeline = redis.pipeline();
  const text = (value: string | number | Buffer) => String(value);

  vi.spyOn(redis, "pipeline").mockReturnValue(pipeline);
  vi.spyOn(pipeline, "hincrby").mockImplementation((key, field, delta) => {
    const hashKey = text(key);
    const hash = hashes.get(hashKey) ?? new Map<string, string>();
    const hashField = text(field);
    hash.set(hashField, String(Number(hash.get(hashField) ?? "0") + Number(delta)));
    hashes.set(hashKey, hash);
    return pipeline;
  });
  vi.spyOn(pipeline, "hdel").mockImplementation((key, ...fields) => {
    const hash = hashes.get(text(key));
    for (const field of fields) {
      hash?.delete(text(field));
    }
    return pipeline;
  });
  vi.spyOn(pipeline, "sadd").mockImplementation((key, ...membersToAdd) => {
    const setKey = text(key);
    const members = sets.get(setKey) ?? new Set<string>();
    for (const member of membersToAdd.flat()) {
      members.add(text(member));
    }
    sets.set(setKey, members);
    return pipeline;
  });
  vi.spyOn(pipeline, "expire").mockReturnValue(pipeline);
  vi.spyOn(pipeline, "exec").mockResolvedValue([]);
  vi.spyOn(redis, "hmget").mockImplementation(async (key, ...fields) => {
    const hash = hashes.get(text(key));
    return fields.map((field) => hash?.get(text(field)) ?? null);
  });
  vi.spyOn(redis, "hgetall").mockImplementation(async (key) => {
    return Object.fromEntries(hashes.get(text(key)) ?? []);
  });
  vi.spyOn(redis, "hdel").mockImplementation(async (key, ...fields) => {
    const hash = hashes.get(text(key));
    for (const field of fields) {
      hash?.delete(text(field));
    }
    return fields.length;
  });
  vi.spyOn(redis, "smembers").mockImplementation(async (key) => [
    ...(sets.get(text(key)) ?? []),
  ]);
  vi.spyOn(redis, "get").mockImplementation(async (key) => values.get(text(key)) ?? null);
  vi.spyOn(redis, "set").mockImplementation(async (key, value) => {
    values.set(text(key), text(value));
    return "OK";
  });

  return { redis, hashes };
}

describe("RedisTenantRateTrackerAdapter", () => {
  let now: number;

  beforeEach(() => {
    now = 1_700_000_000_000;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("records minute buckets and indexes active tenants", async () => {
    const { redis } = redisFake();
    const tracker = RedisTenantRateTrackerAdapter.create({
      redis,
      now: () => now,
    });

    await tracker.record("proj_acme");
    now += 60_000;
    await tracker.record("proj_acme", 2);

    expect(await tracker.currentWindowCount("proj_acme", 120)).toBe(3);
    expect(await tracker.listActiveTenants()).toEqual(["proj_acme"]);
  });

  it("zero-pads the requested series and trims orphaned minute fields", async () => {
    const { redis, hashes } = redisFake();
    const tracker = RedisTenantRateTrackerAdapter.create({
      redis,
      now: () => now,
    });
    await tracker.record("proj_acme", 7);
    const staleMinute = String(Math.floor(now / 60_000));
    now += 30 * 24 * 60 * 60 * 1000;
    await tracker.record("proj_acme", 9);

    expect(await tracker.perMinuteSeries("proj_acme", 180)).toEqual([0, 0, 9]);
    expect(hashes.get("obs:tenant_rate:proj_acme")?.has(staleMinute)).toBe(false);
  });

  /** @scenario "Kill-switch FF makes the rate tracker record() a no-op on the hot path" */
  it("uses the feature flag as a fail-open hot-path kill switch", async () => {
    const { redis } = redisFake();
    const flags = MemoryFeatureFlagService.create();
    const isEnabled = vi.spyOn(flags, "isEnabled");
    const tracker = RedisTenantRateTrackerAdapter.create({
      redis,
      now: () => now,
      featureFlags: flags,
    });
    isEnabled.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error("down"));

    await tracker.record("proj_killed");
    await tracker.record("proj_open");

    expect(await tracker.listActiveTenants()).toEqual(["proj_open"]);
  });

  it("keeps cache read failures non-fatal and forwards a custom TTL", async () => {
    const { redis } = redisFake();
    const tracker = RedisTenantRateTrackerAdapter.create({
      redis,
      now: () => now,
    });
    vi.spyOn(redis, "get").mockRejectedValueOnce(new Error("down"));

    expect(await tracker.getCachedBaseline("proj_acme")).toBeNull();
    await tracker.setCachedBaseline({
      tenantId: "proj_acme",
      baseline: 0,
      ttlSeconds: 600,
    });
    expect(redis.set).toHaveBeenCalledWith(
      "obs:tenant_rate:baseline:proj_acme",
      "0",
      "EX",
      600,
    );
  });
});
