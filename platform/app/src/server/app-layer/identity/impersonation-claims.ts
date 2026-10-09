import {
  ownPrincipal,
  type SessionPrincipal,
} from "~/server/app-layer/authz/principal";

/**
 * What a session's impersonation claims mean, as a pure function (D06).
 *
 * Its own module, and a pure one, because this decides whose data a request
 * sees. A rule that consequential is tested against the states that matter —
 * a lapsed window, half-written claims, an operator impersonating nobody —
 * rather than against a database.
 *
 * The default is ALWAYS "acting as themselves". Anything missing, anything
 * expired and anything self-referential reads as an ordinary session, which
 * is what makes an impersonation that lapses mid-request return the operator
 * to their own access rather than stranding them.
 */

/** The claims as the session row carries them. */
export interface ImpersonationClaims {
  /** The row's own user — the operator, on an impersonating session. */
  sessionUserId: string;
  actorUserId: string | null;
  subjectUserId: string | null;
  impersonationExpiresAt: Date | null;
}

export function resolveSessionPrincipal({
  claims,
  now = new Date(),
}: {
  claims: ImpersonationClaims;
  now?: Date;
}): SessionPrincipal {
  const own = ownPrincipal({ userId: claims.sessionUserId });
  const { actorUserId, subjectUserId, impersonationExpiresAt } = claims;

  // Both halves or neither. A row carrying one of them is a write that did
  // not finish, and reading it as an impersonation would be reading a
  // half-written row as an authorization decision.
  if (!actorUserId || !subjectUserId) return own;

  // An impersonation of oneself is not an impersonation, and treating it as
  // one would put an operator in an audit trail as two different people.
  if (actorUserId === subjectUserId) return own;

  // The window is what makes borrowed access temporary. A session outlives
  // it; past it the operator is themselves again, and nothing was ended.
  if (!impersonationExpiresAt || impersonationExpiresAt <= now) return own;

  // The actor on the row must be the session's own user. Anything else is a
  // row somebody wrote that they should not have, and the safe reading is
  // the one that grants nothing extra.
  if (actorUserId !== claims.sessionUserId) return own;

  return { actor: { userId: actorUserId }, subject: { userId: subjectUserId } };
}
