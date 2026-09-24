import type {
  Organization,
  OrganizationInvite,
  OrganizationUser,
  OrganizationUserRole,
  RoleBindingScopeType,
} from "@langwatch/organization-contract";

/** The columns a pending or payment-pending invite is written with. */
export type WriteInviteInput = {
  email: string;
  inviteCode: string;
  expiration: OrganizationInvite["expiration"];
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

  /** Whether the address holds a pending or payment-pending invite that has not expired. */
  abstract hasOpenInviteForEmail(input: {
    email: string;
    organizationId: string;
  }): Promise<boolean>;
  /** The stored address of each of these that is already a member. */
  abstract findMemberEmails(input: { organizationId: string; emails: string[] }): Promise<string[]>;
  abstract findTeamIdsInOrganization(input: {
    teamIds: string[];
    organizationId: string;
  }): Promise<string[]>;
  /** Each custom role in the organization with its stored `permissions` value. */
  abstract findCustomRolePermissions(input: {
    organizationId: string;
  }): Promise<{ id: string; permissions: unknown }[]>;
  /** Throws `OrganizationNotFoundError`. */
  abstract getOrganization(input: { organizationId: string }): Promise<Organization>;
  /** The organization with its membership rows; throws `OrganizationNotFoundError`. */
  abstract getOrganizationWithMembers(input: {
    organizationId: string;
  }): Promise<Organization & { members: OrganizationUser[] }>;
  /** The personal teams a set of role-binding scopes reaches, by each owner's name for it. */
  abstract findPersonalTeamsInScopes(input: {
    scopes: { scopeType: RoleBindingScopeType; scopeId: string }[];
  }): Promise<{ name: string }[]>;

  abstract createPendingInvite(input: WriteInviteInput): Promise<OrganizationInvite>;
  abstract createPaymentPendingInvite(
    input: WriteInviteInput & { subscriptionId: string },
  ): Promise<OrganizationInvite>;
  abstract findListableInvites(input: { organizationId: string }): Promise<InviteWithRequester[]>;
  /** Answers how many rows moved; zero means the invite was not open. */
  abstract revokeOpenInvite(input: { inviteId: string; organizationId: string }): Promise<number>;
  /** Throws `InviteNotFoundError`. */
  abstract getInviteWithOrganization(input: {
    inviteId: string;
    organizationId: string;
  }): Promise<InviteWithOrganization>;
  /**
   * Rotates a pending invite's code, conditional on the code the caller read.
   * Answers how many rows moved; zero means it rotated under them.
   */
  abstract rotateInviteCode(input: {
    inviteId: string;
    organizationId: string;
    expectedInviteCode: string;
    inviteCode: string;
    expiration: NonNullable<OrganizationInvite["expiration"]>;
  }): Promise<number>;
  /**
   * Extends a pending invite's expiration without rotating its code — so
   * the link already in the inbox starts working again. Zero rows moved
   * means the invite was not (still) pending.
   */
  abstract extendInviteExpiration(input: {
    inviteId: string;
    organizationId: string;
    expiration: NonNullable<OrganizationInvite["expiration"]>;
  }): Promise<number>;
  /** Throws `InviteNotFoundError`. */
  abstract getInviteByCodeWithOrganization(input: {
    inviteCode: string;
  }): Promise<InviteWithOrganization>;
  abstract findAdminEmails(input: { organizationId: string }): Promise<string[]>;
  /** The live projects' slugs in these teams. */
  abstract findProjectSlugsForTeams(input: { teamIds: string[] }): Promise<string[]>;
  /** The live projects' slugs in the organization's live teams. */
  abstract findProjectSlugsInOrganization(input: { organizationId: string }): Promise<string[]>;
  /** A pending, unexpired invite for the address; throws `InviteNotFoundError`. */
  abstract getPendingInviteForEmail(input: {
    organizationId: string;
    email: string;
  }): Promise<OrganizationInvite>;
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
  /** Throws `InviteNotFoundError`. */
  abstract getInviteStatus(input: { inviteId: string }): Promise<{ status: string }>;
  abstract hasMembership(input: { userId: string; organizationId: string }): Promise<boolean>;
  abstract findPaymentPendingInvites(input: {
    subscriptionId: string;
    organizationId: string;
  }): Promise<InviteWithOrganization[]>;
  abstract approvePaymentPendingInvite(input: {
    inviteId: string;
    organizationId: string;
    expiration: NonNullable<OrganizationInvite["expiration"]>;
  }): Promise<OrganizationInvite>;
}
