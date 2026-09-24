// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** The project rows the CLI hands a credential for. */
export type GovernanceDirectoryProject = {
  id: string;
  slug: string;
  name: string;
  isPersonal: boolean;
  ownerUserId: string | null;
};

/**
 * The identity, membership and project rows the governance transports read
 * directly, behind one port so no transport names Prisma.
 */
/** Why a caller's seat is not active, or that it is. */
export type GovernanceMembershipStatus =
  | "active"
  | "user_missing"
  | "user_deactivated"
  | "not_org_member";

export interface GovernanceDirectoryRepository {
  membershipStatus(params: {
    userId: string;
    organizationId: string;
  }): Promise<GovernanceMembershipStatus>;

  findPersonProfile(userId: string): Promise<{ name: string | null; email: string | null } | null>;

  findOrganizationIdByProjectApiKey(apiKey: string): Promise<string | null>;

  findMemberIdByEmail(params: { email: string; organizationId: string }): Promise<string | null>;

  findLiveProjectBySlug(params: {
    slug: string;
    organizationId: string;
  }): Promise<(GovernanceDirectoryProject & { apiKey: string }) | null>;

  findLiveProjectByRef(params: {
    projectRef: string;
    organizationId: string;
  }): Promise<GovernanceDirectoryProject | null>;
}
