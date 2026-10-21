import { describe, expect, it, vi } from "vitest";

import { RedisAuthzEpochRepository } from "../redis.authz-epoch.repository.ts";

const ORGANIZATION_ID = "org_epoch";
const KEY = `authz:epoch:${ORGANIZATION_ID}`;

describe("RedisAuthzEpochRepository", () => {
  it("reads safe integer epochs and bumps the organization key", async () => {
    const redis = {
      get: vi.fn().mockResolvedValue("42"),
      incr: vi.fn().mockResolvedValue(43),
    };
    const epoch = RedisAuthzEpochRepository.create({ redis });

    await expect(epoch.findEpoch({ organizationId: ORGANIZATION_ID })).resolves.toBe(42);
    await expect(epoch.bump({ organizationId: ORGANIZATION_ID })).resolves.toBeUndefined();
    expect(redis.get).toHaveBeenCalledWith(KEY);
    expect(redis.incr).toHaveBeenCalledWith(KEY);
  });

  it.each([null, "", "1.5", "12x", "9007199254740992"])(
    "disables caching for an absent or malformed epoch (%s)",
    async (value) => {
      const epoch = RedisAuthzEpochRepository.create({
        redis: {
          get: vi.fn().mockResolvedValue(value),
          incr: vi.fn(),
        },
      });

      await expect(epoch.findEpoch({ organizationId: ORGANIZATION_ID })).resolves.toBeNull();
    },
  );

  /** @scenario "Redis failures preserve their boundary-specific behaviour" */
  it("fails open for unavailable Redis on reads and reports a failed bump", async () => {
    const redis = {
      get: vi.fn().mockRejectedValue(new Error("unavailable")),
      incr: vi.fn().mockRejectedValue(new Error("unavailable")),
    };
    const epoch = RedisAuthzEpochRepository.create({ redis });

    await expect(epoch.findEpoch({ organizationId: ORGANIZATION_ID })).resolves.toBeNull();
    // ADR-183 §8: the write before a bump is durable; the caller is told so it repeats it.
    await expect(epoch.bump({ organizationId: ORGANIZATION_ID })).rejects.toMatchObject({
      code: "authz_epoch_bump_failed",
    });
  });

  it("does not touch storage when Redis is not composed", async () => {
    const epoch = RedisAuthzEpochRepository.create({ redis: null });

    await expect(epoch.findEpoch({ organizationId: ORGANIZATION_ID })).resolves.toBeNull();
    await expect(epoch.bump({ organizationId: ORGANIZATION_ID })).resolves.toBeUndefined();
  });
});
