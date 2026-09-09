import { Config, compileRuntimeConfig, RuntimeConfig, type ConfigValue } from "@langwatch/config";
import { z } from "zod";

/**
 * How many lanes the metric pipeline shards across.
 *
 * Producer and consumer live in different processes and must clamp this
 * identically, or a record lands on a group nothing claims. Carried as
 * written: the pipeline's own clamp owns the bound.
 */
export const metricServerConfigDefinition = RuntimeConfig.define({
  processingShards: Config.value(z.string().optional(), { env: "METRIC_PROCESSING_SHARDS" }),
});

export type MetricServerConfig = ConfigValue<typeof metricServerConfigDefinition>;

export const metricServerConfigSchema = compileRuntimeConfig(metricServerConfigDefinition);
