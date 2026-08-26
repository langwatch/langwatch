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
import type { Redis } from "ioredis";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RedisCliTokenStoreAdapter } from "@langwatch/enterprise-api/governance/cli-token-revocation.adapter";
import { DefaultGovernanceCliTokenRevocationService } from "@langwatch/enterprise-governance-server";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";

/** The container's connection, handed to the test App the service defaults to. */
let redisConnection: Redis | null = null;

function tokenRevocationService(redis = redisConnection) {
  return DefaultGovernanceCliTokenRevocationService.create({
    store: redis ? new RedisCliTokenStoreAdapter(redis) : undefined,
  });
}

describe("DefaultGovernanceCliTokenRevocationService.revokeForUser", () => {
  const ns = nanoid(8);

  beforeAll(async () => {
    ({ redisConnection } = await startTestContainers());
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
    const accessKey =
      DefaultGovernanceCliTokenRevocationService.accessTokenKey(accessToken);
    const refreshKey =
      DefaultGovernanceCliTokenRevocationService.refreshTokenKey(refreshToken);
    const indexKey =
      DefaultGovernanceCliTokenRevocationService.userTokensIndexKey(userId);

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

    /*
     * Proves the precondition for the e2e behavior: revokeForUser DELs
     * the refresh_token key from Redis. /api/auth/cli/refresh returns
     * 401 invalid_grant when redis.get(refreshTokenKey(token)) yields
     * null (auth-cli.ts:586-595) — so a revoked refresh_token cannot
     * mint a new access pair. Composition of this test + the route's
     * structural 401-on-missing branch covers the e2e scenario.
     * Spec: specs/ai-gateway/cli-token-revoke-on-deactivation.feature:79.
     */
    /** @scenario After deactivation, /refresh returns 401 for the revoked refresh_token */
    it("deletes both token keys and the per-user index", async () => {
      const service = tokenRevocationService();
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
      const service = tokenRevocationService();

      const result = await service.revokeForUser({ userId });

      expect(result.revokedCount).toBe(0);
      const indexKey =
        DefaultGovernanceCliTokenRevocationService.userTokensIndexKey(userId);
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
        DefaultGovernanceCliTokenRevocationService.accessTokenKey(liveAccessToken);
      const staleAccessKey =
        DefaultGovernanceCliTokenRevocationService.accessTokenKey(staleAccessToken);
      const indexKey =
        DefaultGovernanceCliTokenRevocationService.userTokensIndexKey(userId);

      // Live token + stale entry in the index but no underlying key.
      await redis.set(liveAccessKey, JSON.stringify({ user_id: userId }), "EX", 3600);
      await redis.sadd(indexKey, liveAccessKey, staleAccessKey);
      await redis.pexpire(indexKey, 30 * 86400 * 1000);

      const service = tokenRevocationService();
      const result = await service.revokeForUser({ userId });

      // Only the live key counted toward revokedCount; stale DEL returns 0.
      expect(result.revokedCount).toBe(1);
      expect(await redis.exists(liveAccessKey)).toBe(0);
      expect(await redis.exists(indexKey)).toBe(0);
    });
  });

  describe("when redis is undefined (e.g. dev env without Redis)", () => {
    it("returns zero without throwing", async () => {
      const service = tokenRevocationService(undefined);
      const result = await service.revokeForUser({ userId: "anyone" });
      expect(result.revokedCount).toBe(0);
    });
  });
});
