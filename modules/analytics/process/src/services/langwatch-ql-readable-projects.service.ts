import {
  LangWatchQLProjectNotFoundError,
  type LangWatchQLReadableProject,
} from "@langwatch/analytics-contract";
import { LWQL_MAX_MEMBER_PROJECTS } from "@langwatch/analytics-contract/langwatch-ql-limits";
import type { AuthzApi } from "@langwatch/authz-contract";
import { ValidationError } from "@langwatch/handled-error";
import type { ProjectApi } from "@langwatch/project-contract";

import { inStableOrder } from "../rules/langwatch-ql-project-selection.rules.ts";

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

  /**
   * What `projects: "all"` stands for a member: the ids `listFor` offers, in id order.
   * @throws {LangWatchQLProjectNotFoundError} when none, or no member is known.
   * @throws {ValidationError} when more than a member's list may hold.
   */
  async allIdsFor({
    projectId,
    userId,
  }: {
    projectId: string;
    userId: string | undefined;
  }): Promise<string[]> {
    if (userId === undefined) throw new LangWatchQLProjectNotFoundError();
    const ids = inStableOrder(await this.listFor({ projectId, userId })).map(({ id }) => id);
    if (ids.length === 0) throw new LangWatchQLProjectNotFoundError();
    if (ids.length > LWQL_MAX_MEMBER_PROJECTS) {
      throw new ValidationError(
        `You can read ${ids.length} projects, more than the ${LWQL_MAX_MEMBER_PROJECTS} one run ` +
          `may read with "all". Name up to ${LWQL_MAX_MEMBER_PROJECTS} of them in \`projects\`.`,
      );
    }

    return ids;
  }
}
