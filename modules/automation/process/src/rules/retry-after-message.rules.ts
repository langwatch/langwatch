/**
 * ADR-031: turns a rejected rate-limit window into a "try again in N
 * seconds" message. Its own module, not a test-fire closure, so the
 * retry-seconds arithmetic can be unit-tested without a tRPC procedure.
 */

import { nowInstant } from "@langwatch/time";

export function buildRetryAfterMessage({
  prefix,
  resetAt,
  now = nowInstant().epochMilliseconds,
}: {
  prefix: string;
  resetAt: number;
  now?: number;
}): string {
  const retryInSeconds = Math.max(1, Math.ceil((resetAt - now) / 1000));
  return `${prefix} Try again in ${retryInSeconds} second${retryInSeconds === 1 ? "" : "s"}.`;
}
