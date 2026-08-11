// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createLogger } from "@langwatch/observability";
import type { Cluster, Redis } from "ioredis";
import { getApp } from "~/server/app-layer/app";

const logger = createLogger("langwatch:cli-token-revocation");

const ACCESS_TOKEN_PREFIX = "lwcli:access:";
const REFRESH_TOKEN_PREFIX = "lwcli:refresh:";

type RedisLike = Redis | Cluster;

/**
 * Force-revoke every CLI device-flow token held by a user.
 *
 * Today, `userService.deactivate` calls `revokeAllSessionsForUser` which
 * clears BetterAuth Postgres + Redis sessions used by the web UI. The CLI
 * device-flow tokens (`lwcli:access:*` + `lwcli:refresh:*`) live in Redis
 * independently of BetterAuth — minted by `/api/auth/cli/exchange`,
 * rotated by `/api/auth/cli/refresh`, validated by every authenticated
 * CLI endpoint. Without this revoker, a deactivated user's existing
 * access_token continues to authenticate against the control plane until
 * the 1h TTL expires, and their refresh_token continues to mint new
 * access tokens for up to the refresh-token idle window (90d by default).
 *
 * Spec: specs/ai-gateway/cli-token-revoke-on-deactivation.feature
 *
 * Mechanism: a per-user index set `lwcli:user:<userId>:tokens` is
 * maintained on every mint + rotate (see `auth-cli.ts`). Revocation
 * SMEMBERS the set, deletes each member key, then deletes the index.
 * Per-key DELs (rather than `redis.del(...keys)`) keep this safe under
 * Redis cluster mode where multi-key ops CROSSSLOT-reject when keys
 * differ in hash slot — the same constraint that drove
 * `auth-cli.ts:347-348`.
 */
export class CliTokenRevocationService {
  constructor(private readonly injectedRedis?: RedisLike | null) {}

  /**
   * Builds the service. Takes a connection when the caller has one; otherwise
   * the App's is resolved when a revocation actually runs, not here —
   * constructing this must stay free, because `UserService` builds one as a
   * default parameter and would otherwise demand an App just to exist.
   */
  static create(redis?: RedisLike | null): CliTokenRevocationService {
    return new CliTokenRevocationService(redis);
  }

  /**
   * The injected connection, else the App's, resolved at the point of use.
   *
   * `getApp`, not `tryGetApp`: revocation is one of the few places where doing
   * less is a wrong answer rather than a degraded success. The `null` branch
   * below is safe only because "this deployment configured no Redis" also means
   * "there are no CLI tokens to revoke" — which is not what "the App is not
   * initialized" means. Collapsing the two would report a successful revocation
   * of nothing and leave live CLI credentials working, the same reasoning that
   * keeps `revokeSessions` on `getApp` (ADR-090).
   *
   * Construction stays App-free regardless, because this getter runs during a
   * revocation rather than at build time.
   */
  private get redis(): RedisLike | undefined {
    return this.injectedRedis ?? getApp().redis ?? void 0;
  }

  static userTokensIndexKey(userId: string): string {
    return `lwcli:user:${userId}:tokens`;
  }

  static accessTokenKey(token: string): string {
    return `${ACCESS_TOKEN_PREFIX}${token}`;
  }

  static refreshTokenKey(token: string): string {
    return `${REFRESH_TOKEN_PREFIX}${token}`;
  }

  async revokeForUser({
    userId,
  }: {
    userId: string;
  }): Promise<{ revokedCount: number }> {
    if (!this.redis) {
      logger.warn(
        { userId },
        "Redis connection is null — skipping CLI token revocation. This is expected in tests that opt out of Redis but a real deployment without Redis would not have CLI tokens to revoke.",
      );
      return { revokedCount: 0 };
    }

    const indexKey = CliTokenRevocationService.userTokensIndexKey(userId);
    const members = await this.redis.smembers(indexKey);
    if (members.length === 0) {
      // No active CLI tokens — common for users who never logged in via the
      // CLI or whose tokens already expired and were evicted by Redis TTL.
      return { revokedCount: 0 };
    }

    let revokedCount = 0;
    for (const memberKey of members) {
      // memberKey is the FULL Redis key (e.g., "lwcli:access:lw_at_AAA"),
      // written by auth-cli.ts at mint/rotate. Per-key DEL is required for
      // cluster safety.
      const deleted = await this.redis.del(memberKey);
      if (deleted > 0) revokedCount += deleted;
    }
    await this.redis.del(indexKey);

    return { revokedCount };
  }
}
