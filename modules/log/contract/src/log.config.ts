import { Config, compileRuntimeConfig, RuntimeConfig, type ConfigValue } from "@langwatch/config";
import { z } from "zod";

/**
 * Producer and consumer must share this value or records land on unclaimed groups.
 * The pipeline owns the clamp; parsing it here would create a second answer.
 */
export const logServerConfigDefinition = RuntimeConfig.define({
  processingShards: Config.value(z.string().optional(), { env: "LOG_PROCESSING_SHARDS" }),
  defaultRetentionDays: 30,
  defaultReadLimit: 100,
});

export type LogServerConfig = ConfigValue<typeof logServerConfigDefinition>;

export const logServerConfigSchema = compileRuntimeConfig(logServerConfigDefinition);
