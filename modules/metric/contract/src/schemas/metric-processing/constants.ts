export const METRIC_PROCESSING_PIPELINE_NAME = "metric_processing" as const;

export const METRIC_DATA_POINT_RECEIVED_EVENT_TYPE = "lw.obs.metric.data_point_received" as const;
export const METRIC_DATA_POINT_RECEIVED_EVENT_VERSION_LATEST = "2026-07-15" as const;

export const METRIC_PROCESSING_EVENT_TYPES = [METRIC_DATA_POINT_RECEIVED_EVENT_TYPE] as const;

export const RECORD_METRIC_DATA_POINT_COMMAND_TYPE = "lw.obs.metric.record_data_point" as const;

export const METRIC_PROCESSING_COMMAND_TYPES = [RECORD_METRIC_DATA_POINT_COMMAND_TYPE] as const;

export const METRIC_ROLLUP_INTERVAL_MS = 30_000;
export const METRIC_MAP_COALESCE_MAX_BATCH = 256;

/**
 * Append-coalescing bound for recordDataPoint (ADR-066 pillar 2). Folds multiple data
 * points into one insert to reduce log flooding. Matches {@link
 * METRIC_MAP_COALESCE_MAX_BATCH}; byte budget is the actual limit.
 */
export const METRIC_COMMAND_COALESCE_MAX_BATCH = 256;
export const MAX_CANONICAL_METRIC_PAYLOAD_BYTES = 256 * 1024;
export const DEFAULT_METRIC_COMMAND_SHARDS = 16;
export const MIN_METRIC_COMMAND_SHARDS = 1;
export const MAX_METRIC_COMMAND_SHARDS = 128;

/** Product ceiling, not a deployment fact: no environment spells it. */
export const METRIC_DEFAULT_RETENTION_DAYS = 30;
