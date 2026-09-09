/**
 * What the process supplies this feature that is not the organization's own:
 * the invitation service, the join-request ledger, the plan gate, the
 * deployment's demo project and the signals a sign-up leaves behind.
 *
 * Every one of them is a plain interface. A deployment that composed none of
 * a capability supplies `null` for it, and the application refuses the doors
 * that need it by name rather than answering emptily.
 */

import type { Instant } from "@langwatch/time";
import type {
  JoinRequestJoining,
  JoinRequestJoiningChanged,
  OrganizationInvite,
  OrganizationListedInvite,
} from "@langwatch/organization-contract";

/** One waiting join request, as the ledger folds it. */
export type OrganizationJoinRequestState = Readonly<{
  joinRequestId: string;
  userId: string;
  organizationId: string;
  domain: string;
  createdAtMs: number;
  expiresAtMs: number | null;
}>;

/**
 * Asking to join, and answering. The identity feature owns the decision
 * `lookup` answers with, so it travels through here unread.
 */
export interface OrganizationJoinRequests {
  lookup(input: Readonly<{ userId: string; verifiedEmail: string | null }>): Promise<unknown>;
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
    }>,
  ): Promise<JoinRequestJoiningChanged>;
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
  list(input: Readonly<{ organizationId: string }>): Promise<readonly OrganizationListedInvite[]>;
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
  findLandingProjectSlug(
    input: Readonly<{ invite: OrganizationInviteWithOrganization }>,
  ): Promise<string | null>;
  /** The acceptance link this deployment mints for one invitation code. */
  acceptUrl(inviteCode: string): string;
  /** The invited address, masked: an invite code is a bearer token. */
  maskAddress(email: string): string;
  /** PENDING / ACCEPTED / EXPIRED / REVOKED, expiry included. */
  displayStatus(invite: Readonly<{ status: string; expiration: Instant | Date | null }>): string;
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
  assertCustomRolesAllowed(input: Readonly<{ organizationId: string }>): Promise<void>;
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
  fireSignupNurturing(
    input: Readonly<{
      userId: string;
      email: string | null;
      name: string | null;
      organizationId: string;
      organizationName: string;
      signUpData?: Record<string, unknown> | undefined;
      primaryIntent?: string | undefined;
    }>,
  ): void;
  sendSlackSignupEvent(
    input: Readonly<{
      userName?: string | null;
      userEmail: string | null;
      organizationName: string;
      phoneNumber?: string | undefined;
      signUpData?: Record<string, unknown> | undefined;
    }>,
  ): Promise<void>;
  sendHubspotSignupForm(
    input: Readonly<{
      userName?: string | null;
      userEmail: string | null;
      organizationName: string;
      phoneNumber?: string | undefined;
      signUpData?: Record<string, unknown> | undefined;
    }>,
  ): Promise<void>;
  recordIntegrationMethod(input: Readonly<{ userId: string; selection: string }>): void;
  /** Never fatal: every caller of this is already on a non-fatal branch. */
  reportError(
    error: unknown,
    context?: Readonly<{
      tags?: Readonly<Record<string, string>>;
      extra?: Readonly<Record<string, unknown>>;
    }>,
  ): void;
}

/**
 * The parts of the sign-up ceremony that belong to other features: the
 * standard AI-tool catalogue Enterprise governance seeds, and the first
 * project, created through the SAME project service every other door writes
 * through rather than a second creation path.
 */
export interface OrganizationCeremony {
  ensureDefaultAiToolCatalog(input: Readonly<{ organizationId: string }>): Promise<void>;
  createProject(
    input: Readonly<{
      organizationId: string;
      teamId: string;
      name: string;
      language: string;
      framework: string;
      userId: string;
    }>,
  ): Promise<Readonly<{ success: boolean; projectSlug: string }>>;
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
