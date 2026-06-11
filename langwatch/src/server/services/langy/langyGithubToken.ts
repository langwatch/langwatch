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

  const cacheKey = `langy:gh:at:${userId}:${organizationId}`;
  const cached = await redisGet(cacheKey);
  if (cached) {
    return { token: cached, githubLogin: row.githubLogin };
  }

  const lockKey = `langy:gh:refresh:${userId}:${organizationId}`;
  const lockToken = await acquireLock(lockKey);
  try {
    // Re-check the cache: another caller may have refreshed while we waited.
    if (lockToken !== "self-acquired") {
      const fresh = await redisGet(cacheKey);
      if (fresh) {
        return { token: fresh, githubLogin: row.githubLogin };
      }
    }

    let refreshToken: string;
    try {
      refreshToken = decrypt(row.encryptedRefreshToken);
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

    const refreshed = await refreshAtGitHub(refreshToken);
    if (!refreshed) {
      // Refresh failed in a way that indicates the grant is dead (revoked App,
      // user revoked, expired refresh). Delete the row so the next chat tells
      // the user to reconnect, instead of looping on a broken credential.
      await prisma.userGitHubCredential.deleteMany({
        where: { userId, organizationId },
      });
      return null;
    }

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

    await redisSetEx(
      cacheKey,
      Math.min(ACCESS_TOKEN_CACHE_TTL_SEC, Math.max(60, refreshed.expires_in - 60)),
      refreshed.access_token,
    );

    return { token: refreshed.access_token, githubLogin: row.githubLogin };
  } finally {
    if (lockToken && lockToken !== "self-acquired") {
      await releaseLock(lockKey, lockToken);
    }
  }
}

type RefreshedToken = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
};

async function refreshAtGitHub(
  refreshToken: string,
): Promise<RefreshedToken | null> {
  const res = await fetch(GITHUB_TOKEN_URL, {
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
  });
  const body = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (
    !res.ok ||
    body.error ||
    !body.access_token ||
    !body.refresh_token ||
    typeof body.expires_in !== "number"
  ) {
    logger.warn({ status: res.status, error: body.error }, "refresh failed");
    return null;
  }
  return {
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    expires_in: body.expires_in,
  };
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

// Acquire-or-wait. Returns the token to pass to releaseLock, or "self-acquired"
// when Redis is unavailable (we skip locking but the caller still runs).
async function acquireLock(key: string): Promise<string | null> {
  if (!connection) return "self-acquired";
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
      if (ok === "OK") return token;
    } catch {
      return "self-acquired";
    }
    await new Promise((r) => setTimeout(r, LOCK_RETRY_MS));
  }
  // Timed out waiting — proceed anyway; worst case is a wasted refresh.
  logger.warn({ key }, "github refresh lock timeout; proceeding without lock");
  return "self-acquired";
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
