import type { SessionImpersonationState } from "@langwatch/auth-contract";
import { Temporal, type Instant } from "@langwatch/time";

/** The {actor, subject} columns as a session row holds them, possibly half-written. */
export type StoredImpersonationClaims = Readonly<{
  actorUserId: string | null;
  subjectUserId: string | null;
  reason: string | null;
  expiresAt: Instant | null;
}>;

/**
 * What a session's impersonation claims mean (D06). The default is always "acting as themselves":
 * a half-written row, a self-impersonation, a lapsed window or an actor other than the session's
 * own user all read as no impersonation, so borrowed access lapses back to the operator's own.
 */
export function liveImpersonation({
  sessionUserId,
  claims,
  now,
}: {
  sessionUserId: string;
  claims: StoredImpersonationClaims | null;
  now: Instant;
}): SessionImpersonationState {
  const none = { kind: "none" } as const;
  if (!claims) return none;
  const { actorUserId, subjectUserId, reason, expiresAt } = claims;
  if (!actorUserId || !subjectUserId) return none;
  if (actorUserId === subjectUserId) return none;
  if (!expiresAt || Temporal.Instant.compare(expiresAt, now) <= 0) return none;
  if (actorUserId !== sessionUserId) return none;

  return {
    kind: "impersonating",
    impersonation: { actorUserId, subjectUserId, reason, expiresAt },
  };
}
