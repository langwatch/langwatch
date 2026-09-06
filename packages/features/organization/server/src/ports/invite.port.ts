/**
 * The three collaborators the invitation service reaches outside this feature: seat census
 * (entitlement), mail, and rate-limit counter. Each is an abstract port so the service can be
 * composed on a process that has one, two, or none of them and still say which.
 */

/**
 * What an organization's seats currently cost it, and what a lite seat is — two counts and one
 * predicate for the single question "is there room for these invitations." A process with none
 * composed is told so by name rather than handed zeroes, which would sell unlimited seats.
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
 * The two messages an invitation puts in somebody's inbox. A port rather than a call into
 * `@langwatch/mail`, since rendering is react-email and `frontend-boundary.unit.test.ts` bans a
 * value-import chain from a backend process to React. Absent is a supported state, not degraded.
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
 * The process's fixed-window counter, as the invitation throttle spends it. A port rather than a
 * Redis client, so the admin's resend and the invitee's re-request spend the same allowance.
 */
export abstract class OrganizationInviteRateLimitPort {
  abstract limit(
    input: Readonly<{ key: string; windowSeconds: number; max: number }>,
  ): Promise<Readonly<{ allowed: boolean; resetAt: number }>>;
}
