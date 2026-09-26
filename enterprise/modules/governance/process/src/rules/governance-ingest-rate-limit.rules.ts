// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** The window the ingest throttle counts in, in seconds. */
export const INGEST_RATE_LIMIT_WINDOW_SECONDS = 60;
/** How many requests one caller may make inside a window. */
export const INGEST_RATE_LIMIT_MAX_REQUESTS = 60;

/**
 * The caller's IP: the forwarded chain's first entry, then the vendor header,
 * else `unknown`, so callers a proxy cannot tell apart meter as one bucket.
 */
export function extractClientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first;
  const realIp = headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}
