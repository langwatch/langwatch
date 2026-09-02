/**
 * The three collaborators the invitation service reaches OUTSIDE this feature.
 *
 * An invitation is written, priced against the plan's seats, mailed, and
 * resent under a throttle. Only the first of those is this package's own
 * question: the seat census belongs to the entitlement vertical, the message
 * belongs to the mail renderer, and the counter belongs to whichever process
 * is composing it. Each arrives as an abstract port so the service can be
 * composed on a process that has one, two or none of them and still SAY which.
 */

/**
 * What an organization's seats currently cost it, and what a lite seat is.
 *
 * Two counts and one predicate because they are one question — is there room
 * for these invitations — asked of the vertical that owns the answer. A
 * process that composes this over `@langwatch/entitlement-server` gets the
 * same numbers the usage reading shows; a process that composes none is told
 * so by name rather than being handed zeroes, which would sell every
 * organization unlimited seats.
 */
export abstract class OrganizationInviteSeatCensusPort {
  /** Members holding a FULL seat right now, live invitations included. */
  abstract getMemberCount(organizationId: string): Promise<number>;
  /** Members holding a LITE seat right now, live invitations included. */
  abstract getMembersLiteCount(organizationId: string): Promise<number>;
  /**
   * Whether a custom role's permissions are view-only, which is what keeps a
   * lite seat from being sold the permissions of a full one.
   */
  abstract isViewOnlyCustomRole(permissions: string[]): boolean;
}

/**
 * The two messages an invitation puts in somebody's inbox.
 *
 * A port rather than a call into `@langwatch/mail`, for the reason every
 * other mail seam in this migration gives: rendering a LangWatch message is
 * react-email, and a value-import chain from a backend process to React is
 * what `frontend-boundary.unit.test.ts` exists to stop.
 *
 * Absent is a SUPPORTED state, not a degradation: the service reports
 * `emailNotSent` and the invitation listing carries the accept URL, which is
 * how a deployment with no mail gateway hands an invitation over. That is the
 * same answer the platform application gave when `SENDGRID_API_KEY` was
 * blank.
 */
export abstract class OrganizationInviteMailPort {
  /** The invitation itself, carrying the already-built accept URL. */
  abstract sendInvite(
    input: Readonly<{
      email: string;
      organization: Readonly<{ name: string }>;
      acceptInviteUrl: string;
    }>,
  ): Promise<void>;
  /** "Somebody is waiting", to one administrator of the organization. */
  abstract sendInviteReRequest(
    input: Readonly<{
      adminEmail: string;
      organizationName: string;
      invitedEmail: string;
      membersSettingsUrl: string;
    }>,
  ): Promise<void>;
}

/**
 * The process's fixed-window counter, as the invitation throttle spends it.
 *
 * A port rather than a Redis client, because the counter is the PROCESS's:
 * two limiters would give one caller two budgets, and the whole point of the
 * invitation window is that the admin's resend and the invitee's re-request
 * spend the SAME allowance.
 */
export abstract class OrganizationInviteRateLimitPort {
  abstract limit(
    input: Readonly<{ key: string; windowSeconds: number; max: number }>,
  ): Promise<Readonly<{ allowed: boolean; resetAt: number }>>;
}
