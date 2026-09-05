import type { AuthzService } from "@langwatch/authz-contract";
import type { ModelDefaultScope } from "@langwatch/model-provider-contract";

/** Every permission a model-provider scope check can name, read or write. */
type ModelProviderPermission =
  | ReturnType<typeof ModelProviderAuthorizationService.writePermission>
  | "organization:view"
  | "team:view"
  | "project:view";

/**
 * Whether an actor may read or write a model-provider scope.
 */
export class ModelProviderAuthorizationService {
  private constructor(private readonly authz: AuthzService) {}

  static create(authz: AuthzService): ModelProviderAuthorizationService {
    return new ModelProviderAuthorizationService(authz);
  }

  async canRead(actorId: string, scope: ModelDefaultScope): Promise<boolean> {
    return await this.permits(
      actorId,
      scope,
      ModelProviderAuthorizationService.readPermission(scope.scopeType),
    );
  }

  async canWrite(actorId: string, scope: ModelDefaultScope): Promise<boolean> {
    return await this.permits(
      actorId,
      scope,
      ModelProviderAuthorizationService.writePermission(scope.scopeType),
    );
  }

  /**
   * What writing this scope requires.
   */
  static writePermission(
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

  private static readPermission(
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

  private async permits(
    actorId: string,
    scope: ModelDefaultScope,
    permission: ModelProviderPermission,
  ): Promise<boolean> {
    const tier = scope.scopeType.toLowerCase() as "organization" | "team" | "project";
    const decision = await this.authz.getDecision({
      userId: actorId,
      permission,
      scope: { tier, id: scope.scopeId },
    });

    return decision.permitted;
  }
}
