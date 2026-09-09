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
  /**
   * The invitation itself, carrying the already-built accept URL.
   *
   * `projectCount` and `inviter` are what an invitee cannot otherwise know
   * before deciding: whether the workspace has anything in it, and who asked
   * them. Both are optional because both are reads a process may not have
   * composed, and a message that says less is the supported state.
   */
  abstract sendInvite(
    input: Readonly<{
      email: string;
      organization: Readonly<{ name: string; projectCount?: number }>;
      inviter?: Readonly<{ name: string }>;
      /** Why this organization came, so the first steps match what it uses us for. */
      firstSteps?: Readonly<{ intent?: "AGENT_GOVERNANCE" | "LLM_OPS" }>;
      acceptInviteUrl: string;
    }>,
  ): Promise<void>;
  /**
   * "Somebody is waiting", to one administrator of the organization.
   *
   * `seats` is passed only for an organization whose ceiling is the one it
   * bought. An organization on enterprise or negotiated terms holds a ceiling
   * that is its own, so nothing is passed rather than a public number that is
   * not its number.
   */
  abstract sendInviteReRequest(
    input: Readonly<{
      adminEmail: string;
      organizationName: string;
      invitedEmail: string;
      membersSettingsUrl: string;
      seats?: Readonly<{ used: number; ceiling: number }>;
    }>,
  ): Promise<void>;
}

/**
 * How much work is already in the workspace an invitee is being asked to join.
 *
 * A port rather than a call into the project feature, for the reason the mail
 * port gives: the count belongs to another aggregate, and a process that did
 * not compose it says so by not having one rather than by reporting zero,
 * which would tell every invitee the room is empty.
 */
export abstract class OrganizationInviteWorkspaceCensusPort {
  abstract countProjects(organizationId: string): Promise<number>;
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
