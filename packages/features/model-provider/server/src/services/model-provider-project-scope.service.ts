import type { ModelDefaultScope } from "@langwatch/model-provider-contract";
import type { ModelCostProjectPort } from "../ports/model-provider.port";

export type ModelProviderProjectSystemContext = {
  scopes: ModelDefaultScope[];
  referenceCreatedAt: Date;
};

/**
 * The scope facts that come off a project row and nothing else.
 *
 * A Model Provider scope is the triple `PROJECT` / `TEAM` / `ORGANIZATION`,
 * and every id in it is on the project read with its team. These four
 * derivations were methods of `ModelProviderScopeService`, which still answers
 * them — it composes this and delegates, so there is one implementation and no
 * twin to drift — but they are separated from the four that are left there,
 * which resolve a billing profile, list an organization's teams or page its
 * projects. Those are organization questions; a project's own row is the whole
 * of this one.
 *
 * That separation is what lets a process compose the cost listing. Ingestion
 * prices a span against a project's own cost rules; deriving the scopes those
 * rules are stored under used to require an organization service the process
 * has no other reason to build.
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
