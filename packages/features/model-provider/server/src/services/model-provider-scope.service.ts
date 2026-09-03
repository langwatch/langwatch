import type { OrganizationService, OrganizationTeam } from "@langwatch/organization-contract";
import type { ModelDefaultScope } from "@langwatch/model-provider-contract";
import type { ProjectService } from "@langwatch/project-contract";
import {
  ModelProviderProjectScopeService,
  type ModelProviderProjectSystemContext,
} from "./model-provider-project-scope.service";

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

export type { ModelProviderProjectSystemContext };

export class ModelProviderScopeService {
  private constructor(
    private readonly projects: ProjectService,
    private readonly organizations: OrganizationService,
    private readonly projectScopeFacts: ModelProviderProjectScopeService,
  ) {}

  static create(options: {
    projects: ProjectService;
    organizations: OrganizationService;
  }): ModelProviderScopeService {
    return new ModelProviderScopeService(
      options.projects,
      options.organizations,
      ModelProviderProjectScopeService.create({ projects: options.projects }),
    );
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

  getProjectScopes(projectId: string): Promise<ModelDefaultScope[]> {
    return this.projectScopeFacts.getProjectScopes(projectId);
  }

  getProjectSystemContext(projectId: string): Promise<ModelProviderProjectSystemContext> {
    return this.projectScopeFacts.getProjectSystemContext(projectId);
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

  tryGetProjectScopes(projectId: string): Promise<ModelDefaultScope[] | null> {
    return this.projectScopeFacts.tryGetProjectScopes(projectId);
  }

  tryResolveAnchor(input: { projectId?: string; organizationId?: string }): Promise<string | null> {
    return this.projectScopeFacts.tryResolveAnchor(input);
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

  async listAvailableScopes(organizationId: string): Promise<ModelProviderAvailableScopes> {
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
