import type {
  OrganizationService,
  OrganizationTeam,
} from "@langwatch/organization-contract";
import type { ModelDefaultScope } from "@langwatch/model-provider-contract";
import type { ProjectService } from "@langwatch/project-contract";

type ScopeReference = { id: string; name: string };

export type ModelProviderProjectContext = {
  projectId: string;
  projectName: string;
  teamId: string;
  organizationId: string;
  organizationName: string;
};

export type ModelProviderAvailableScopes = {
  organization: ScopeReference;
  teams: ScopeReference[];
  projects: Array<ScopeReference & { teamId: string }>;
};

export type ModelProviderProjectSystemContext = {
  scopes: ModelDefaultScope[];
  referenceCreatedAt: Date;
};

export class ModelProviderScopeService {
  private constructor(
    private readonly projects: ProjectService,
    private readonly organizations: OrganizationService,
  ) {}

  static create(options: {
    projects: ProjectService;
    organizations: OrganizationService;
  }): ModelProviderScopeService {
    return new ModelProviderScopeService(options.projects, options.organizations);
  }

  async getProjectContext(projectId: string): Promise<ModelProviderProjectContext> {
    const project = await this.projects.getWithTeam(projectId);
    const organization = await this.organizations.getBillingProfile({
      organizationId: project.team.organizationId,
    });

    return {
      projectId: project.id,
      projectName: project.name,
      teamId: project.teamId,
      organizationId: organization.id,
      organizationName: organization.name,
    };
  }

  async getProjectScopes(projectId: string): Promise<ModelDefaultScope[]> {
    const project = await this.projects.getWithTeam(projectId);
    return projectScopes(project.id, project.teamId, project.team.organizationId);
  }

  async getProjectSystemContext(
    projectId: string,
  ): Promise<ModelProviderProjectSystemContext> {
    const project = await this.projects.getWithTeam(projectId);

    return {
      scopes: projectScopes(project.id, project.teamId, project.team.organizationId),
      referenceCreatedAt: project.createdAt,
    };
  }

  async tryGetOrganizationSystemReference(organizationId: string): Promise<Date | null> {
    const firstPage = await this.projects.listByOrganization({
      organizationId,
      page: 1,
      limit: 1,
    });
    if (firstPage.pagination.total === 0) {
      return null;
    }
    if (firstPage.pagination.total === 1) {
      return firstPage.data[0]?.createdAt ?? null;
    }

    const lastPage = await this.projects.listByOrganization({
      organizationId,
      page: firstPage.pagination.total,
      limit: 1,
    });
    return lastPage.data[0]?.createdAt ?? null;
  }

  async tryGetProjectScopes(projectId: string): Promise<ModelDefaultScope[] | null> {
    const project = await this.projects.tryGetWithTeam(projectId);
    return project
      ? projectScopes(project.id, project.teamId, project.team.organizationId)
      : null;
  }

  async tryResolveAnchor(input: {
    projectId?: string;
    organizationId?: string;
  }): Promise<string | null> {
    if (input.organizationId) {
      return input.organizationId;
    }
    if (!input.projectId) {
      return null;
    }

    const project = await this.projects.tryGetWithTeam(input.projectId);
    return project?.team.organizationId ?? null;
  }

  async getOrganizationIdForScope(scope: ModelDefaultScope): Promise<string> {
    if (scope.scopeType === "ORGANIZATION") {
      const organization = await this.organizations.getBillingProfile({
        organizationId: scope.scopeId,
      });
      return organization.id;
    }
    if (scope.scopeType === "TEAM") {
      const team = await this.organizations.getTeamById({ teamId: scope.scopeId });
      return team.organizationId;
    }

    const project = await this.projects.getWithTeam(scope.scopeId);
    return project.team.organizationId;
  }

  async getOrganizationIdForScopes(scopes: ModelDefaultScope[]): Promise<string> {
    if (scopes.length === 0) {
      throw new Error("At least one Model Provider scope is required");
    }

    const organizationIds = await Promise.all(
      scopes.map((scope) => this.getOrganizationIdForScope(scope)),
    );
    const organizationId = organizationIds[0];
    if (
      organizationId === void 0 ||
      organizationIds.some((candidate) => candidate !== organizationId)
    ) {
      throw new Error("Model Provider scopes must belong to one organization");
    }

    return organizationId;
  }

  async listAvailableScopes(
    organizationId: string,
  ): Promise<ModelProviderAvailableScopes> {
    const [organization, teams, projectIds] = await Promise.all([
      this.organizations.getBillingProfile({ organizationId }),
      this.listTeams(organizationId),
      this.projects.listIdsByOrganization({ organizationId }),
    ]);
    const projects = await this.projects.listNamesByIds({ projectIds });

    return {
      organization: { id: organization.id, name: organization.name },
      teams: teams
        .map(({ id, name }) => ({ id, name }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      projects: projects
        .map(({ id, name, teamId }) => ({ id, name, teamId }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    };
  }

  private async listTeams(organizationId: string): Promise<OrganizationTeam[]> {
    const teams: OrganizationTeam[] = [];
    const limit = 1_000;
    let page = 1;

    while (true) {
      const result = await this.organizations.listTeams({
        organizationId,
        page,
        limit,
      });
      teams.push(...result.data);
      if (teams.length >= result.pagination.total) {
        return teams;
      }

      page += 1;
    }
  }
}

function projectScopes(
  projectId: string,
  teamId: string,
  organizationId: string,
): ModelDefaultScope[] {
  return [
    { scopeType: "PROJECT", scopeId: projectId },
    { scopeType: "TEAM", scopeId: teamId },
    { scopeType: "ORGANIZATION", scopeId: organizationId },
  ];
}
