/**
 * @vitest-environment node
 *
 * CliTokenRevocationService — the defense-in-depth that ensures a
 * deactivated user's CLI device-flow tokens stop authenticating immediately
 * rather than waiting up to the 1h access / 30d refresh TTL to expire.
 *
 * The store is a port now (`CliTokenStorePort`), so this drives the service
 * against an in-memory fake rather than real Redis — the key shapes and the
 * "delete every member of the per-user index" behaviour are what is under
 * test, not the transport.
 *
 * Spec: specs/ai-gateway/cli-token-revoke-on-deactivation.feature
 */
import { describe, expect, it } from "vitest";
import { CliTokenStorePort } from "../../ports/cli-token-store.port";
import { DefaultGovernanceCliTokenRevocationService } from "../cli-token-revocation.service";

class InMemoryCliTokenStore extends CliTokenStorePort {
  private readonly values = new Map<string, string>();
  private readonly sets = new Map<string, Set<string>>();

  set(key: string, value: string): void {
    this.values.set(key, value);
  }

  sadd(setKey: string, ...members: string[]): void {
    const set = this.sets.get(setKey) ?? new Set<string>();
    for (const member of members) set.add(member);
    this.sets.set(setKey, set);
  }

  async members(key: string): Promise<string[]> {
    return [...(this.sets.get(key) ?? [])];
  }

  async tryGet(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async delete(key: string): Promise<number> {
    const existedAsValue = this.values.delete(key);
    const existedAsSet = this.sets.delete(key);
    return existedAsValue || existedAsSet ? 1 : 0;
  }

  async removeMembers(key: string, members: string[]): Promise<number> {
    const set = this.sets.get(key);
    if (!set) return 0;
    let removed = 0;
    for (const member of members) {
      if (set.delete(member)) removed++;
    }
    return removed;
  }

  has(key: string): boolean {
    return this.values.has(key) || this.sets.has(key);
  }
}

describe("CliTokenRevocationService.revokeForUser", () => {
  describe("when the user has active access + refresh tokens", () => {
    /*
     * Proves the precondition for the e2e behavior: revokeForUser deletes
     * the refresh_token key from the store. /api/auth/cli/refresh returns
     * 401 invalid_grant when a lookup on refreshTokenKey(token) yields
     * null — so a revoked refresh_token cannot mint a new access pair.
     * Composition of this test + the route's structural 401-on-missing
     * branch covers the e2e scenario.
     * Spec: specs/ai-gateway/cli-token-revoke-on-deactivation.feature:79.
     */
    /** @scenario After deactivation, /refresh returns 401 for the revoked refresh_token */
    it("deletes both token keys and the per-user index", async () => {
      const userId = "usr-revoke-active";
      const accessToken = "lw_at_active";
      const refreshToken = "lw_rt_active";
      const accessKey = DefaultGovernanceCliTokenRevocationService.accessTokenKey(accessToken);
      const refreshKey = DefaultGovernanceCliTokenRevocationService.refreshTokenKey(refreshToken);
      const indexKey = DefaultGovernanceCliTokenRevocationService.userTokensIndexKey(userId);

      const store = new InMemoryCliTokenStore();
      store.set(accessKey, JSON.stringify({ user_id: userId }));
      store.set(refreshKey, JSON.stringify({ user_id: userId }));
      store.sadd(indexKey, accessKey, refreshKey);

      const service = DefaultGovernanceCliTokenRevocationService.create({ store });
      const result = await service.revokeForUser({ userId });

      expect(result.revokedCount).toBe(2);
      expect(store.has(accessKey)).toBe(false);
      expect(store.has(refreshKey)).toBe(false);
      expect(store.has(indexKey)).toBe(false);
    });
  });

  describe("when the user has never logged in via the CLI", () => {
    it("returns zero and touches no keys", async () => {
      const userId = "usr-revoke-noop";
      const store = new InMemoryCliTokenStore();
      const service = DefaultGovernanceCliTokenRevocationService.create({ store });

      const result = await service.revokeForUser({ userId });

      expect(result.revokedCount).toBe(0);
      const indexKey = DefaultGovernanceCliTokenRevocationService.userTokensIndexKey(userId);
      expect(store.has(indexKey)).toBe(false);
    });
  });

  describe("when the index lists a token whose key has already TTL-expired", () => {
    it("treats the missing key as a no-op and still cleans up the index", async () => {
      const userId = "usr-revoke-stale";
      const liveAccessToken = "lw_at_live";
      const staleAccessToken = "lw_at_stale";
      const liveAccessKey =
        DefaultGovernanceCliTokenRevocationService.accessTokenKey(liveAccessToken);
      const staleAccessKey =
        DefaultGovernanceCliTokenRevocationService.accessTokenKey(staleAccessToken);
      const indexKey = DefaultGovernanceCliTokenRevocationService.userTokensIndexKey(userId);

      const store = new InMemoryCliTokenStore();
      // Live token + stale entry in the index but no underlying key.
      store.set(liveAccessKey, JSON.stringify({ user_id: userId }));
      store.sadd(indexKey, liveAccessKey, staleAccessKey);

      const service = DefaultGovernanceCliTokenRevocationService.create({ store });
      const result = await service.revokeForUser({ userId });

      // Only the live key counted toward revokedCount; stale delete returns 0.
      expect(result.revokedCount).toBe(1);
      expect(store.has(liveAccessKey)).toBe(false);
      expect(store.has(indexKey)).toBe(false);
    });
  });

  describe("when the token store is unavailable (e.g. dev env without Redis)", () => {
    it("returns zero without throwing", async () => {
      const service = DefaultGovernanceCliTokenRevocationService.create({});
      const result = await service.revokeForUser({ userId: "anyone" });
      expect(result.revokedCount).toBe(0);
    });
  });
});
