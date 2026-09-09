import type { ModelDefaultScope } from "@langwatch/model-provider-contract";

/**
 * Whether a project can see any provider that is attached and switched on.
 *
 * Its own repository rather than a method on {@link ModelProviderRepository},
 * and the distinction is the credential. Every read on that repository maps a
 * row, and mapping a row decodes `customKeys` through the codec it was built
 * with, so a caller that only wants a boolean would have to be handed a
 * decrypting reader to get one. This one selects an id and cannot decode
 * anything, which is what lets the setup checklist ask the question without
 * holding the deployment's cipher.
 */
export interface ModelProviderEvidenceRepository {
  hasEnabledForScopes(projectScopes: ModelDefaultScope[]): Promise<boolean>;
}
