/**
 * Who really made a request, and whose access it is exercising (D06).
 *
 * The authz vocabulary already speaks of a principal as the thing a grant
 * names. This is the pair a REQUEST carries, and on almost every request the
 * two halves are the same person: the actor is the subject and there is
 * nothing to distinguish.
 *
 * They come apart under impersonation, and that is the whole reason the pair
 * exists. A LangWatch operator borrowing somebody's access is the ACTOR; the
 * person whose data they are looking at is the SUBJECT. Every authorization
 * decision made on that request records both, so the audit trail can answer
 * "who really did it" rather than only "whose account it happened in" — and
 * the operator's own access is still decided by who they really are.
 *
 * This replaced the legacy `Session.impersonating` JSON payload, which
 * carried a copy of the impersonated user's name and e-mail and said nothing
 * about the operator at all.
 */
export interface SessionPrincipal {
  /** Who is really making the request. */
  actor: { userId: string };
  /** Whose access the request is exercising. */
  subject: { userId: string };
}

/** The ordinary case: somebody acting as themselves. */
export function ownPrincipal({ userId }: { userId: string }): SessionPrincipal {
  return { actor: { userId }, subject: { userId } };
}

/** Whether this request is one person acting as another. */
export function isImpersonating(principal: SessionPrincipal): boolean {
  return principal.actor.userId !== principal.subject.userId;
}

/**
 * The pair as a log line and an audit row take it. Flat rather than nested
 * because both consumers index on fields, and `actorUserId` next to
 * `subjectUserId` is greppable in a way `principal.actor.userId` is not.
 */
export function principalFields(principal: SessionPrincipal): {
  actorUserId: string;
  subjectUserId: string;
  impersonating: boolean;
} {
  return {
    actorUserId: principal.actor.userId,
    subjectUserId: principal.subject.userId,
    impersonating: isImpersonating(principal),
  };
}
