import type {
  Organization,
  OrganizationInvite,
  OrganizationUser,
  OrganizationUserRole,
  RoleBindingScopeType,
} from "@langwatch/prisma-client/generated";

/** The columns a pending or payment-pending invite is written with. */
export type WriteInviteInput = {
  email: string;
  inviteCode: string;
  expiration: Date | null;
  organizationId: string;
  teamIds: string;
  teamAssignments?: unknown;
  role: OrganizationUserRole;
};

/** One listed invitation, with the admin who asked for it. */
export type InviteWithRequester = OrganizationInvite & {
  requestedByUser: { id: string; name: string | null; email: string | null } | null;
};

export type InviteWithOrganization = OrganizationInvite & {
  organization: Organization | null;
};

/**
 * The rows behind an organization's invitations: the invites themselves, and
 * the memberships, teams, custom roles and projects an invitation is validated
 * and settled against.
 */
export abstract class OrganizationInviteRepository {
  /**
   * Runs `write` inside one transaction, against a repository bound to it. A
   * batch's duplicate check and its insert commit together, and an acceptance
   * claims its row in the same transaction that writes the membership.
   */
  abstract withTransaction<T>(
    write: (transaction: OrganizationInviteRepository) => Promise<T>,
    options?: { timeoutMs: number; maxWaitMs: number },
  ): Promise<T>;

  abstract tryFindOpenInviteForEmail(input: {
    email: string;
    organizationId: string;
  }): Promise<OrganizationInvite | null>;
  /** The stored address of the first of these that is already a member. */
  abstract tryFindMemberEmail(input: {
    organizationId: string;
    emails: string[];
  }): Promise<string | null>;
  abstract findTeamIdsInOrganization(input: {
    teamIds: string[];
    organizationId: string;
  }): Promise<string[]>;
  /** Each custom role in the organization with its stored `permissions` value. */
  abstract findCustomRolePermissions(input: {
    organizationId: string;
  }): Promise<Array<{ id: string; permissions: unknown }>>;
  abstract tryFindOrganization(input: { organizationId: string }): Promise<Organization | null>;
  /** The organization with its membership rows, as the batch path reports it back. */
  abstract tryFindOrganizationWithMembers(input: {
    organizationId: string;
  }): Promise<(Organization & { members: OrganizationUser[] }) | null>;
  /** The personal team a set of role-binding scopes reaches, by its owner's name for it. */
  abstract findPersonalTeamInScopes(input: {
    scopes: Array<{ scopeType: RoleBindingScopeType; scopeId: string }>;
  }): Promise<{ name: string } | null>;

  abstract createPendingInvite(input: WriteInviteInput): Promise<OrganizationInvite>;
  abstract createPaymentPendingInvite(
    input: WriteInviteInput & { subscriptionId: string },
  ): Promise<OrganizationInvite>;
  abstract findListableInvites(input: {
    organizationId: string;
  }): Promise<InviteWithRequester[]>;
  /** Answers how many rows moved; zero means the invite was not open. */
  abstract revokeOpenInvite(input: {
    inviteId: string;
    organizationId: string;
  }): Promise<number>;
  abstract tryFindInviteWithOrganization(input: {
    inviteId: string;
    organizationId: string;
  }): Promise<InviteWithOrganization | null>;
  /**
   * Rotates a pending invite's code, conditional on the code the caller read.
   * Answers how many rows moved; zero means it rotated under them.
   */
  abstract rotateInviteCode(input: {
    inviteId: string;
    organizationId: string;
    expectedInviteCode: string;
    inviteCode: string;
    expiration: Date;
  }): Promise<number>;
  abstract tryFindInviteByCodeWithOrganization(input: {
    inviteCode: string;
  }): Promise<InviteWithOrganization | null>;
  abstract findAdminEmails(input: { organizationId: string }): Promise<string[]>;
  abstract tryFindProjectSlugForTeams(input: { teamIds: string[] }): Promise<string | null>;
  abstract tryFindProjectSlugInOrganization(input: {
    organizationId: string;
  }): Promise<string | null>;
  abstract tryFindPendingInviteForEmail(input: {
    organizationId: string;
    email: string;
  }): Promise<OrganizationInvite | null>;
  /**
   * Claims a pending invite for one acceptor, conditional on the (status,
   * code, expiry) the caller read. Answers how many rows moved; zero means
   * somebody else's accept won the race.
   */
  abstract claimInviteForAcceptance(input: {
    inviteId: string;
    organizationId: string;
    inviteCode: string;
    acceptedByUserId: string;
    acceptedViaIdentifierId: string | null;
  }): Promise<number>;
  abstract addMembership(input: {
    userId: string;
    organizationId: string;
    role: OrganizationUserRole;
  }): Promise<void>;
  abstract tryFindInviteStatus(input: { inviteId: string }): Promise<{ status: string } | null>;
  abstract hasMembership(input: { userId: string; organizationId: string }): Promise<boolean>;
  abstract findPaymentPendingInvites(input: {
    subscriptionId: string;
    organizationId: string;
  }): Promise<InviteWithOrganization[]>;
  abstract approvePaymentPendingInvite(input: {
    inviteId: string;
    organizationId: string;
    expiration: Date;
  }): Promise<OrganizationInvite>;
}
