/**
 * What one caller may do at each tier of the privacy scope chain. The read side
 * advertises a scope as writable using EXACTLY these answers, so the chip
 * picker can never offer a scope the save then rejects. The batched shapes are
 * batched because an organization's project list is every project it holds.
 */
import type { AuthzApi } from "@langwatch/authz-contract";

export class DataPrivacyPermissionsService {
  static create(options: { authz: AuthzApi }): DataPrivacyPermissionsService {
    return new DataPrivacyPermissionsService(options.authz);
  }

  private constructor(private readonly authz: AuthzApi) {}

  canManageOrganization(input: { userId: string; organizationId: string }): Promise<boolean> {
    return this.authz.hasPermission({
      userId: input.userId,
      permission: "organization:manage",
      organizationId: input.organizationId,
    });
  }

  /** `team:manage` per id, in a map keyed by the id asked for. */
  async canManageTeams(input: {
    userId: string;
    organizationId: string;
    teamIds: readonly string[];
  }): Promise<ReadonlyMap<string, boolean>> {
    if (input.teamIds.length === 0) return new Map();

    const decided = await this.authz.canBatchByIds({
      principal: { type: "user", id: input.userId },
      permission: "team:manage",
      organizationId: input.organizationId,
      teams: input.teamIds.map((teamId) => ({ teamId })),
      projects: [],
    });

    return decided.teams;
  }

  /** `project:update` per id, in a map keyed by the id asked for. */
  async canUpdateProjects(input: {
    userId: string;
    organizationId: string | null;
    projectIds: readonly string[];
  }): Promise<ReadonlyMap<string, boolean>> {
    if (input.projectIds.length === 0) return new Map();

    // A personal-account project has no organization, and the batched read is
    // organization-shaped. One probe per id is exact there, and the list is
    // never longer than one.
    if (!input.organizationId) {
      const decided = await Promise.all(
        input.projectIds.map(
          async (projectId) =>
            [
              projectId,
              await this.authz.hasPermission({
                userId: input.userId,
                permission: "project:update",
                projectId,
              }),
            ] as const,
        ),
      );

      return new Map(decided);
    }

    const decided = await this.authz.canBatchByIds({
      principal: { type: "user", id: input.userId },
      permission: "project:update",
      organizationId: input.organizationId,
      teams: [],
      projects: input.projectIds.map((projectId) => ({ projectId })),
    });

    return decided.projects;
  }
}
