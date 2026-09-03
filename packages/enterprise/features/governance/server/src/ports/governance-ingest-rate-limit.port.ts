// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The per-caller throttle the Activity Monitor's receivers shed scanners with.
 *
 * It sits between the cheap header regex and the expensive secret lookup, so a
 * brute-force scan for a valid `lw_is_*` secret cannot pin the database. That
 * position is the whole point: moving it after the lookup would make the
 * throttle protect nothing it is there to protect.
 *
 * OPEN-FAIL is the contract, not an accident of one implementation. Ingest
 * availability beats brute-force protection — a receiver that refuses because
 * its counter is unreachable drops a customer's telemetry for an outage of
 * ours — and the secret check still runs on every request either way. A
 * deployment that composes no counter at all leaves the port off and every
 * request passes, which is the same answer.
 */
export abstract class GovernanceIngestRateLimitPort {
  /**
   * Whether this caller may proceed, and how long to wait when not.
   *
   * `retryAfterSec` is what the receiver puts on `Retry-After`, so it must be
   * the remaining window rather than the whole one.
   */
  abstract check(input: {
    ip: string;
  }): Promise<Readonly<{ allowed: boolean; retryAfterSec: number }>>;
}

/**
 * Best-effort caller-IP extraction from the request's headers.
 *
 * The forwarded chain first, because the deployments this throttle matters on
 * sit behind a load balancer; the vendor header second. Falls back to
 * `unknown` rather than to nothing, so a proxy that forwards neither still
 * meters — as one bucket, which is the honest reading of "we cannot tell these
 * callers apart".
 */
export function extractIngestClientIp(headers: Headers): string {
  // RFC 7239 supersedes it, but X-Forwarded-For is what is universally set.
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    // The first entry is the client; the rest are intermediate proxies.
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}

/** The window this throttle counts in, in seconds. */
export const INGEST_RATE_LIMIT_WINDOW_SECONDS = 60;
/** How many requests one caller may make inside a window. */
export const INGEST_RATE_LIMIT_MAX_REQUESTS = 60;
