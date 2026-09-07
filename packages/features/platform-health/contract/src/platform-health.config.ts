import { Config, compileRuntimeConfig, RuntimeConfig, type ConfigValue } from "@langwatch/config";

/**
 * Both refused blank; with either absent the family is not mounted. `apiKey`
 * is what a monitor presents, `probeApiKey` authors the canary.
 * @see packages/features/platform-health/adrs/001-platform-health-boundary.md
 */
export const platformHealthServerConfigDefinition = RuntimeConfig.define({
  apiKey: Config.optionalSecret({ env: "PLATFORM_HEALTH_API_KEY" }),
  probeApiKey: Config.optionalSecret({ env: "PLATFORM_HEALTH_PROBE_API_KEY" }),
});

export type PlatformHealthServerConfig = ConfigValue<typeof platformHealthServerConfigDefinition>;

export const platformHealthServerConfigSchema = compileRuntimeConfig(
  platformHealthServerConfigDefinition,
);
