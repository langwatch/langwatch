import { describe, expect, it, vi } from "vitest";

import { RedisAuthzLineageEpochRepository } from "../redis.authz-lineage-epoch.repository.ts";

const ORGANIZATION_ID = "org_lineage";
const KEY = `authz:lineage-epoch:${ORGANIZATION_ID}`;

describe("RedisAuthzLineageEpochRepository", () => {
  it("reads the organization's signal and moves it", async () => {
    const redis = {
      get: vi.fn().mockResolvedValue("7"),
      incr: vi.fn().mockResolvedValue(8),
    };
    const signal = RedisAuthzLineageEpochRepository.create({ redis });

    await expect(signal.findEpoch({ organizationId: ORGANIZATION_ID })).resolves.toBe(7);
    await expect(signal.bump({ organizationId: ORGANIZATION_ID })).resolves.toBeUndefined();
    expect(redis.get).toHaveBeenCalledWith(KEY);
    expect(redis.incr).toHaveBeenCalledWith(KEY);
  });

  it("reads a never-moved organization as 0", async () => {
    const signal = RedisAuthzLineageEpochRepository.create({
      redis: { get: vi.fn().mockResolvedValue(null), incr: vi.fn() },
    });

    await expect(signal.findEpoch({ organizationId: ORGANIZATION_ID })).resolves.toBe(0);
  });

  /** @scenario "A lineage signal that cannot be read holds no lineage" */
  it.each(["", "1.5", "12x", "9007199254740992"])(
    "answers null for a malformed signal (%s)",
    async (value) => {
      const signal = RedisAuthzLineageEpochRepository.create({
        redis: { get: vi.fn().mockResolvedValue(value), incr: vi.fn() },
      });

      await expect(signal.findEpoch({ organizationId: ORGANIZATION_ID })).resolves.toBeNull();
    },
  );

  /** @scenario "A lineage signal that cannot be read holds no lineage" */
  it("answers null when Redis cannot be read", async () => {
    const signal = RedisAuthzLineageEpochRepository.create({
      redis: { get: vi.fn().mockRejectedValue(new Error("unavailable")), incr: vi.fn() },
    });

    await expect(signal.findEpoch({ organizationId: ORGANIZATION_ID })).resolves.toBeNull();
  });

  /** @scenario "A lineage signal that cannot be moved is retried" */
  it("throws when the signal cannot be moved", async () => {
    const signal = RedisAuthzLineageEpochRepository.create({
      redis: { get: vi.fn(), incr: vi.fn().mockRejectedValue(new Error("unavailable")) },
    });

    await expect(signal.bump({ organizationId: ORGANIZATION_ID })).rejects.toThrow("unavailable");
  });
});
