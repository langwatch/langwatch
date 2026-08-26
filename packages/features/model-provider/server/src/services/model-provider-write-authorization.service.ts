import {
  ModelDefaultScopeForbiddenError,
  ModelProviderScopeForbiddenError,
  type ModelDefaultScope,
} from "@langwatch/model-provider-contract";
import type { AuthzService } from "@langwatch/authz-contract";

/** Shared write check for the model-provider's provider and default commands. */
export class ModelProviderWriteAuthorizationService {
  private constructor(private readonly authorization: AuthzService) {}

  static create(authorization: AuthzService): ModelProviderWriteAuthorizationService {
    return new ModelProviderWriteAuthorizationService(authorization);
  }

  async assertCanWrite(actorId: string, scopes: ModelDefaultScope[]): Promise<void> {
    await this.assertScopes(actorId, scopes, "provider");
  }

  async assertCanWriteDefault(
    actorId: string,
    scopes: ModelDefaultScope[],
  ): Promise<void> {
    await this.assertScopes(actorId, scopes, "default");
  }

  private async assertScopes(
    actorId: string,
    scopes: ModelDefaultScope[],
    target: "provider" | "default",
  ): Promise<void> {
    const uniqueScopes = new Map(
      scopes.map((scope) => [`${scope.scopeType}:${scope.scopeId}`, scope]),
    );
    for (const scope of uniqueScopes.values()) {
      const allowed = await canManageScope(this.authorization, actorId, scope);
      if (allowed) {
        continue;
      }

      const input = {
        scopeType: scope.scopeType,
        requiredPermission: requiredPermission(scope.scopeType),
      };
      if (target === "default") {
        throw new ModelDefaultScopeForbiddenError(input);
      }
      throw new ModelProviderScopeForbiddenError(input);
    }
  }
}

async function canManageScope(
  authorization: AuthzService,
  actorId: string,
  scope: ModelDefaultScope,
): Promise<boolean> {
  const permission = requiredPermission(scope.scopeType);
  const tier = scope.scopeType.toLowerCase() as "organization" | "team" | "project";
  const decision = await authorization.getDecision({
    userId: actorId,
    permission,
    scope: { tier, id: scope.scopeId },
  });
  return decision.permitted;
}

function requiredPermission(
  scopeType: ModelDefaultScope["scopeType"],
): "organization:manage" | "team:manage" | "project:update" {
  if (scopeType === "ORGANIZATION") {
    return "organization:manage";
  }
  if (scopeType === "TEAM") {
    return "team:manage";
  }

  return "project:update";
}
