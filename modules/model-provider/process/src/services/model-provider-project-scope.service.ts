import type { ModelDefaultScope } from "@langwatch/model-provider-contract";
import { ProjectNotFoundError, type ProjectWithTeam } from "@langwatch/project-contract";
import { fromDate, type Instant } from "@langwatch/time";

/**
 * The project read the scope facts are derived from, named narrowly rather than a whole
 * `ProjectApi` so a process that only prices a span doesn't also compose an authz service.
 */
export abstract class ModelCostProject {
  abstract findWithTeam(id: string): Promise<ProjectWithTeam | null>;
  abstract getWithTeam(id: string): Promise<ProjectWithTeam>;
}

/**
 * The scope derivation the cost listing asks for — answered by both
 * `ModelProviderProjectScopeService` and the wider `ModelProviderScopeService`
 * that composes it.
 */
export abstract class ModelCostProjectScope {
  abstract getProjectScopes(projectId: string): Promise<ModelDefaultScope[]>;
}

export type ModelProviderProjectSystemContext = {
  scopes: ModelDefaultScope[];
  referenceCreatedAt: Instant;
};

/**
 * The scope facts that come off a project row and nothing else.
 */
export class ModelProviderProjectScopeService {
  private constructor(private readonly projects: ModelCostProject) {}

  static create(options: { projects: ModelCostProject }): ModelProviderProjectScopeService {
    return new ModelProviderProjectScopeService(options.projects);
  }

  async getProjectScopes(projectId: string): Promise<ModelDefaultScope[]> {
    const project = await this.projects.getWithTeam(projectId);

    return projectScopes(project.id, project.teamId, project.team.organizationId);
  }

  async getProjectSystemContext(projectId: string): Promise<ModelProviderProjectSystemContext> {
    const project = await this.projects.getWithTeam(projectId);

    return {
      scopes: projectScopes(project.id, project.teamId, project.team.organizationId),
      referenceCreatedAt: fromDate(project.createdAt),
    };
  }

  async getAnchorOrganizationId(input: {
    projectId?: string;
    organizationId?: string;
  }): Promise<string> {
    if (input.organizationId) {
      return input.organizationId;
    }

    if (!input.projectId) {
      throw new ProjectNotFoundError();
    }

    const project = await this.projects.getWithTeam(input.projectId);

    return project.team.organizationId;
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
