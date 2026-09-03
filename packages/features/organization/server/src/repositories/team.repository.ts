import type { OrganizationTeam, OrganizationTeamPage } from "@langwatch/organization-contract";

export abstract class TeamRepository {
  abstract get(input: { teamId: string; organizationId: string }): Promise<OrganizationTeam>;
  abstract getById(teamId: string): Promise<OrganizationTeam>;
  /**
   * The organization that owns one team, or null when no such team exists.
   *
   * Unlike {@link getById} this does not exclude archived teams: a project
   * whose team has been archived still belongs to its tenant, and the callers
   * are metering and personal-workspace reads that must place it there.
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
   * Which of the named organizations this person belongs to, in one read.
   *
   * Answering "is this person a member" one organization at a time put a query
   * on the path of every organization a switcher lists, which is a query per
   * row on a page whose whole job is to list them. Input order is preserved
   * and a non-membership is simply absent, so the answer cannot be read as a
   * membership oracle for organizations the caller does not belong to.
   */
  abstract memberOrganizationIds(input: {
    userId: string;
    organizationIds: string[];
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
