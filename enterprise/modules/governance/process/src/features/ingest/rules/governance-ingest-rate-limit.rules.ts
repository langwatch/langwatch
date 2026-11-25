// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** The window the ingest throttle counts in, in seconds. */
export const INGEST_RATE_LIMIT_WINDOW_SECONDS = 60;
/** How many requests one caller may make inside a window. */
export const INGEST_RATE_LIMIT_MAX_REQUESTS = 60;

/**
 * The throttle's bucket: the address the door resolved, else `unknown`, so
 * callers the door could not tell apart meter as one bucket. No header is read.
 */
export function ingestRateLimitKey(callerAddress: string | null): string {
  return `ingest:${callerAddress ?? "unknown"}`;
}
