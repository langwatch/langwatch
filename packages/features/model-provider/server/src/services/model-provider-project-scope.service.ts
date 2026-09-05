import type { ModelDefaultScope } from "@langwatch/model-provider-contract";
import type { ModelCostProjectPort } from "../ports/model-provider.port";

export type ModelProviderProjectSystemContext = {
  scopes: ModelDefaultScope[];
  referenceCreatedAt: Date;
};

/**
 * The scope facts that come off a project row and nothing else.
 */
export class ModelProviderProjectScopeService {
  private constructor(private readonly projects: ModelCostProjectPort) {}

  static create(options: { projects: ModelCostProjectPort }): ModelProviderProjectScopeService {
    return new ModelProviderProjectScopeService(options.projects);
  }

  async getProjectScopes(projectId: string): Promise<ModelDefaultScope[]> {
    const project = await this.projects.getWithTeam(projectId);

    return projectScopes(project.id, project.teamId, project.team.organizationId);
  }

  async tryGetProjectScopes(projectId: string): Promise<ModelDefaultScope[] | null> {
    const project = await this.projects.tryGetWithTeam(projectId);

    return project ? projectScopes(project.id, project.teamId, project.team.organizationId) : null;
  }

  async getProjectSystemContext(projectId: string): Promise<ModelProviderProjectSystemContext> {
    const project = await this.projects.getWithTeam(projectId);

    return {
      scopes: projectScopes(project.id, project.teamId, project.team.organizationId),
      referenceCreatedAt: project.createdAt,
    };
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
