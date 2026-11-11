import type { ModelProviderExecution } from "@langwatch/model-provider-contract";

/** A connected model-provider execution record, enabled or not, for the title and model tests. */
export function executionProvider(input: {
  provider: string;
  enabled: boolean;
}): ModelProviderExecution {
  return {
    id: `mp_${input.provider}`,
    organizationId: "org_1",
    provider: input.provider,
    name: input.provider,
    enabled: input.enabled,
    routingHandle: null,
    scopes: [],
    customKeys: null,
    customModels: [],
    customEmbeddingsModels: [],
    extraHeaders: [],
    rateLimitRpm: null,
    rateLimitTpm: null,
    rateLimitRpd: null,
    fallbackPriorityGlobal: null,
    providerConfig: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    models: null,
    embeddingsModels: null,
    isSystem: false,
    embeddingsUnsupported: false,
  };
}
