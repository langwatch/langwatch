import type { LangWatchQLReadableProject } from "@langwatch/analytics-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { ProjectApi } from "@langwatch/project-contract";

type Dependencies = Readonly<{
  authz: Pick<AuthzApi, "hasPermission">;
  projects: Pick<
    ProjectApi,
    "findOrganizationId" | "findLiveNonGovernanceIdsByOrganization" | "listNamesByIds"
  >;
}>;

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
    const readable: string[] = [];
    for (const id of ids) {
      const allowed = await authz.hasPermission({
        userId,
        permission: "analytics:view",
        projectId: id,
      });
      if (allowed) readable.push(id);
    }
    if (readable.length === 0) return [];

    const named = await projects.listNamesByIds({ projectIds: readable });

    return named.map(({ id, name }) => ({ id, name }));
  }
}
