import {
  compileRuntimeConfig,
  deploymentPublicBaseUrl,
  RuntimeConfig,
  type ConfigValue,
} from "@langwatch/config";

/**
 * `apiKey` and `probeApiKey` resolve through the process's `secrets` member,
 * never this schema (ADR-132). `publicBaseUrl` is this deployment's own
 * public origin, the same `BASE_HOST` every process resolves.
 * @see modules/platform-health/adrs/001-platform-health-boundary.md
 */
export const platformHealthServerConfigDefinition = RuntimeConfig.define({
  publicBaseUrl: deploymentPublicBaseUrl,
});

export type PlatformHealthServerConfig = ConfigValue<typeof platformHealthServerConfigDefinition>;

export const platformHealthServerConfigSchema = compileRuntimeConfig(
  platformHealthServerConfigDefinition,
);
