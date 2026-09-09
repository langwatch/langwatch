import { Config, compileRuntimeConfig, RuntimeConfig, type ConfigValue } from "@langwatch/config";
import { z } from "zod";

/**
 * How many lanes the log pipeline shards across.
 *
 * Producer and consumer live in different processes and must clamp this
 * identically, or a record lands on a group nothing claims. Carried as
 * written: the pipeline's own clamp owns the bound, and a second parse here
 * would be a second answer.
 */
export const logServerConfigDefinition = RuntimeConfig.define({
  processingShards: Config.value(z.string().optional(), { env: "LOG_PROCESSING_SHARDS" }),
  defaultRetentionDays: 30,
  defaultReadLimit: 100,
});

export type LogServerConfig = ConfigValue<typeof logServerConfigDefinition>;

export const logServerConfigSchema = compileRuntimeConfig(logServerConfigDefinition);
