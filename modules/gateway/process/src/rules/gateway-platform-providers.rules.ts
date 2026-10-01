import type { ModelProvider } from "@langwatch/gateway-contract";
import {
  PLATFORM_PROVIDER_ID_PREFIX,
  type PlatformProviderEntry,
} from "@langwatch/model-provider-contract";
import { Temporal } from "@langwatch/time";

/**
 * The platform chain as provider rows a managed key dispatches to (ADR-156 section 8).
 * Synthesized, never stored: the credential is the deployment's, not the tenant's, and the
 * bag is plain because nothing is at rest to decrypt. Epoch-spaced times keep the order stable.
 */
export function platformProviderRows({
  organizationId,
  chain,
}: {
  organizationId: string;
  chain: readonly PlatformProviderEntry[];
}): ModelProvider[] {
  return chain.map(({ provider, credentialKey, credential }, index) => {
    const at = Temporal.Instant.fromEpochMilliseconds(index);

    return {
      id: `${PLATFORM_PROVIDER_ID_PREFIX}${provider}`,
      organizationId,
      name: provider,
      provider,
      routingHandle: null,
      enabled: true,
      customKeys: { [credentialKey]: credential },
      extraHeaders: null,
      customModels: null,
      customEmbeddingsModels: null,
      deploymentMapping: null,
      rateLimitRpm: null,
      rateLimitTpm: null,
      rateLimitRpd: null,
      rotationPolicy: "MANUAL",
      providerConfig: null,
      fallbackPriorityGlobal: null,
      langySkipPermissionsModels: null,
      healthStatus: "HEALTHY",
      circuitOpenedAt: null,
      lastHealthCheckAt: null,
      disabledAt: null,
      createdAt: at,
      updatedAt: at,
    };
  });
}
