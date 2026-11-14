/**
 * When a docs session key dies, and what it may hold (ADR-185). Pure, so the service and its
 * tests read one rule.
 */
import {
  DOCS_SESSION_KEY_MAX_LIFETIME_MS,
  loginKeyExpiresAt,
  type DocsSessionKeyAccess,
} from "@langwatch/api-key-contract";
import { bindingScopeCanGrantPermission } from "@langwatch/authz-contract";
import { Temporal, type Instant } from "@langwatch/time";

/**
 * The earliest of the chosen lifetime (never past one hour) from now, the browser session's own
 * expiry and the organization's session ceiling counted from when the session began. A session
 * whose start auth did not report is bounded by the first two alone.
 */
export function docsSessionKeyExpiresAt({
  nowMs,
  lifetimeMinutes,
  sessionExpiresAt,
  sessionStartedAt,
  maxSessionDurationDays,
}: {
  nowMs: number;
  lifetimeMinutes: number;
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
    refreshWindowMs: Math.min(lifetimeMinutes * 60 * 1000, DOCS_SESSION_KEY_MAX_LIFETIME_MS),
  }).epochMilliseconds;
  const endMs = sessionExpiresAtMs === null ? bounded : Math.min(bounded, sessionExpiresAtMs);

  return Temporal.Instant.fromEpochMilliseconds(endMs);
}

/**
 * What the member holds in the project that a project binding can carry: never an
 * organization-only permission, so the key cannot reach the organization's settings. A
 * read-only key keeps only the reads (`*:view`), so the door refuses every other operation.
 */
export function docsSessionKeyPermissions({
  held,
  access,
}: {
  held: readonly string[];
  access: DocsSessionKeyAccess;
}): string[] {
  return [...new Set(held)]
    .filter((permission) => bindingScopeCanGrantPermission({ scopeType: "PROJECT", permission }))
    .filter((permission) => access === "full" || permission.endsWith(":view"))
    .toSorted();
}
