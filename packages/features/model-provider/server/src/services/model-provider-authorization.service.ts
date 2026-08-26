import type { AuthzService } from "@langwatch/authz-contract";
import type { ModelDefaultScope } from "@langwatch/model-provider-contract";

/** Private adapter over the complete Authz contract for Model Provider reads. */
export class ModelProviderAuthorizationService {
  private constructor(private readonly authz: AuthzService) {}

  static create(authz: AuthzService): ModelProviderAuthorizationService {
    return new ModelProviderAuthorizationService(authz);
  }

  async canRead(actorId: string, scope: ModelDefaultScope): Promise<boolean> {
    const permission = readPermission(scope.scopeType);
    const tier = scope.scopeType.toLowerCase() as "organization" | "team" | "project";
    const decision = await this.authz.getDecision({
      userId: actorId,
      permission,
      scope: { tier, id: scope.scopeId },
    });
    return decision.permitted;
  }

  async canWrite(actorId: string, scope: ModelDefaultScope): Promise<boolean> {
    const permission = writePermission(scope.scopeType);
    const tier = scope.scopeType.toLowerCase() as "organization" | "team" | "project";
    const decision = await this.authz.getDecision({
      userId: actorId,
      permission,
      scope: { tier, id: scope.scopeId },
    });
    return decision.permitted;
  }
}

function readPermission(
  scopeType: ModelDefaultScope["scopeType"],
): "organization:view" | "team:view" | "project:view" {
  if (scopeType === "ORGANIZATION") {
    return "organization:view";
  }
  if (scopeType === "TEAM") {
    return "team:view";
  }
  return "project:view";
}

function writePermission(
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
