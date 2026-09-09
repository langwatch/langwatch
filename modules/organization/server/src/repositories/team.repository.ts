import type {
  OrganizationTeam,
  OrganizationTeamPage,
  Team,
} from "@langwatch/organization-contract";

export abstract class TeamRepository {
  abstract get(input: { teamId: string; organizationId: string }): Promise<OrganizationTeam>;
  abstract getById(teamId: string): Promise<OrganizationTeam>;
  /**
   * The organization that owns one team, or null when none exists. Unlike {@link getById}, does
   * not exclude archived teams — a project's archived team still belongs to its tenant.
   */
  abstract tryGetOrganizationId(input: { teamId: string }): Promise<string | null>;
  abstract getBySlug(input: { slug: string; organizationId: string }): Promise<OrganizationTeam>;
  abstract list(input: {
    organizationId: string;
    page: number;
    limit: number;
  }): Promise<OrganizationTeamPage>;
  abstract tryFindBySlug(input: {
    slug: string;
    organizationId: string;
  }): Promise<OrganizationTeam | null>;
  abstract listActive(input: {
    organizationId: string;
    visibleToUserId?: string;
  }): Promise<OrganizationTeam[]>;
  abstract create(input: {
    teamId: string;
    name: string;
    slug: string;
    organizationId: string;
  }): Promise<OrganizationTeam>;
  abstract update(input: {
    teamId: string;
    organizationId: string;
    name?: string;
  }): Promise<OrganizationTeam>;
  abstract archive(input: { teamId: string; organizationId: string }): Promise<OrganizationTeam>;
  abstract getOrganizationMembers(input: {
    userIds: string[];
    organizationId: string;
    activeOnly?: boolean;
  }): Promise<string[]>;
  /**
   * Which of the named organizations this person belongs to, in one read — avoiding a
   * per-organization membership query on every row of a switcher listing.
   */
  abstract memberOrganizationIds(input: {
    userId: string;
    organizationIds: string[];
    activeOnly?: boolean;
  }): Promise<string[]>;

  abstract fenceMembershipChange(input: {
    teamId: string;
    organizationId: string;
    expectedUpdatedAt: Team["updatedAt"];
    name?: string;
    removeLegacyUserId?: string;
  }): Promise<OrganizationTeam>;
}
