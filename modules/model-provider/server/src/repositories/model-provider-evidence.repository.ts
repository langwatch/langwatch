import type { ModelDefaultScope } from "@langwatch/model-provider-contract";

/**
 * Whether a project can see any provider that is attached and switched on. Its own repository,
 * not a method on {@link ModelProviderRepository}, so the setup checklist can ask without
 * holding the deployment's decrypting cipher the other repository's row-mapping needs.
 */
export interface ModelProviderEvidenceRepository {
  hasEnabledForScopes(projectScopes: ModelDefaultScope[]): Promise<boolean>;
}
