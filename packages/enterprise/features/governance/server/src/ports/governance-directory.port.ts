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

export abstract class GovernanceDirectoryPort {
  abstract membershipStatus(params: {
    userId: string;
    organizationId: string;
  }): Promise<GovernanceMembershipStatus>;

  abstract tryFindPersonProfile(
    userId: string,
  ): Promise<{ name: string | null; email: string | null } | null>;

  abstract tryFindOrganizationIdByProjectApiKey(apiKey: string): Promise<string | null>;

  abstract tryFindMemberIdByEmail(params: {
    email: string;
    organizationId: string;
  }): Promise<string | null>;

  abstract tryFindLiveProjectBySlug(params: {
    slug: string;
    organizationId: string;
  }): Promise<(GovernanceDirectoryProject & { apiKey: string }) | null>;

  abstract tryFindLiveProjectByRef(params: {
    projectRef: string;
    organizationId: string;
  }): Promise<GovernanceDirectoryProject | null>;
}
