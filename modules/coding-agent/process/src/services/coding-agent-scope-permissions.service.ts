import type { AuthzApi } from "@langwatch/authz-contract";

import type {
  CodingAgentScopeCaller,
  CodingAgentScopePermission,
  CodingAgentScopePermissions,
  CodingAgentScopeProject,
} from "../app/coding-agent.members.ts";

/** Both permission cuts in ONE batched ask, decided off a single grant snapshot. */
export class CodingAgentScopePermissionsService implements CodingAgentScopePermissions {
  static create(peers: {
    authz: Pick<AuthzApi, "canBatchPermissionsByIds">;
  }): CodingAgentScopePermissionsService {
    return new CodingAgentScopePermissionsService(peers.authz);
  }

  private constructor(private readonly authz: Pick<AuthzApi, "canBatchPermissionsByIds">) {}

  async projectCuts(input: {
    caller: CodingAgentScopeCaller;
    organizationId: string;
    projects: readonly CodingAgentScopeProject[];
    permissions: readonly CodingAgentScopePermission[];
  }): Promise<ReadonlyMap<CodingAgentScopePermission, ReadonlySet<string>>> {
    const { byPermission } = await this.authz.canBatchPermissionsByIds({
      principal:
        input.caller.kind === "user"
          ? { type: "user", id: input.caller.userId }
          : { type: "apiKey", id: input.caller.apiKeyId },
      permissions: [...input.permissions],
      organizationId: input.organizationId,
      teams: [],
      projects: input.projects.map((project) => ({
        projectId: project.id,
        teamId: project.teamId,
      })),
    });

    return new Map(
      input.permissions.map((permission) => [
        permission,
        new Set(
          [...(byPermission.get(permission)?.projects ?? new Map<string, boolean>())]
            .filter(([, allowed]) => allowed)
            .map(([projectId]) => projectId),
        ),
      ]),
    );
  }
}
