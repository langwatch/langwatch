/**
 * Per-IP fixed-window rate limit for the governance ingest receivers
 * (`/api/ingest/*`). Wedged between the cheap header regex and the
 * expensive Postgres findFirst on the bearer token so brute-force
 * scanners can't pin the DB looking for a valid `lw_is_*` secret.
 *
 * Mechanism: Redis INCR with EXPIRE on the first hit. The first
 * request in a window writes `lwingest:rate:<ip>` with TTL = windowSec
 * and value=1. Subsequent hits within the window INCR the existing
 * key without touching TTL — so the window is anchored to the first
 * request, not the most recent (fixed-window, not sliding).
 *
 * Open-fail: when Redis is unavailable the middleware logs a warning
 * and ALLOWS the request through. Ingest availability beats
 * brute-force protection — the regex+DB auth path still runs.
 *
 * Spec: specs/ai-gateway/governance/receiver-auth-rate-limit.feature
 */
import type { Cluster, Redis } from "ioredis";

import { connection as defaultRedisConnection } from "~/server/redis";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:ingest:rate-limit");

const RATE_LIMIT_PREFIX = "lwingest:rate:";

export const DEFAULT_WINDOW_SEC = 60;
export const DEFAULT_MAX_REQUESTS = 60;

type RedisLike = Redis | Cluster;

export interface RateLimitDecision {
  allowed: boolean;
  /** When `allowed === false`, seconds until the caller should retry. */
  retryAfterSec: number;
  /** Current count for this window after this request. */
  count: number;
}

export function ipRateLimitKey(ip: string): string {
  return `${RATE_LIMIT_PREFIX}${ip}`;
}

export function isRateLimitDisabled(): boolean {
  // Tests + dev set this so the volume regression scenario can fire
  // batched requests without tripping the limit.
  return process.env.LW_INGEST_RATE_LIMIT_DISABLED === "1";
}

/**
 * Check + increment the per-IP rate-limit counter.
 *
 * Returns `{ allowed: true, ... }` when the request is under the
 * threshold; `{ allowed: false, retryAfterSec, ... }` when it should
 * be 429'd. Open-fails to allowed when Redis is unavailable.
 */
export async function checkIpRateLimit({
  ip,
  windowSec = DEFAULT_WINDOW_SEC,
  maxRequests = DEFAULT_MAX_REQUESTS,
  redis,
}: {
  ip: string;
  windowSec?: number;
  maxRequests?: number;
  /**
   * Explicitly pass `null` to test the open-fail path; omit to use the
   * default (production) Redis connection. Default parameters can't
   * distinguish between "not passed" and "passed undefined" in JS, so
   * the explicit-null sentinel is the cleanest way for tests to opt
   * out of the default.
   */
  redis?: RedisLike | null;
}): Promise<RateLimitDecision> {
  if (isRateLimitDisabled()) {
    return { allowed: true, retryAfterSec: 0, count: 0 };
  }
  const effectiveRedis = redis === undefined ? defaultRedisConnection : redis;
  if (!effectiveRedis) {
    logger.warn(
      { ip },
      "ingest rate-limit: Redis connection unavailable — open-failing (allowing request through)",
    );
    return { allowed: true, retryAfterSec: 0, count: 0 };
  }

  const key = ipRateLimitKey(ip);
  try {
    // INCR returns the new value. If the key didn't exist, it's
    // created at 0 and incremented to 1 — but without a TTL. We need
    // to set TTL on the first hit so the window actually expires.
    const count = await effectiveRedis.incr(key);
    if (count === 1) {
      await effectiveRedis.expire(key, windowSec);
    }

    if (count > maxRequests) {
      // Get TTL so the caller can populate Retry-After.
      const ttl = await effectiveRedis.ttl(key);
      // ttl can be -1 (no expire) or -2 (no key) on edge cases; clamp.
      const retryAfterSec = ttl > 0 ? ttl : windowSec;
      return { allowed: false, retryAfterSec, count };
    }

    return { allowed: true, retryAfterSec: 0, count };
  } catch (err) {
    // Open-fail on any Redis error.
    logger.warn(
      {
        ip,
        error: err instanceof Error ? err.message : String(err),
      },
      "ingest rate-limit: Redis op failed — open-failing (allowing request through)",
    );
    return { allowed: true, retryAfterSec: 0, count: 0 };
  }
}

/**
 * Best-effort caller-IP extraction from a Hono context. Falls back to
 * `unknown` so the rate-limiter still works behind a proxy that
 * doesn't strip / forward correctly. In practice langwatch SaaS
 * deploys behind a load balancer that sets `X-Forwarded-For`; for
 * self-hosted, raw `c.req.raw` may have the socket address.
 */
export function extractClientIp(headers: Headers): string {
  // Standard reverse-proxy header (RFC 7239 supersedes this but
  // X-Forwarded-For is universally honored).
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    // First IP in the comma-separated list is the client; subsequent
    // entries are intermediate proxies.
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}
