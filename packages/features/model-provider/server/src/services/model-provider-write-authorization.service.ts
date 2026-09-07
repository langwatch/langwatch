import {
  ModelDefaultScopeForbiddenError,
  ModelProviderScopeForbiddenError,
  type ModelDefaultApiKeyPrincipal,
  type ModelDefaultScope,
} from "@langwatch/model-provider-contract";
import { ModelProviderAuthorizationService } from "./model-provider-authorization.service.ts";

/**
 * Shared write check for the model-provider's provider and default commands.
 */
export class ModelProviderWriteAuthorizationService {
  private constructor(private readonly authorization: ModelProviderAuthorizationService) {}

  static create(
    authorization: ModelProviderAuthorizationService,
  ): ModelProviderWriteAuthorizationService {
    return new ModelProviderWriteAuthorizationService(authorization);
  }

  async assertCanWrite(actorId: string, scopes: ModelDefaultScope[]): Promise<void> {
    await this.assertScopes(scopes, "provider", (scope) =>
      this.authorization.canWrite(actorId, scope),
    );
  }

  async assertCanWriteDefault(actorId: string, scopes: ModelDefaultScope[]): Promise<void> {
    await this.assertScopes(scopes, "default", (scope) =>
      this.authorization.canWrite(actorId, scope),
    );
  }

  /**
   * The same scope-by-scope check against the CREDENTIAL a request arrived on
   * rather than against its owner. One mapping, one refusal, two principals:
   * a transport that authorizes the owner alone lets a deliberately narrow key
   * write with its owner's grants.
   */
  async assertApiKeyCanWriteDefault(
    apiKey: ModelDefaultApiKeyPrincipal,
    scopes: ModelDefaultScope[],
  ): Promise<void> {
    await this.assertScopes(scopes, "default", (scope) =>
      this.authorization.apiKeyCanWrite(apiKey, scope),
    );
  }

  private async assertScopes(
    scopes: ModelDefaultScope[],
    target: "provider" | "default",
    permits: (scope: ModelDefaultScope) => Promise<boolean>,
  ): Promise<void> {
    const uniqueScopes = new Map(
      scopes.map((scope) => [`${scope.scopeType}:${scope.scopeId}`, scope]),
    );
    for (const scope of uniqueScopes.values()) {
      if (await permits(scope)) {
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
