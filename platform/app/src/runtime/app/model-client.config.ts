import { Config, RuntimeConfig, type ConfigValue } from "@langwatch/config";

/**
 * Private process configuration for model SDK adapters. This names the
 * internal execution boundary rather than exposing its deployment variable to
 * feature code.
 */
const modelClientConfigDefinition = RuntimeConfig.define({
  executionProxyUrl: Config.url({ optional: true, env: "LANGWATCH_NLP_SERVICE" }),
  gatewayInternalUrl: Config.url({ optional: true, env: "LW_GATEWAY_INTERNAL_URL" }),
  gatewayPublicUrl: Config.url({ optional: true, env: "LW_GATEWAY_PUBLIC_URL" }),
  gatewayBaseUrl: Config.url({ optional: true, env: "LW_GATEWAY_BASE_URL" }),
});

type ModelClientRuntimeConfig = ConfigValue<typeof modelClientConfigDefinition>;

/** Process-owned model SDK configuration with deployment fallbacks resolved. */
export type ModelClientConfig = Readonly<{
  executionProxyUrl?: string;
  codexGatewayUrl?: string;
}>;

export function resolveModelClientConfig(
  source: Readonly<Record<string, unknown>>,
): ModelClientConfig {
  const config: ModelClientRuntimeConfig = RuntimeConfig.create({
    name: "model client",
    definition: modelClientConfigDefinition,
    source,
  }).value;
  const codexGatewayUrl =
    config.gatewayInternalUrl ?? config.gatewayPublicUrl ?? config.gatewayBaseUrl;

  return {
    ...(config.executionProxyUrl ? { executionProxyUrl: config.executionProxyUrl } : {}),
    ...(codexGatewayUrl ? { codexGatewayUrl } : {}),
  };
}
