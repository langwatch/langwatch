/** The erased person, as far as the erasure reads them. */
export type GdprUser = Readonly<{ id: string }>;
export type GdprOrganizationRow = { id: string; name: string };
export type GdprOrganizationWithMemberCount = GdprOrganizationRow & {
  _count: { members: number };
};
export type GdprProjectRow = { id: string; name: string; slug: string; teamId: string | null };

/**
 * The read/erase surface `runGdprUserDataErase` needs: named cross-tenant
 * queries plus the one cross-table erase transaction.
 */
export interface GdprUserDataEraseRepository {
  findUserByEmail(email: string): Promise<GdprUser | null>;
  findUserById(id: string): Promise<GdprUser | null>;
  findSoleOwnedOrganizations(userId: string): Promise<GdprOrganizationRow[]>;
  findSharedOrganizations(userId: string): Promise<GdprOrganizationWithMemberCount[]>;
  findSoleOwnedTeams(userId: string): Promise<GdprOrganizationRow[]>;
  findSharedTeams(userId: string): Promise<GdprOrganizationWithMemberCount[]>;
  findProjectsUnderTeams(teamIds: string[]): Promise<GdprProjectRow[]>;
  findSharedOrgsWhereUserIsSoleAdmin(userId: string): Promise<GdprOrganizationRow[]>;
  countOtherAdmins(input: { organizationId: string; userId: string }): Promise<number>;
  findTeamsUnderSoleOrgsWithOtherMembers(input: {
    organizationIds: string[];
    userId: string;
  }): Promise<GdprOrganizationRow[]>;
  eraseUserAndOwnedResources(input: {
    userId: string;
    projectIds: string[];
    soleOwnedTeamIds: string[];
    soleOwnedOrgIds: string[];
  }): Promise<void>;
}
