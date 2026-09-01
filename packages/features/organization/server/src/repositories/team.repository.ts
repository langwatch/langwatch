import type {
  OrganizationTeam,
  OrganizationTeamPage,
} from "@langwatch/organization-contract";

export abstract class TeamRepository {
  abstract get(input: {
    teamId: string;
    organizationId: string;
  }): Promise<OrganizationTeam>;
  abstract getById(teamId: string): Promise<OrganizationTeam>;
  /**
   * The organization that owns one team, or null when no such team exists.
   *
   * Unlike {@link getById} this does not exclude archived teams: a project
   * whose team has been archived still belongs to its tenant, and the callers
   * are metering and personal-workspace reads that must place it there.
   */
  abstract tryGetOrganizationId(input: { teamId: string }): Promise<string | null>;
  abstract getBySlug(input: {
    slug: string;
    organizationId: string;
  }): Promise<OrganizationTeam>;
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
  abstract archive(input: {
    teamId: string;
    organizationId: string;
  }): Promise<OrganizationTeam>;
  abstract getOrganizationMembers(input: {
    userIds: string[];
    organizationId: string;
    activeOnly?: boolean;
  }): Promise<string[]>;
  abstract fenceMembershipChange(input: {
    teamId: string;
    organizationId: string;
    expectedUpdatedAt: Date;
    name?: string;
    removeLegacyUserId?: string;
  }): Promise<OrganizationTeam>;
}
