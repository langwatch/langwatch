/**
 * Mints a short-lived GitHub user-to-server access token for the requesting
 * user, riding the existing Langy credential handoff. The refresh token is the
 * only thing we keep at rest (AES-256-GCM in UserGitHubCredential); access
 * tokens (8h) live in Redis with a sub-TTL and never touch disk.
 *
 * Concurrency: GitHub *rotates* the refresh token on every use. Two parallel
 * chats from the same user would race the single-use rotation and brick the
 * credential. We guard the refresh with a short-lived Redis lock and serve a
 * cached access token whenever it's still valid, so the lock is rarely hit.
 *
 * Spec: specs/assistant/langy-github-prs.feature. Issue: #4747.
 */
import type { PrismaClient } from "@prisma/client";

import { env } from "~/env.mjs";
import { connection } from "~/server/redis";
import { decrypt, encrypt } from "~/utils/encryption";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:langy:github-token");

const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";

// Cache the minted access token for a hair under its 8h TTL so we don't refresh
// on every chat message. Refresh proactively a few minutes before expiry.
const ACCESS_TOKEN_CACHE_TTL_SEC = 7 * 60 * 60; // 7h
const LOCK_TTL_SEC = 10;
const LOCK_RETRY_MS = 100;
const LOCK_MAX_WAIT_MS = 5_000;

export type LangyGithubToken = {
  token: string;
  githubLogin: string;
};

function accessTokenCacheKey(userId: string, organizationId: string): string {
  return `langy:gh:at:${userId}:${organizationId}`;
}

/**
 * Drop the cached access token for (user, org). MUST be called on disconnect
 * (the token was just revoked at GitHub — serving it from cache for up to 7h
 * would hand workers a dead credential) and on (re)connect (the cache may
 * hold a token minted under the previous, now-revoked grant).
 */
export async function clearGithubTokenCache({
  userId,
  organizationId,
}: {
  userId: string;
  organizationId: string;
}): Promise<void> {
  if (!connection) return;
  try {
    await (connection as { del: (k: string) => Promise<number> }).del(
      accessTokenCacheKey(userId, organizationId),
    );
  } catch {
    /* best-effort — the cache TTL bounds the damage if Redis hiccups */
  }
}

export async function getGithubTokenForUser({
  prisma,
  userId,
  organizationId,
}: {
  prisma: PrismaClient;
  userId: string;
  organizationId: string;
}): Promise<LangyGithubToken | null> {
  if (!env.GITHUB_LANGY_CLIENT_ID || !env.GITHUB_LANGY_CLIENT_SECRET) {
    return null; // feature off on this instance
  }

  const row = await prisma.userGitHubCredential.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
    select: { encryptedRefreshToken: true, githubLogin: true },
  });
  if (!row) return null;

  const cacheKey = accessTokenCacheKey(userId, organizationId);
  const cached = await redisGet(cacheKey);
  if (cached) {
    return { token: cached, githubLogin: row.githubLogin };
  }

  const lockKey = `langy:gh:refresh:${userId}:${organizationId}`;
  const lockResult = await acquireLock(lockKey);
  try {
    // Re-check the cache after the lock dance — another caller may have
    // refreshed while we waited. ALWAYS re-check (regardless of lock state):
    //  - lock acquired: we held the lock; another caller already finished.
    //  - lock timed out: another caller is still running; their write may
    //    have just landed in the cache.
    //  - no redis: the redisGet returns null anyway, so the re-check is free.
    const fresh = await redisGet(cacheKey);
    if (fresh) {
      return { token: fresh, githubLogin: row.githubLogin };
    }
    if (lockResult.kind === "timeout") {
      // Another caller is mid-refresh and hasn't surfaced a cached token in
      // 5s. Racing the rotation would brick the credential (single-use refresh
      // token). Give up cleanly — the user retries; one slow chat is better
      // than a bricked credential.
      logger.warn(
        { userId, organizationId },
        "github refresh lock timeout — yielding to other caller",
      );
      return null;
    }

    // Re-read the row INSIDE the lock. The pre-lock read can be stale when a
    // peer rotated the refresh token but its best-effort cache write failed —
    // refreshing with the burned token would look like a dead grant and
    // delete a perfectly healthy credential.
    const lockedRow = await prisma.userGitHubCredential.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      select: { encryptedRefreshToken: true, githubLogin: true },
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
      await prisma.userGitHubCredential.deleteMany({
        where: { userId, organizationId },
      });
      return null;
    }

    const refreshOutcome = await refreshAtGitHub(refreshToken);
    if (!refreshOutcome.ok) {
      if (refreshOutcome.grantDead) {
        // The grant is definitively dead (bad_refresh_token / 401 — revoked
        // App, user revoked, expired refresh). Delete the row so the next
        // chat tells the user to reconnect, instead of looping on a broken
        // credential.
        await prisma.userGitHubCredential.deleteMany({
          where: { userId, organizationId },
        });
      }
      // Transient failure (GitHub 5xx, rate limit, network) — keep the row
      // and let the user retry. Deleting here would turn a GitHub blip into
      // a forced re-OAuth for every connected user.
      return null;
    }
    const refreshed = refreshOutcome.token;

    // Persist the rotated refresh token in the same transaction window. We
    // accept a tiny vulnerability: if the process crashes between GitHub
    // returning the new refresh token and us writing it, the user has to
    // reconnect. The lock keeps us off the race; nothing else can.
    await prisma.userGitHubCredential.update({
      where: { userId_organizationId: { userId, organizationId } },
      data: {
        encryptedRefreshToken: encrypt(refreshed.refresh_token),
      },
    });

    // Cache a hair under expires_in. If GitHub returns a surprisingly small
    // expires_in (<120s), cap the cache at 60s so we don't serve a token that's
    // about to expire from a stale cache entry.
    const cacheTtl =
      refreshed.expires_in < 120
        ? Math.min(60, Math.max(15, refreshed.expires_in - 30))
        : Math.min(ACCESS_TOKEN_CACHE_TTL_SEC, refreshed.expires_in - 60);
    await redisSetEx(cacheKey, cacheTtl, refreshed.access_token);

    return { token: refreshed.access_token, githubLogin: row.githubLogin };
  } finally {
    if (lockResult.kind === "owned") {
      await releaseLock(lockKey, lockResult.token);
    }
  }
}

type LockResult =
  | { kind: "owned"; token: string }
  | { kind: "no-redis" }
  | { kind: "timeout" };

type RefreshedToken = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
};

type RefreshOutcome =
  | { ok: true; token: RefreshedToken }
  /**
   * grantDead distinguishes "this credential will never work again" (delete
   * the row, surface the connect card) from a transient failure (GitHub
   * 5xx / rate limit / network — keep the row, user retries).
   */
  | { ok: false; grantDead: boolean };

// Bounded under the Redis lock TTL (10s) so a slow GitHub call can't outlive
// the lock and let a second caller race the single-use rotation.
const REFRESH_FETCH_TIMEOUT_MS = (LOCK_TTL_SEC - 2) * 1000;

async function refreshAtGitHub(
  refreshToken: string,
): Promise<RefreshOutcome> {
  let res: Response;
  let body: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
  };
  try {
    res = await fetch(GITHUB_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: env.GITHUB_LANGY_CLIENT_ID!,
        client_secret: env.GITHUB_LANGY_CLIENT_SECRET!,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
      signal: AbortSignal.timeout(REFRESH_FETCH_TIMEOUT_MS),
    });
    body = (await res.json()) as typeof body;
  } catch (err) {
    logger.warn({ err }, "refresh failed (network/timeout) — keeping row");
    return { ok: false, grantDead: false };
  }
  if (
    res.ok &&
    !body.error &&
    body.access_token &&
    body.refresh_token &&
    typeof body.expires_in === "number"
  ) {
    return {
      ok: true,
      token: {
        access_token: body.access_token,
        refresh_token: body.refresh_token,
        expires_in: body.expires_in,
      },
    };
  }
  // GitHub's OAuth token endpoint reports grant errors as a JSON `error`
  // field (often with HTTP 200). Anything 5xx — or a response with no error
  // field at all — is treated as transient.
  const grantDead = res.status < 500 && Boolean(body.error);
  logger.warn(
    { status: res.status, error: body.error, grantDead },
    "refresh failed",
  );
  return { ok: false, grantDead };
}

// ---------- Redis helpers (no-op when unavailable) ----------

async function redisGet(key: string): Promise<string | null> {
  if (!connection) return null;
  try {
    return await (connection as { get: (k: string) => Promise<string | null> }).get(
      key,
    );
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

// Acquire-or-wait. Distinguishes the three outcomes so the caller can decide
// what to do (race the rotation when there's no Redis at all, yield when a
// peer is mid-refresh).
async function acquireLock(key: string): Promise<LockResult> {
  if (!connection) return { kind: "no-redis" };
  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const deadline = Date.now() + LOCK_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      const ok = await (
        connection as {
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
      // Redis went away mid-wait; treat as no-redis so the caller still tries
      // (it has nothing to lose — caches are gone too).
      return { kind: "no-redis" };
    }
    await new Promise((r) => setTimeout(r, LOCK_RETRY_MS));
  }
  return { kind: "timeout" };
}

/**
 * Register a OAuth-state nonce so the callback can mark it consumed. Returns
 * `true` if Redis is wired (caller should treat the nonce as authoritative);
 * `false` when Redis is unavailable (caller should skip the nonce check —
 * we fall back to the signature + session-rebind defenses).
 */
export async function registerGithubOauthNonce(
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

/**
 * Atomically consume a registered nonce. Returns `true` if the nonce was
 * present and consumed, `false` if it was missing (already used or never
 * issued), or `null` when Redis is unavailable (caller skips the check).
 */
export async function consumeGithubOauthNonce(
  nonce: string,
): Promise<boolean | null> {
  if (!connection) return null;
  try {
    // GETDEL is atomic on Redis ≥6.2. Fall back to a get+del transaction-ish
    // sequence if the client doesn't support it.
    const conn = connection as {
      getdel?: (k: string) => Promise<string | null>;
      get: (k: string) => Promise<string | null>;
      del: (k: string) => Promise<number>;
    };
    const key = `langy:gh:nonce:${nonce}`;
    if (typeof conn.getdel === "function") {
      const v = await conn.getdel(key);
      return v !== null;
    }
    const v = await conn.get(key);
    if (v === null) return false;
    await conn.del(key);
    return true;
  } catch {
    return null;
  }
}

async function releaseLock(key: string, token: string): Promise<void> {
  if (!connection) return;
  try {
    const current = await (
      connection as { get: (k: string) => Promise<string | null> }
    ).get(key);
    if (current === token) {
      await (connection as { del: (k: string) => Promise<number> }).del(key);
    }
  } catch {
    /* lock will expire on its own */
  }
}
