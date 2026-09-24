import type {
  JoinRequestJoining,
  JoinRequestAdmitted,
  OrganizationInvite,
  OrganizationInviteValidation,
  OrganizationListedInvite,
  OrganizationPendingInviteApplied,
} from "@langwatch/organization-contract";

import type { PersonalWorkspaceResourceIds } from "../repositories/organization.repository.ts";
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
   * `projectCount` and `inviter` are optional — reads a process may not have
   * composed — since a message that says less is the supported state.
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
   * "Somebody is waiting", to one administrator of the organization. `seats`
   * is passed only when the ceiling is the one this organization bought — an
   * enterprise or negotiated ceiling is not passed since it is not a public number.
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
 * How much work is already in the workspace an invitee is being asked to
 * join. A port, not a call into the project feature — same reason as the
 * mail port: an uncomposed process says so by absence, not by reporting zero.
 */
export interface OrganizationInviteWorkspaceCensus {
  countProjects(organizationId: string): Promise<number>;
}

/**
 * The process's fixed-window counter, as the invitation throttle spends it. A port rather than a
 * Redis client, so the admin's resend and the invitee's re-request spend the same allowance.
 * `count` defaults to 1: a batch creation spends one per invited address.
 */
export interface OrganizationInviteRateLimit {
  limit(
    input: Readonly<{ key: string; windowSeconds: number; max: number; count?: number }>,
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
    teamRoleUpdates?: readonly { role: string; customRoleId?: string }[] | undefined;
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

/** One waiting join request, as the ledger folds it. */
export type OrganizationJoinRequestState = Readonly<{
  joinRequestId: string;
  userId: string;
  organizationId: string;
  domain: string;
  createdAtMs: number;
  expiresAtMs: number | null;
  resolvedAtMs: number | null;
}>;

/**
 * Asking to join, and answering. The identity feature owns the decision
 * `lookup` answers with, so it travels through here unread.
 */
export interface OrganizationJoinRequests {
  lookup(input: Readonly<{ userId: string; verifiedEmail: string | null }>): Promise<unknown>;
  /** The post-login offer: the lookup, minus the domains this person dismissed. */
  offerForSignedInUser(
    input: Readonly<{ userId: string; verifiedEmail: string | null }>,
  ): Promise<unknown>;
  dismissOffer(input: Readonly<{ userId: string; verifiedEmail: string | null }>): Promise<void>;
  joinAutomaticallyIfAdmitted(
    input: Readonly<{ userId: string; verifiedEmail: string | null }>,
  ): Promise<JoinRequestAdmitted>;
  automaticJoinsForOrganization(
    input: Readonly<{ organizationId: string }>,
  ): Promise<readonly OrganizationJoinRequestState[]>;
  pendingForUser(
    input: Readonly<{ userId: string }>,
  ): Promise<readonly OrganizationJoinRequestState[]>;
  pendingForOrganization(
    input: Readonly<{ organizationId: string }>,
  ): Promise<readonly OrganizationJoinRequestState[]>;
  request(
    input: Readonly<{ userId: string; verifiedEmail: string | null; organizationId: string }>,
  ): Promise<Readonly<{ joinRequestId: string; state: "PENDING" | "APPROVED" }>>;
  withdraw(input: Readonly<{ joinRequestId: string; userId: string }>): Promise<void>;
  approve(
    input: Readonly<{ joinRequestId: string; organizationId: string; adminUserId: string }>,
  ): Promise<void>;
  reject(
    input: Readonly<{ joinRequestId: string; organizationId: string; adminUserId: string }>,
  ): Promise<void>;
  readJoining(input: Readonly<{ organizationId: string }>): Promise<JoinRequestJoining>;
  setJoining(
    input: Readonly<{
      organizationId: string;
      domainJoin: JoinRequestJoining["domainJoin"];
      domains: readonly string[];
      actorUserId: string;
    }>,
  ): Promise<
    Readonly<{
      previous: JoinRequestJoining["domainJoin"];
      next: JoinRequestJoining["domainJoin"];
      previousDomains: readonly string[];
      nextDomains: readonly string[];
    }>
  >;
  /** A formal invitation ANSWERS the same person's open request. */
  resolveByInvitation(
    input: Readonly<{ userId: string; organizationId: string; inviteId: string }>,
  ): Promise<void>;
  /** Accepting an invitation WITHDRAWS the same person's open request. */
  withdrawOnInvitationAccepted(
    input: Readonly<{ userId: string; organizationId: string }>,
  ): Promise<void>;
}

/** One invitation as the acceptance ceremony reads it: the row and its organization. */
export type OrganizationInviteWithOrganization = OrganizationInvite &
  Readonly<{ organization: Readonly<{ id: string; name: string }> }>;

/** One batch of invitations, and the organization they were written against. */
export type OrganizationInvitesCreated = Readonly<{
  organization: Readonly<{ members: readonly unknown[] }>;
  invites: readonly Readonly<{ invite: OrganizationInvite; emailNotSent: boolean }>[];
}>;

/**
 * The invitations an organization has outstanding. The SAME service the
 * management REST family administers, so an administrator and a provisioning
 * tool see one set of invitations with one acceptance link each.
 */
export interface OrganizationInvitations {
  create(
    input: Readonly<{
      organizationId: string;
      invites: readonly Readonly<{
        email: string;
        teamIds?: string;
        teams?: readonly Readonly<{ teamId: string; role: string; customRoleId?: string }>[];
        role: "ADMIN" | "MEMBER" | "EXTERNAL";
      }>[];
      /**
       * Chosen by the transport that asked, never by the composition: a batch
       * naming a team outside the organization is refused under `strict` and
       * filtered under `lenient`.
       */
      validation: OrganizationInviteValidation;
    }>,
  ): Promise<OrganizationInvitesCreated>;
  revoke(input: Readonly<{ organizationId: string; inviteId: string }>): Promise<void>;
  /**
   * Throttled per INVITATION, because the thing protected is the recipient's
   * inbox rather than this server. Throws when throttled.
   */
  assertSendAllowed(input: Readonly<{ inviteId: string }>): Promise<void>;
  resend(
    input: Readonly<{ organizationId: string; inviteId: string }>,
  ): Promise<Readonly<{ invite: OrganizationInvite; emailNotSent: boolean }>>;
  list(
    input: Readonly<{ organizationId: string }>,
  ): Promise<
    readonly (OrganizationInvite & Omit<OrganizationListedInvite, keyof OrganizationInvite>)[]
  >;
  findByCode(
    input: Readonly<{ inviteCode: string }>,
  ): Promise<OrganizationInviteWithOrganization | null>;
  /**
   * Whether ANY of the signed-in person's VERIFIED identifiers holds the
   * invited address, and which one vouched. Somebody not yet on identifiers
   * falls back to comparing the session address byte for byte.
   */
  matchToAcceptor(
    input: Readonly<{ inviteEmail: string; sessionEmail: string; userId: string }>,
  ): Promise<Readonly<{ matches: boolean; viaIdentifierId?: string | null }>>;
  apply(
    input: Readonly<{
      userId: string;
      invite: OrganizationInviteWithOrganization;
      viaIdentifierId?: string | null;
    }>,
  ): Promise<void>;
  /**
   * Applies the PENDING invitation this address already holds here, as one
   * decision: an invitation that exists wins, and its role and team
   * assignments replace a default membership entirely.
   */
  applyPending(
    input: Readonly<{ userId: string; organizationId: string; email: string }>,
  ): Promise<OrganizationPendingInviteApplied>;
  findLandingProjectSlug(
    input: Readonly<{ invite: OrganizationInviteWithOrganization }>,
  ): Promise<string | null>;
  /** The acceptance link this deployment mints for one invitation code. */
  acceptUrl(inviteCode: string): string;
  /** The invited address, masked: an invite code is a bearer token. */
  maskAddress(email: string): string;
  /** PENDING / ACCEPTED / EXPIRED / REVOKED, expiry included. */
  displayStatus(
    invite: Readonly<{ status: string; expiration: OrganizationInvite["expiration"] }>,
  ): string;
  /** Tells the organization's administrators a seat limit was reached. */
  notifySeatLimitReached(
    input: Readonly<{
      organizationId: string;
      limitType: string;
      current: number;
      max: number;
    }>,
  ): Promise<void>;
  /** The person behind an invited address, when they already have an account. */
  findUserIdByEmail(input: Readonly<{ email: string }>): Promise<string | null>;
}

/**
 * What the organization's plan carries. Each one throws by name; a refusal is
 * never turned into a different answer.
 */
export interface OrganizationPlanGate {
  // A property of function type rather than method shorthand: a test holds
  // a mock built to this interface and asserts on this member via
  // `expect(...).not.toHaveBeenCalled()`, which is unsafe against a
  // method-shorthand member under `unbound-method`.
  assertCustomRolesAllowed: (input: Readonly<{ organizationId: string }>) => Promise<void>;
  assertAuditLogsAllowed(input: Readonly<{ organizationId: string }>): Promise<void>;
  assertScimAllowed(input: Readonly<{ organizationId: string }>): Promise<void>;
  /**
   * Refuses a built-in team-role change that would push the organization past
   * the member seats its licence covers. Throws.
   */
  assertTeamRoleChangeWithinSeatLimits(
    input: Readonly<{ organizationId: string; teamId: string; userId: string }>,
  ): Promise<void>;
}

/**
 * The trail a sign-up, an invitation and a chosen integration leave outside
 * this feature. Every one of them is fire-and-forget by construction: an
 * organization that could not be announced is still an organization.
 */
export interface OrganizationSignals {
  trackServerEvent(
    input: Readonly<{
      userId: string;
      event: string;
      properties?: Readonly<Record<string, unknown>>;
    }>,
  ): void;
  fireTeamMemberInvitedNurturing(
    input: Readonly<{ userId: string; teamMemberCount: number; role: string }>,
  ): void;
  fireInviteAcceptedNurturing(
    input: Readonly<{
      userId: string;
      email: string;
      name?: string | null;
      organizationId: string;
      organizationName: string;
    }>,
  ): void;
  // A property of function type rather than method shorthand: a test holds
  // a mock built to this interface and asserts on this member via
  // `expect(...).toHaveBeenCalledWith`, which is unsafe against a
  // method-shorthand member under `unbound-method`.
  fireSignupNurturing: (
    input: Readonly<{
      userId: string;
      email: string | null;
      name: string | null;
      organizationId: string;
      organizationName: string;
      signUpData?: Record<string, unknown> | undefined;
      primaryIntent?: string | undefined;
    }>,
  ) => void;
  // sendSlackSignupEvent, sendHubspotSignupForm and reportError below are
  // properties of function type rather than method shorthand: tests hold a
  // mock built to this interface and assert on these members via
  // `expect(...).toHaveBeenCalledWith`, which is unsafe against a
  // method-shorthand member under `unbound-method`.
  sendSlackSignupEvent: (
    input: Readonly<{
      userName?: string | null;
      userEmail: string | null;
      organizationName: string;
      phoneNumber?: string | undefined;
      signUpData?: Record<string, unknown> | undefined;
    }>,
  ) => Promise<void>;
  sendHubspotSignupForm: (
    input: Readonly<{
      userName?: string | null;
      userEmail: string | null;
      organizationName: string;
      phoneNumber?: string | undefined;
      signUpData?: Record<string, unknown> | undefined;
    }>,
  ) => Promise<void>;
  recordIntegrationMethod(input: Readonly<{ userId: string; selection: string }>): void;
  /** Never fatal: every caller of this is already on a non-fatal branch. */
  reportError: (
    error: unknown,
    context?: Readonly<{
      tags?: Readonly<Record<string, string>>;
      extra?: Readonly<Record<string, unknown>>;
    }>,
  ) => void;
}

/**
 * The parts of the sign-up ceremony that belong to other features: the
 * standard AI-tool catalogue Enterprise governance seeds, and the first
 * project, created through the SAME project service every other door uses.
 */
export interface OrganizationCeremony {
  // Properties of function type rather than method shorthand: a test holds a
  // mock built to this interface and asserts on these members via
  // `expect(...).toHaveBeenCalledWith`/`.not.toHaveBeenCalled()`, which is
  // unsafe against a method-shorthand member under `unbound-method`.
  ensureDefaultAiToolCatalog: (input: Readonly<{ organizationId: string }>) => Promise<void>;
  createProject: (
    input: Readonly<{
      organizationId: string;
      teamId: string;
      name: string;
      language: string;
      framework: string;
      userId: string;
    }>,
  ) => Promise<Readonly<{ success: boolean; projectSlug: string }>>;
}

/** The demo organization's person and project, or empty strings when unset. */
export type OrganizationDemoProject = Readonly<{ userId: string; projectId: string }>;

/**
 * One person's own verified address, and the display names a pending list
 * renders. Both are the identity directory's, read through this process.
 */
export interface OrganizationDirectory {
  findVerifiedEmail(input: Readonly<{ userId: string }>): Promise<string | null>;
  listUserNames(
    input: Readonly<{ userIds: readonly string[] }>,
  ): Promise<readonly Readonly<{ id: string; name: string | null }>[]>;
}
