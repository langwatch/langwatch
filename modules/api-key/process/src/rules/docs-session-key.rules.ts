/**
 * When a docs session key dies, and what it may hold (ADR-185). Pure, so the service and its
 * tests read one rule.
 */
import { DOCS_SESSION_KEY_LIFETIME_MS, loginKeyExpiresAt } from "@langwatch/api-key-contract";
import { bindingScopeCanGrantPermission } from "@langwatch/authz-contract";
import { Temporal, type Instant } from "@langwatch/time";

/**
 * The earliest of five minutes from now, the browser session's own expiry and the
 * organization's session ceiling counted from when the session began. A session whose start
 * auth did not report is bounded by the first two alone.
 */
export function docsSessionKeyExpiresAt({
  nowMs,
  sessionExpiresAt,
  sessionStartedAt,
  maxSessionDurationDays,
}: {
  nowMs: number;
  /** ISO moments as the browser session reports them; null when it reported none. */
  sessionExpiresAt: string | null;
  sessionStartedAt: string | null;
  maxSessionDurationDays: number;
}): Instant {
  const sessionExpiresAtMs =
    sessionExpiresAt === null ? null : Temporal.Instant.from(sessionExpiresAt).epochMilliseconds;
  const sessionStartedAtMs =
    sessionStartedAt === null ? null : Temporal.Instant.from(sessionStartedAt).epochMilliseconds;
  const bounded = loginKeyExpiresAt({
    nowMs,
    sessionStartedAtMs: sessionStartedAtMs ?? nowMs,
    maxSessionDurationDays: sessionStartedAtMs === null ? 0 : maxSessionDurationDays,
    refreshWindowMs: DOCS_SESSION_KEY_LIFETIME_MS,
  }).epochMilliseconds;
  const endMs = sessionExpiresAtMs === null ? bounded : Math.min(bounded, sessionExpiresAtMs);

  return Temporal.Instant.fromEpochMilliseconds(endMs);
}

/**
 * What the member holds in the project that a project binding can carry: never an
 * organization-only permission, so the key cannot reach the organization's settings.
 */
export function docsSessionKeyPermissions(held: readonly string[]): string[] {
  return [...new Set(held)]
    .filter((permission) => bindingScopeCanGrantPermission({ scopeType: "PROJECT", permission }))
    .toSorted();
}
