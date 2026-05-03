/**
 * @vitest-environment node
 *
 * Integration coverage for CliTokenRevocationService — the defense-in-
 * depth that ensures a deactivated user's CLI device-flow tokens stop
 * authenticating immediately rather than waiting up to the 1h access /
 * 30d refresh TTL to expire.
 *
 * Hits real Redis (testcontainers); plants tokens directly under the
 * same key shapes that auth-cli.ts writes on /exchange + /refresh, then
 * verifies revokeForUser DELs every member of the per-user index.
 *
 * Spec: specs/ai-gateway/cli-token-revoke-on-deactivation.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { connection as redisConnection } from "~/server/redis";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";

import { CliTokenRevocationService } from "../cliTokenRevocation.service";

describe("CliTokenRevocationService.revokeForUser", () => {
  const ns = nanoid(8);

  beforeAll(async () => {
    await startTestContainers();
    if (!redisConnection) {
      throw new Error("Redis connection unavailable in test env");
    }
  });

  afterAll(async () => {
    await stopTestContainers();
  });

  describe("when the user has active access + refresh tokens", () => {
    const userId = `usr-revoke-active-${ns}`;
    const accessToken = `lw_at_${ns}-active`;
    const refreshToken = `lw_rt_${ns}-active`;
    const accessKey = CliTokenRevocationService.accessTokenKey(accessToken);
    const refreshKey = CliTokenRevocationService.refreshTokenKey(refreshToken);
    const indexKey = CliTokenRevocationService.userTokensIndexKey(userId);

    beforeAll(async () => {
      const redis = redisConnection!;
      await redis.set(
        accessKey,
        JSON.stringify({
          user_id: userId,
          organization_id: "org-x",
          issued_at: Date.now(),
          expires_at: Date.now() + 3600 * 1000,
        }),
        "EX",
        3600,
      );
      await redis.set(
        refreshKey,
        JSON.stringify({
          user_id: userId,
          organization_id: "org-x",
          issued_at: Date.now(),
          expires_at: Date.now() + 30 * 86400 * 1000,
        }),
        "EX",
        30 * 86400,
      );
      await redis.sadd(indexKey, accessKey, refreshKey);
      await redis.pexpire(indexKey, 30 * 86400 * 1000);
    });

    it("deletes both token keys and the per-user index", async () => {
      const service = CliTokenRevocationService.create(redisConnection);
      const result = await service.revokeForUser({ userId });

      expect(result.revokedCount).toBe(2);
      const redis = redisConnection!;
      expect(await redis.exists(accessKey)).toBe(0);
      expect(await redis.exists(refreshKey)).toBe(0);
      expect(await redis.exists(indexKey)).toBe(0);
    });
  });

  describe("when the user has never logged in via the CLI", () => {
    it("returns zero and touches no Redis keys", async () => {
      const userId = `usr-revoke-noop-${ns}`;
      const service = CliTokenRevocationService.create(redisConnection);

      const result = await service.revokeForUser({ userId });

      expect(result.revokedCount).toBe(0);
      const indexKey = CliTokenRevocationService.userTokensIndexKey(userId);
      expect(await redisConnection!.exists(indexKey)).toBe(0);
    });
  });

  describe("when the index lists a token whose key has already TTL-expired", () => {
    it("treats the missing key as a no-op and still cleans up the index", async () => {
      const redis = redisConnection!;
      const userId = `usr-revoke-stale-${ns}`;
      const liveAccessToken = `lw_at_${ns}-live`;
      const staleAccessToken = `lw_at_${ns}-stale`;
      const liveAccessKey =
        CliTokenRevocationService.accessTokenKey(liveAccessToken);
      const staleAccessKey =
        CliTokenRevocationService.accessTokenKey(staleAccessToken);
      const indexKey = CliTokenRevocationService.userTokensIndexKey(userId);

      // Live token + stale entry in the index but no underlying key.
      await redis.set(
        liveAccessKey,
        JSON.stringify({ user_id: userId }),
        "EX",
        3600,
      );
      await redis.sadd(indexKey, liveAccessKey, staleAccessKey);
      await redis.pexpire(indexKey, 30 * 86400 * 1000);

      const service = CliTokenRevocationService.create(redisConnection);
      const result = await service.revokeForUser({ userId });

      // Only the live key counted toward revokedCount; stale DEL returns 0.
      expect(result.revokedCount).toBe(1);
      expect(await redis.exists(liveAccessKey)).toBe(0);
      expect(await redis.exists(indexKey)).toBe(0);
    });
  });

  describe("when redis is undefined (e.g. dev env without Redis)", () => {
    it("returns zero without throwing", async () => {
      const service = CliTokenRevocationService.create(undefined);
      const result = await service.revokeForUser({ userId: "anyone" });
      expect(result.revokedCount).toBe(0);
    });
  });
});
