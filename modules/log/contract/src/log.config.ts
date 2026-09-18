import { Config, type ConfigOf } from "@langwatch/config";
import { z } from "zod";

/**
 * Producer and consumer must share this value or records land on unclaimed groups.
 * The pipeline owns the clamp; parsing it here would create a second answer.
 */
export const logConfig = Config.define((c) => ({
  processingShards: c.env("LOG_PROCESSING_SHARDS", z.string().optional()),
}));

export type LogServerConfig = ConfigOf<typeof logConfig>;

/** Product ceilings, not deployment facts: no environment spells them. */
export const LOG_DEFAULT_RETENTION_DAYS = 30;
export const LOG_DEFAULT_READ_LIMIT = 100;
