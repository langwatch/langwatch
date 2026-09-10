import type { PersonalWorkspaceResourceIds } from "../repositories/organization.repository.ts";
export interface OrganizationInfrastructure {  groupIdentity: GroupIdentity;
  organizationGrantCache: OrganizationGrantCache;
  organizationPromptSeed: OrganizationPromptSeed;
  organizationSeatLicense: OrganizationSeatLicense;
  organizationSessionRevocation: OrganizationSessionRevocation;
  organizationSettingsSecret: OrganizationSettingsSecret;
  personalWorkspaceDiagnostics: PersonalWorkspaceDiagnostics;
  personalWorkspaceIdentity: PersonalWorkspaceIdentity;
  teamIdentity: TeamIdentity;
  organizationInviteSeatCensus?: OrganizationInviteSeatCensus;
  organizationInviteMail?: OrganizationInviteMail;
  organizationInviteWorkspaceCensus?: OrganizationInviteWorkspaceCensus;
  organizationInviteRateLimit?: OrganizationInviteRateLimit;
}

/**
 * What an organization's seats currently cost it, and what a lite seat is - two counts and one
 * predicate for the single question "is there room for these invitations." A process with none
 * composed is told so by name rather than handed zeroes, which would sell unlimited seats.
 */
export interface OrganizationInviteSeatCensus {
  /** Members holding a FULL seat right now, live invitations included. */
  getMemberCount(organizationId: string): Promise<number>;
  /** Members holding a LITE seat right now, live invitations included. */
  getMembersLiteCount(organizationId: string): Promise<number>;
  /**
   * Whether a custom role's permissions are view-only, which is what keeps a
   * lite seat from being sold the permissions of a full one.
   */
  isViewOnlyCustomRole(permissions: string[]): boolean;
}

/**
 * The two messages an invitation puts in somebody's inbox. A port rather than a call into
 * `@langwatch/mail`, since rendering is react-email and `frontend-boundary.unit.test.ts` bans a
 * value-import chain from a backend process to React. Absent is a supported state, not degraded.
 */
export interface OrganizationInviteMail {
  /**
   * The invitation itself, carrying the already-built accept URL.
   *
   * `projectCount` and `inviter` are what an invitee cannot otherwise know
   * before deciding: whether the workspace has anything in it, and who asked
   * them. Both are optional because both are reads a process may not have
   * composed, and a message that says less is the supported state.
   */
  sendInvite(
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
  sendInviteReRequest(
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
export interface OrganizationInviteWorkspaceCensus {
  countProjects(organizationId: string): Promise<number>;
}

/**
 * The process's fixed-window counter, as the invitation throttle spends it. A port rather than a
 * Redis client, so the admin's resend and the invitee's re-request spend the same allowance.
 */
export interface OrganizationInviteRateLimit {
  limit(
    input: Readonly<{ key: string; windowSeconds: number; max: number }>,
  ): Promise<Readonly<{ allowed: boolean; resetAt: number }>>;
}

/**
 * The person a plan lookup is attributed to. Structural on purpose, since the licence store's
 * own user shape lives in an Enterprise package.
 */
export type OrganizationPlanUser = Readonly<{
  id: string;
  name?: string | null;
  email?: string | null;
}>;

/** Which seat kind a role change is asking the organization to spend. */
export type OrganizationSeatChangeType = string;

/** What a seat check answers when it refuses. */
export type OrganizationSeatDecision = Readonly<{
  allowed: boolean;
  limitType?: string;
  current?: number;
  max?: number;
}>;

/**
 * The seat and plan gates on a membership write. Deliberately two methods rather than the
 * platform's four: role classification, plan reads, seat counts, and the Enterprise custom-role
 * requirement are all one decision — "may this organization make this change on its plan."
 */
export interface OrganizationSeatLicense {
  /** Whether one more of `resource` fits inside the organization's plan. Answers rather than
   * throws, since only the caller knows how to turn a refusal into a named error. */
  checkLimit(input: {
    organizationId: string;
    resource: "members" | "membersLite";
    user?: OrganizationPlanUser | undefined;
  }): Promise<OrganizationSeatDecision>;

  /**
   * Refuses a role change the organization's plan does not carry: seat classification first,
   * then the Enterprise requirement a custom-role assignment implies. Throws, never a soft answer.
   */
  assertRoleChangeAllowed(input: {
    organizationId: string;
    currentRole: string;
    userPermissions: string[] | undefined;
    role: string;
    teamRoleUpdates?: ReadonlyArray<{ role: string; customRoleId?: string }> | undefined;
    user?: OrganizationPlanUser | undefined;
  }): Promise<void>;
}

/**
 * The live browser sessions a revoked seat has to lose — not optional decoration, since a
 * seat revoked without the session revoked leaves the person working until the token expires.
 */
export interface OrganizationSessionRevocation {
  revokeAllBrowserSessions(input: { userId: string }): Promise<void>;
}

/**
 * The authorization snapshots cached for one organization. Disabling a membership is a plain
 * column write, not a grant write, so nothing else retires those snapshots.
 */
export interface OrganizationGrantCache {
  invalidateOrganization(input: { organizationId: string }): Promise<void>;
}

/**
 * The prompt tags a new organization is seeded with, and where a compensation failure is
 * reported when provisioning undoes itself — the tag catalogue is the prompt feature's.
 */
export interface OrganizationPromptSeed {
  seedTagsForOrganization(input: { organizationId: string }): Promise<void>;
  reportCompensationFailure(error: Error): void;
}


export interface OrganizationSettingsSecret {
  encrypt(value: string): string;
  decrypt(value: string): string;
}


export interface PersonalWorkspaceIdentity {
  create(input: { userId: string; organizationId: string }): PersonalWorkspaceResourceIds;
}


export interface PersonalWorkspaceDiagnostics {
  warn(message: string, context: Record<string, unknown>): void;
}


export interface TeamIdentity {
  createTeam(input: { name: string }): {
    teamId: string;
    slug: string;
  };
  createBindingId(): string;
}


export interface GroupIdentity {
  createGroupId(): string;
  createBindingId(): string;
  slugify(name: string): string;
}
