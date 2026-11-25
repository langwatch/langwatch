import { describe, expect, it, vi } from "vitest";

import { RedisAuthzSessionVersionRepository } from "../redis.authz-session-version.repository.ts";

const USER_ID = "user_ada";
const KEY = `authz:session-version:${USER_ID}`;

describe("RedisAuthzSessionVersionRepository", () => {
  it("reads the user's counter and bumps each named user", async () => {
    const redis = { get: vi.fn().mockResolvedValue("7"), incr: vi.fn().mockResolvedValue(8) };
    const versions = RedisAuthzSessionVersionRepository.create({ redis });

    await expect(versions.getVersion({ userId: USER_ID })).resolves.toBe(7);
    await versions.bump({ userIds: [USER_ID, "user_bo"] });

    expect(redis.get).toHaveBeenCalledWith(KEY);
    expect(redis.incr).toHaveBeenCalledWith(KEY);
    expect(redis.incr).toHaveBeenCalledWith("authz:session-version:user_bo");
  });

  it("answers 0 for a user never bumped", async () => {
    const versions = RedisAuthzSessionVersionRepository.create({
      redis: { get: vi.fn().mockResolvedValue(null), incr: vi.fn() },
    });

    await expect(versions.getVersion({ userId: USER_ID })).resolves.toBe(0);
  });

  describe("when the stored value is not a counter or Redis is unavailable", () => {
    it.each(["", "1.5", "-3", "12x", "9007199254740992"])(
      "refuses rather than guess (%s)",
      async (value) => {
        const versions = RedisAuthzSessionVersionRepository.create({
          redis: { get: vi.fn().mockResolvedValue(value), incr: vi.fn() },
        });

        await expect(versions.getVersion({ userId: USER_ID })).rejects.toThrow("is not a counter");
      },
    );

    it("lets a failed bump throw, so its subscriber is retried", async () => {
      const versions = RedisAuthzSessionVersionRepository.create({
        redis: { get: vi.fn(), incr: vi.fn().mockRejectedValue(new Error("unavailable")) },
      });

      await expect(versions.bump({ userIds: [USER_ID] })).rejects.toThrow("unavailable");
    });
  });
});
