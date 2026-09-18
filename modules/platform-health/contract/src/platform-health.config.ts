import {
  Config,
  compileRuntimeConfig,
  deploymentPublicBaseUrl,
  RuntimeConfig,
  type ConfigValue,
} from "@langwatch/config";
import { z } from "zod";

/**
 * Both refused blank; with either absent the family is not mounted. `apiKey`
 * is what a monitor presents, `probeApiKey` authors the canary. `publicBaseUrl`
 * is this deployment's own public origin, the same `BASE_HOST` every process
 * resolves, read here rather than forwarded through a member.
 * @see modules/platform-health/adrs/001-platform-health-boundary.md
 */
export const platformHealthServerConfigDefinition = RuntimeConfig.define({
  apiKey: Config.optionalSecret({ env: "PLATFORM_HEALTH_API_KEY" }),
  probeApiKey: Config.optionalSecret({ env: "PLATFORM_HEALTH_PROBE_API_KEY" }),
  publicBaseUrl: deploymentPublicBaseUrl,
});

export type PlatformHealthServerConfig = ConfigValue<typeof platformHealthServerConfigDefinition>;

export const platformHealthServerConfigSchema = compileRuntimeConfig(
  platformHealthServerConfigDefinition,
);
