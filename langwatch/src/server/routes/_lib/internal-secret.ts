import { timingSafeEqual } from "node:crypto";

/**
 * Validates the internal shared secret (CRON_API_KEY) from the Authorization
 * header for service-to-service routes (cron jobs, worker triggers, operational
 * tasks). These routes have no RBAC credential and no tenant context; the
 * shared secret is the entire authentication.
 *
 * Fails CLOSED: when CRON_API_KEY is not configured the gate denies every
 * caller. A direct `header === process.env.CRON_API_KEY` comparison made
 * `undefined === undefined` return true for a credential-less request whenever
 * the secret was unset — an unauthenticated caller could then trigger
 * destructive jobs (retention cleanup, lambda deletion, check re-runs). The
 * comparison is constant-time to avoid leaking the secret through timing.
 */
export function validateInternalSecret(c: {
  req: { header: (name: string) => string | undefined };
}): boolean {
  const expected = process.env.CRON_API_KEY;
  if (!expected) return false;

  const header = c.req.header("authorization");
  const presented = header?.startsWith("Bearer ") ? header.slice(7) : header;
  if (!presented) return false;

  const presentedBuf = Buffer.from(presented);
  const expectedBuf = Buffer.from(expected);
  if (presentedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(presentedBuf, expectedBuf);
}
