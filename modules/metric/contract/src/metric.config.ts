import { Config, type ConfigOf } from "@langwatch/config";
import { z } from "zod";

/**
 * How many lanes the metric pipeline shards across. Producer and consumer
 * live in different processes and must clamp this identically, or a record
 * lands on a group nothing claims. Carried as written; the clamp owns the bound.
 */
export const metricConfig = Config.define((c) => ({
  processingShards: c.env("METRIC_PROCESSING_SHARDS", z.string().optional()),
}));

export type MetricServerConfig = ConfigOf<typeof metricConfig>;
