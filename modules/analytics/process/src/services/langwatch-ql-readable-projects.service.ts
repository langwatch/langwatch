import type { LangWatchQLReadableProject } from "@langwatch/analytics-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { ProjectApi } from "@langwatch/project-contract";

type Dependencies = Readonly<{ authz: AuthzApi; projects: ProjectApi }>;

/** The projects a card's editor may offer a member: live ones in the project's organization. */
export class LangWatchQLReadableProjectsService {
  static create(dependencies: Dependencies): LangWatchQLReadableProjectsService {
    return new LangWatchQLReadableProjectsService(dependencies);
  }

  private constructor(private readonly dependencies: Dependencies) {}

  /** Archived and governance projects are left out, as are those without `analytics:view`. */
  async listFor({
    projectId,
    userId,
  }: {
    projectId: string;
    userId: string;
  }): Promise<LangWatchQLReadableProject[]> {
    const { authz, projects } = this.dependencies;
    const organizationId = await projects.findOrganizationId(projectId);
    if (organizationId === undefined) return [];

    const ids = await projects.findLiveNonGovernanceIdsByOrganization({ organizationId });
    if (ids.length === 0) return [];

    const identities = await projects.listNamesByIds({ projectIds: ids });
    const decided = await authz.canBatchByIds({
      principal: { type: "user", id: userId },
      permission: "analytics:view",
      organizationId,
      teams: [...new Set(identities.map(({ teamId }) => teamId))].map((teamId) => ({ teamId })),
      projects: identities.map(({ id, teamId }) => ({ projectId: id, teamId })),
    });

    return identities
      .filter(({ id }) => decided.projects.get(id) === true)
      .map(({ id, name }) => ({ id, name }));
  }
}
