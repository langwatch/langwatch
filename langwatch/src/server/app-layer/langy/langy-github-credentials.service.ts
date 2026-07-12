/**
 * Langy ↔ GitHub per-user connection: mints short-lived user-to-server access
 * tokens for a turn, and owns the connect/disconnect lifecycle of the
 * `UserGitHubCredential` row.
 *
 * The refresh token is the only thing kept at rest (AES-256-GCM in the row);
 * access tokens (~8h) live in Redis with a sub-TTL and never touch disk. GitHub
 * *rotates* the refresh token on every use, so two parallel chats from the same
 * user would race the single-use rotation and brick the credential — we guard
 * the refresh with a short-lived Redis lock and serve a cached access token
 * whenever it's still valid, so the lock is rarely hit.
 *
 * GitHub HTTP lives in the injected {@link GithubOAuthClient}; row access in the
 * injected {@link LangyUserGithubCredentialsRepository}. This service owns the
 * concurrency + cache + crypto that sit between them. Issue #4747.
 *
 * REVAMP TARGET (task #24): still imports module-level `connection` / encryption
 * and defines module-level Redis helpers — these must all become injected
 * dependencies in the ground-up GitHub-flow rewrite.
 */
import { randomBytes } from "crypto";

import { connection } from "~/server/redis";
import { decrypt, encrypt } from "~/utils/encryption";
import { createLogger } from "~/utils/logger/server";

import type { GithubOAuthClient } from "../clients/github/github-oauth.client";
import type { LangyUserGithubCredentialsRepository } from "./repositories/langy-user-github-credentials.repository";

const logger = createLogger("langwatch:langy:github-credentials");

// Cache the minted access token for a hair under its 8h TTL so we don't refresh
// on every chat message. Refresh proactively a few minutes before expiry.
const ACCESS_TOKEN_CACHE_TTL_SEC = 7 * 60 * 60; // 7h
const LOCK_TTL_SEC = 10;
const LOCK_RETRY_MS = 100;
const LOCK_MAX_WAIT_MS = 5_000;

export interface LangyGithubToken {
  token: string;
  githubLogin: string;
}

type LockResult =
  | { kind: "owned"; token: string }
  | { kind: "no-redis" }
  | { kind: "timeout" };

export class LangyGithubCredentialsService {
  constructor(
    private readonly repo: LangyUserGithubCredentialsRepository,
    private readonly oauth: GithubOAuthClient,
    /**
     * Whether the Langy GitHub App is configured on this instance
     * (`GITHUB_LANGY_CLIENT_ID` / `_SECRET`). When false the service short-
     * circuits every read to "not connected" — crucially BEFORE touching the
     * DB or classifying a refresh as a dead grant, so toggling the feature off
     * never deletes a stored credential.
     */
    private readonly configured: boolean,
  ) {}

  /** True when a member of `organizationId`; gates connect/callback. */
  isOrganizationMember(params: {
    userId: string;
    organizationId: string;
  }): Promise<boolean> {
    return this.repo.isOrganizationMember(params);
  }

  findConnection(params: { userId: string; organizationId: string }) {
    return this.repo.findConnection(params);
  }

  /**
   * Persist the connection from a completed OAuth callback: encrypt the refresh
   * token at rest, store login/id/scopes, and clear any cached access token
   * minted under a previous (now-revoked) grant.
   */
  async saveConnection({
    userId,
    organizationId,
    githubLogin,
    githubUserId,
    refreshToken,
    scopes,
  }: {
    userId: string;
    organizationId: string;
    githubLogin: string;
    githubUserId: string;
    refreshToken: string;
    scopes: string | null;
  }): Promise<void> {
    await this.repo.upsert({
      userId,
      organizationId,
      githubLogin,
      githubUserId,
      encryptedRefreshToken: encrypt(refreshToken),
      scopes,
    });
    await this.clearAccessTokenCache({ userId, organizationId });
  }

  /**
   * Disconnect: drop the stored credential and the cached access token (the
   * token was just revoked at GitHub — serving it for up to 7h would hand
   * workers a dead credential).
   */
  async deleteConnection({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<number> {
    const count = await this.repo.deleteByUserOrg({ userId, organizationId });
    await this.clearAccessTokenCache({ userId, organizationId });
    return count;
  }

  /**
   * Complete an OAuth callback: exchange the code for tokens, resolve the
   * GitHub user, and persist the connection. Returns the connected login.
   */
  async completeOAuthConnection({
    code,
    redirectUri,
    userId,
    organizationId,
  }: {
    code: string;
    redirectUri: string;
    userId: string;
    organizationId: string;
  }): Promise<{ githubLogin: string }> {
    const tokens = await this.oauth.exchangeCode({ code, redirectUri });
    const user = await this.oauth.fetchUser(tokens.accessToken);
    await this.saveConnection({
      userId,
      organizationId,
      githubLogin: user.login,
      githubUserId: String(user.id),
      refreshToken: tokens.refreshToken,
      scopes: tokens.scope ?? null,
    });
    return { githubLogin: user.login };
  }

  /**
   * Disconnect flow: revoke the App's grant at GitHub FIRST (needs a live
   * access token minted from the stored refresh token), then delete the local
   * row + cache. If revoke succeeds but delete fails the user reconnects and we
   * re-create the row — safe. The opposite order would delete the refresh token
   * before we could use it for the revoke.
   */
  async revokeAndDeleteConnection({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<number> {
    const minted = await this.getAccessToken({ userId, organizationId });
    if (minted) await this.oauth.revokeGrant(minted.token);
    return this.deleteConnection({ userId, organizationId });
  }

  /**
   * Register an OAuth-state nonce so the callback can mark it consumed. Returns
   * `true` if Redis is wired (the nonce is authoritative); `false` when Redis
   * is unavailable (caller skips the nonce check and leans on the signature +
   * session-rebind defenses).
   */
  registerOauthNonce(nonce: string, ttlSec: number): Promise<boolean> {
    return registerOauthNonce(nonce, ttlSec);
  }

  /**
   * Atomically consume a registered nonce. Returns `true` if present and
   * consumed, `false` if missing (already used / never issued), or `null` when
   * Redis is unavailable (caller skips the check).
   */
  consumeOauthNonce(nonce: string): Promise<boolean | null> {
    return consumeOauthNonce(nonce);
  }

  /**
   * Returns a live GitHub access token for `(user, org)`, or null when GitHub
   * is not configured, the user has not connected, or the refresh failed.
   * Best-effort by design: callers never block chat on it.
   */
  async getAccessToken({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<LangyGithubToken | null> {
    if (!this.configured) return null;

    const row = await this.repo.findCredential({ userId, organizationId });
    if (!row) return null;

    const cacheKey = accessTokenCacheKey(userId, organizationId);
    const cached = await redisGet(cacheKey);
    if (cached) return { token: cached, githubLogin: row.githubLogin };

    const refreshed = await this.refreshAccessTokenUnderLock({
      userId,
      organizationId,
      cacheKey,
    });
    if (!refreshed) return null;
    return { token: refreshed, githubLogin: row.githubLogin };
  }

  // Acquires the per-user refresh lock, re-reads the credential row, drives the
  // single-use refresh rotation through GitHub, persists the rotated refresh
  // token, caches the new access token, and returns it.
  private async refreshAccessTokenUnderLock({
    userId,
    organizationId,
    cacheKey,
  }: {
    userId: string;
    organizationId: string;
    cacheKey: string;
  }): Promise<string | null> {
    const lockKey = `langy:gh:refresh:${userId}:${organizationId}`;
    const lockResult = await acquireLock(lockKey);
    try {
      // Re-check the cache after the lock dance — another caller may have
      // refreshed while we waited. ALWAYS re-check regardless of lock state.
      const fresh = await redisGet(cacheKey);
      if (fresh) return fresh;
      if (lockResult.kind === "timeout") {
        // Another caller is mid-refresh and hasn't surfaced a cached token in
        // 5s. Racing the rotation would brick the credential (single-use
        // refresh token). Give up cleanly — the user retries.
        logger.warn(
          { userId, organizationId },
          "github refresh lock timeout — yielding to other caller",
        );
        return null;
      }
      if (lockResult.kind === "no-redis") {
        // Fail closed when we have no distributed lock to serialise rotations.
        // The refresh token is single-use: with N concurrent callers and no
        // lock, N-1 lose and would each delete the healthy row the winner
        // stored. Chat tolerates a missing GitHub token, so null is least-bad.
        logger.warn(
          { userId, organizationId },
          "github refresh: redis lock unavailable; failing closed instead of racing",
        );
        return null;
      }

      // Re-read the row INSIDE the lock. The pre-lock read can be stale when a
      // peer rotated the refresh token but its best-effort cache write failed.
      const lockedRow = await this.repo.findCredential({
        userId,
        organizationId,
      });
      if (!lockedRow) return null;

      let refreshToken: string;
      try {
        refreshToken = decrypt(lockedRow.encryptedRefreshToken);
      } catch (err) {
        logger.warn(
          { err, userId, organizationId },
          "github refresh token decrypt failed; deleting row",
        );
        await this.repo.deleteByUserOrg({ userId, organizationId });
        return null;
      }

      const outcome = await this.oauth.refreshToken(refreshToken);
      if (!outcome.ok) {
        if (outcome.grantDead) {
          // Definitively dead (bad_refresh_token / 401). Delete so the next
          // chat tells the user to reconnect instead of looping.
          await this.repo.deleteByUserOrg({ userId, organizationId });
        }
        // Transient (GitHub 5xx / rate limit / network) — keep the row.
        return null;
      }

      // Persist the rotated refresh token. Accepts a tiny window: a crash
      // between GitHub returning the new token and this write forces a
      // reconnect. The lock keeps us off the race; nothing else can.
      await this.repo.updateRefreshToken({
        userId,
        organizationId,
        encryptedRefreshToken: encrypt(outcome.tokens.refreshToken),
      });

      // Cache a hair under expires_in. Cap tiny TTLs so we never serve a token
      // about to expire from a stale cache entry.
      const expiresIn = outcome.tokens.expiresIn;
      const cacheTtl =
        expiresIn < 120
          ? Math.min(60, Math.max(15, expiresIn - 30))
          : Math.min(ACCESS_TOKEN_CACHE_TTL_SEC, expiresIn - 60);
      await redisSetEx(cacheKey, cacheTtl, outcome.tokens.accessToken);
      return outcome.tokens.accessToken;
    } finally {
      if (lockResult.kind === "owned") {
        await releaseLock(lockKey, lockResult.token);
      }
    }
  }

  private clearAccessTokenCache({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<void> {
    return redisDel(accessTokenCacheKey(userId, organizationId));
  }
}

function accessTokenCacheKey(userId: string, organizationId: string): string {
  return `langy:gh:at:${userId}:${organizationId}`;
}

// ---------- Redis helpers (no-op when unavailable) ----------

async function redisGet(key: string): Promise<string | null> {
  if (!connection) return null;
  try {
    return await (
      connection as { get: (k: string) => Promise<string | null> }
    ).get(key);
  } catch {
    return null;
  }
}

async function redisSetEx(
  key: string,
  ttlSec: number,
  value: string,
): Promise<void> {
  if (!connection) return;
  try {
    await (
      connection as {
        set: (k: string, v: string, mode: string, ttl: number) => Promise<string>;
      }
    ).set(key, value, "EX", ttlSec);
  } catch {
    /* best-effort cache */
  }
}

async function redisDel(key: string): Promise<void> {
  if (!connection) return;
  try {
    await (connection as { del: (k: string) => Promise<number> }).del(key);
  } catch {
    /* best-effort — the cache TTL bounds the damage if Redis hiccups */
  }
}

async function registerOauthNonce(
  nonce: string,
  ttlSec: number,
): Promise<boolean> {
  if (!connection) return false;
  try {
    await (
      connection as {
        set: (k: string, v: string, mode: string, ttl: number) => Promise<string>;
      }
    ).set(`langy:gh:nonce:${nonce}`, "1", "EX", ttlSec);
    return true;
  } catch {
    return false;
  }
}

async function consumeOauthNonce(nonce: string): Promise<boolean | null> {
  if (!connection) return null;
  try {
    const conn = connection as {
      getdel?: (k: string) => Promise<string | null>;
      eval?: (
        script: string,
        numKeys: number,
        ...args: string[]
      ) => Promise<number | string | null>;
      get: (k: string) => Promise<string | null>;
      del: (k: string) => Promise<number>;
    };
    const key = `langy:gh:nonce:${nonce}`;
    if (typeof conn.getdel === "function") {
      const v = await conn.getdel(key);
      return v !== null;
    }
    // Pre-6.2 fallback: a get+del sequence allows replay. Use a Lua script so
    // the consume is atomic: 1 if it deleted, 0 if the key was missing.
    if (typeof conn.eval === "function") {
      const script =
        "local v = redis.call('GET', KEYS[1])\n" +
        "if v then redis.call('DEL', KEYS[1]) return 1 else return 0 end";
      const result = await conn.eval(script, 1, key);
      return result === 1 || result === "1";
    }
    const v = await conn.get(key);
    if (v === null) return false;
    await conn.del(key);
    return true;
  } catch {
    return null;
  }
}

// Acquire-or-wait. Distinguishes the three outcomes so the caller can decide
// what to do (fail closed when there's no Redis at all, yield when a peer is
// mid-refresh).
async function acquireLock(key: string): Promise<LockResult> {
  if (!connection) return { kind: "no-redis" };
  const token = randomBytes(16).toString("hex");
  const deadline = Date.now() + LOCK_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      const ok = await (
        connection as unknown as {
          set: (
            k: string,
            v: string,
            modeNx: string,
            modeEx: string,
            ttl: number,
          ) => Promise<string | null>;
        }
      ).set(key, token, "NX", "EX", LOCK_TTL_SEC);
      if (ok === "OK") return { kind: "owned", token };
    } catch {
      return { kind: "no-redis" };
    }
    await new Promise((r) => setTimeout(r, LOCK_RETRY_MS));
  }
  return { kind: "timeout" };
}

async function releaseLock(key: string, token: string): Promise<void> {
  if (!connection) return;
  try {
    // Atomic compare-and-delete via Lua so a concurrent holder's lock can't be
    // dropped during an expiry race.
    const conn = connection as {
      eval?: (
        script: string,
        numKeys: number,
        ...args: string[]
      ) => Promise<number | string | null>;
      get: (k: string) => Promise<string | null>;
      del: (k: string) => Promise<number>;
    };
    if (typeof conn.eval === "function") {
      const script =
        "if redis.call('GET', KEYS[1]) == ARGV[1] then " +
        "return redis.call('DEL', KEYS[1]) else return 0 end";
      await conn.eval(script, 1, key, token);
      return;
    }
    const current = await conn.get(key);
    if (current === token) await conn.del(key);
  } catch {
    /* lock will expire on its own */
  }
}
