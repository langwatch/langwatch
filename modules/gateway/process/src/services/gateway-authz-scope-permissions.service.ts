import type { AuthzPermission } from "@langwatch/authorization";
import type { ApiKeyPermissionScope, AuthzApi } from "@langwatch/authz-contract";

import type {
  GatewayPermissionScope,
  GatewayScopePermissions,
} from "./virtual-key-authorization.service.ts";

/**
 * The two questions a virtual-key write is authorized by, answered from the
 * process's own AuthZ application rather than from role rows this package can
 * see: the gateway holds no membership or grant table of its own.
 */
export class GatewayAuthzScopePermissionsService implements GatewayScopePermissions {
  static create(authz: AuthzApi): GatewayAuthzScopePermissionsService {
    return new GatewayAuthzScopePermissionsService(authz);
  }

  private constructor(private readonly authz: AuthzApi) {}

  sessionHolds(input: {
    userId: string;
    permission: AuthzPermission;
    scope: GatewayPermissionScope;
  }): Promise<boolean> {
    const scope = authzScopeOf(input.scope);

    return this.authz.hasPermission({
      userId: input.userId,
      permission: input.permission,
      ...scope,
    });
  }

  apiKeyHolds(input: {
    apiKeyId: string;
    userId: string | null;
    organizationId: string;
    permission: AuthzPermission;
    scope: GatewayPermissionScope;
  }): Promise<boolean> {
    return this.authz.hasApiKeyPermission({
      apiKeyId: input.apiKeyId,
      userId: input.userId,
      organizationId: input.organizationId,
      permission: input.permission,
      // Structurally the same union, restated by the AuthZ contract under its
      // own name. Named rather than cast so a divergence is a compile error.
      scope: input.scope satisfies ApiKeyPermissionScope,
    });
  }
}

/**
 * A project credential stands in for someone working in its project, so it
 * sees organization-scoped keys, its own team's keys and its own project's —
 * and not a sibling team's. The same rule the tRPC list applies to a member.
 */
function authzScopeOf(scope: GatewayPermissionScope) {
  if (scope.type === "org") return { organizationId: scope.id };
  return scope.type === "team" ? { teamId: scope.id } : { projectId: scope.id };
}
