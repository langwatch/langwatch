import {
  ModelDefaultScopeForbiddenError,
  ModelProviderScopeForbiddenError,
  type ModelDefaultScope,
} from "@langwatch/model-provider-contract";
import { ModelProviderAuthorizationService } from "./model-provider-authorization.service";

/**
 * Shared write check for the model-provider's provider and default commands.
 *
 * The refusing counterpart to {@link ModelProviderAuthorizationService}: that
 * one answers whether a write is allowed, this one throws the error the
 * command surfaces. It delegates rather than re-deciding, because a check that
 * refuses and a check that answers must never be able to disagree.
 */
export class ModelProviderWriteAuthorizationService {
  private constructor(private readonly authorization: ModelProviderAuthorizationService) {}

  static create(
    authorization: ModelProviderAuthorizationService,
  ): ModelProviderWriteAuthorizationService {
    return new ModelProviderWriteAuthorizationService(authorization);
  }

  async assertCanWrite(actorId: string, scopes: ModelDefaultScope[]): Promise<void> {
    await this.assertScopes(actorId, scopes, "provider");
  }

  async assertCanWriteDefault(actorId: string, scopes: ModelDefaultScope[]): Promise<void> {
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
      if (await this.authorization.canWrite(actorId, scope)) {
        continue;
      }

      // The permission named in the refusal is the one that was checked,
      // because both come from the same mapping.
      const input = {
        scopeType: scope.scopeType,
        requiredPermission: ModelProviderAuthorizationService.writePermission(scope.scopeType),
      };
      if (target === "default") {
        throw new ModelDefaultScopeForbiddenError(input);
      }
      throw new ModelProviderScopeForbiddenError(input);
    }
  }
}
