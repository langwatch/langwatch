import type { OrganizationApi } from "@langwatch/organization-contract";
import type { PaginatedProjects, ProjectApi } from "@langwatch/project-contract";
import type { UserApi } from "@langwatch/user-contract";

/** One project of an organization, as the scope rule reads it. */
export type CodingAgentScopeProject = Readonly<{
  id: string;
  name: string;
  slug: string;
  teamId: string;
  /** Whether the project is one person's workspace rather than a shared one. */
  isPersonal: boolean;
}>;

/**
 * The organization's projects, and the person behind each personal workspace.
 * The project list is enumerated from the ORGANIZATION, never from a request,
 * so a caller cannot count a project by naming one it may not read.
 */
export interface CodingAgentCallerScopeDirectory {
  /** Every live project of one organization. */
  listOrganizationProjects(input: {
    organizationId: string;
  }): Promise<readonly CodingAgentScopeProject[]>;

  /**
   * Who each personal workspace belongs to, keyed by team id. Asked only for
   * personal teams, never a shared one — a shared team's members answer
   * nothing displays, so reading them would cost a query for nothing.
   */
  listPersonalTeamOwnerNames(input: {
    organizationId: string;
    teamIds: readonly string[];
  }): Promise<ReadonlyMap<string, string>>;
}

/** Same page size organization.app.ts reads an organization's projects at. */
const ORGANIZATION_PROJECT_PAGE_SIZE = 1_000;

/** Main `resolveCallerProjectScope.ts`: live projects and who owns each personal workspace. */
export class CodingAgentScopeDirectoryService implements CodingAgentCallerScopeDirectory {
  static create(peers: {
    projects: Pick<ProjectApi, "listByOrganization">;
    organizations: Pick<OrganizationApi, "findPersonalTeamOwners">;
    users: Pick<UserApi, "getProfiles">;
  }): CodingAgentScopeDirectoryService {
    return new CodingAgentScopeDirectoryService(peers.projects, peers.organizations, peers.users);
  }

  private constructor(
    private readonly projects: Pick<ProjectApi, "listByOrganization">,
    private readonly organizations: Pick<OrganizationApi, "findPersonalTeamOwners">,
    private readonly users: Pick<UserApi, "getProfiles">,
  ) {}

  async listOrganizationProjects({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<readonly CodingAgentScopeProject[]> {
    const first = await this.page({ organizationId, page: 1 });
    const projects = [...first.data];
    const pageCount = Math.ceil(first.pagination.total / ORGANIZATION_PROJECT_PAGE_SIZE);
    for (let page = 2; page <= pageCount; page++) {
      projects.push(...(await this.page({ organizationId, page })).data);
    }
    return projects.map((project) => ({
      id: project.id,
      name: project.name,
      slug: project.slug,
      teamId: project.teamId,
      isPersonal: project.isPersonal,
    }));
  }

  private page({
    organizationId,
    page,
  }: {
    organizationId: string;
    page: number;
  }): Promise<PaginatedProjects> {
    return this.projects.listByOrganization({
      organizationId,
      page,
      limit: ORGANIZATION_PROJECT_PAGE_SIZE,
    });
  }

  async listPersonalTeamOwnerNames({
    organizationId,
    teamIds,
  }: {
    organizationId: string;
    teamIds: readonly string[];
  }): Promise<ReadonlyMap<string, string>> {
    if (teamIds.length === 0) return new Map();
    const owners = await this.organizations.findPersonalTeamOwners({ organizationId, teamIds });
    const userIds = [
      ...new Set(owners.flatMap(({ ownerUserId }) => (ownerUserId ? [ownerUserId] : []))),
    ];
    if (userIds.length === 0) return new Map();
    const profiles = new Map(
      (await this.users.getProfiles({ userIds })).map((profile) => [profile.id, profile]),
    );

    const names = new Map<string, string>();
    for (const { teamId, ownerUserId } of owners) {
      const profile = ownerUserId ? profiles.get(ownerUserId) : undefined;
      const label = profile?.name?.trim() || profile?.email?.trim();
      if (label) names.set(teamId, label);
    }
    return names;
  }
}
