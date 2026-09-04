import type { ModelProvider } from "@langwatch/prisma-client/generated";
import type { GatewayModelProviderCredentialsPort } from "./gateway-model-provider-credentials.port";
import type { VirtualKeyWithScopes } from "./gateway-virtual-key.port";

/**
 * What the gateway bundle is assembled from besides the materialiser's own
 * logic: the version token the gateway revalidates with, the reserved model
 * tiers a routing policy falls through to, and the catalog of models a
 * provider row declares it serves.
 *
 * A port because each of the three reads something outside the service — the
 * provider graph, the tier vocabulary, the shipped model registry — and a
 * process composes the concrete reader.
 */
export abstract class GatewayConfigAssemblyPort {
  /** The `ETag` for one key's bundle. */
  abstract versionToken(virtualKey: VirtualKeyWithScopes): Promise<string>;

  /** The alias map the gateway receives, reserved tiers filled in. */
  abstract withTierFallthrough(input: {
    aliases: Record<string, string>;
    defaultModel: string | null;
  }): Record<string, string>;

  /** The models a provider row declares, or undefined when it declares none. */
  abstract declaredModelsForProvider(modelProvider: {
    provider: string;
    customModels: unknown;
    customEmbeddingsModels: unknown;
  }): string[] | undefined;

  /** One provider row's decrypted credentials, in the gateway's wire shape. */
  abstract buildCredentials(
    modelProvider: ModelProvider,
    credentialReader: GatewayModelProviderCredentialsPort,
  ): Record<string, unknown>;
}
