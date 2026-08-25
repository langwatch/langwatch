import { describe, expect, it, vi } from "vitest";
import { RedisAuthzEpochAdapter } from "../../src/adapters/redis.authz-epoch.adapter";

const ORGANIZATION_ID = "org_epoch";
const KEY = `authz:epoch:${ORGANIZATION_ID}`;

describe("RedisAuthzEpochAdapter", () => {
  it("reads safe integer epochs and bumps the organization key", async () => {
    const redis = {
      get: vi.fn().mockResolvedValue("42"),
      incr: vi.fn().mockResolvedValue(43),
    };
    const epoch = RedisAuthzEpochAdapter.create({ redis });

    await expect(epoch.tryRead({ organizationId: ORGANIZATION_ID })).resolves.toBe(42);
    await expect(
      epoch.bump({ organizationId: ORGANIZATION_ID }),
    ).resolves.toBeUndefined();
    expect(redis.get).toHaveBeenCalledWith(KEY);
    expect(redis.incr).toHaveBeenCalledWith(KEY);
  });

  it.each([null, "", "1.5", "12x", "9007199254740992"])(
    "disables caching for an absent or malformed epoch (%s)",
    async (value) => {
      const epoch = RedisAuthzEpochAdapter.create({
        redis: {
          get: vi.fn().mockResolvedValue(value),
          incr: vi.fn(),
        },
      });

      await expect(
        epoch.tryRead({ organizationId: ORGANIZATION_ID }),
      ).resolves.toBeNull();
    },
  );

  /** @scenario "Redis failures preserve their boundary-specific behaviour" */
  it("fails open for unavailable Redis on reads and bumps", async () => {
    const redis = {
      get: vi.fn().mockRejectedValue(new Error("unavailable")),
      incr: vi.fn().mockRejectedValue(new Error("unavailable")),
    };
    const epoch = RedisAuthzEpochAdapter.create({ redis });

    await expect(epoch.tryRead({ organizationId: ORGANIZATION_ID })).resolves.toBeNull();
    await expect(
      epoch.bump({ organizationId: ORGANIZATION_ID }),
    ).resolves.toBeUndefined();
  });

  it("does not touch storage when Redis is not composed", async () => {
    const epoch = RedisAuthzEpochAdapter.create({ redis: null });

    await expect(epoch.tryRead({ organizationId: ORGANIZATION_ID })).resolves.toBeNull();
    await expect(
      epoch.bump({ organizationId: ORGANIZATION_ID }),
    ).resolves.toBeUndefined();
  });
});
