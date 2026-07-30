/** 30-second rollup bucket width. */
export const METRIC_ROLLUP_INTERVAL_MS = 30_000;

/** Batch ceiling for the three map projections' group-queue lanes. */
export const METRIC_MAP_COALESCE_MAX_BATCH = 256;

/** A canonical payload past this size is rejected rather than truncated. */
export const MAX_CANONICAL_METRIC_PAYLOAD_BYTES = 256 * 1024;

/** How many hashed lanes this pipeline's `partition` scopes spread across. */
export const DEFAULT_METRIC_COMMAND_SHARDS = 16;
export const MIN_METRIC_COMMAND_SHARDS = 1;
export const MAX_METRIC_COMMAND_SHARDS = 128;
