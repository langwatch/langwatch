import type { AuthzApi } from "@langwatch/authz-contract";

import type { CodingAgentScopeProject } from "./coding-agent-scope-directory.service.ts";

/** The two cuts a pull-request rollup is resolved over. */
export type CodingAgentScopePermission = "traces:view" | "cost:view";

// Cross-project cut resolver; API keys may narrow holder's access, so scope
// resolved from key's bindings, not holder's; SERVICE keys have no user.
export type CodingAgentScopeCaller =
  | { readonly kind: "user"; readonly userId: string }
  | { readonly kind: "apiKey"; readonly apiKeyId: string; readonly userId: string | null };

/** Batch permission resolution; absent answers deny. */
export interface CodingAgentScopePermissions {
  projectCuts(input: {
    caller: CodingAgentScopeCaller;
    organizationId: string;
    projects: readonly CodingAgentScopeProject[];
    permissions: readonly CodingAgentScopePermission[];
  }): Promise<ReadonlyMap<CodingAgentScopePermission, ReadonlySet<string>>>;
}

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
