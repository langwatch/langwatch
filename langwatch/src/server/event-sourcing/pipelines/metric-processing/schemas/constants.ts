export const METRIC_DATA_POINT_RECEIVED_EVENT_TYPE =
  "lw.obs.metric.data_point_received" as const;
export const METRIC_DATA_POINT_RECEIVED_EVENT_VERSION_LATEST =
  "2026-07-15" as const;

export const METRIC_PROCESSING_EVENT_TYPES = [
  METRIC_DATA_POINT_RECEIVED_EVENT_TYPE,
] as const;

export const RECORD_METRIC_DATA_POINT_COMMAND_TYPE =
  "lw.obs.metric.record_data_point" as const;

export const METRIC_PROCESSING_COMMAND_TYPES = [
  RECORD_METRIC_DATA_POINT_COMMAND_TYPE,
] as const;

export const METRIC_ROLLUP_INTERVAL_MS = 30_000;
export const METRIC_MAP_COALESCE_MAX_BATCH = 256;

/**
 * Append-coalescing bound for recordDataPoint (ADR-066 pillar 2). Data points
 * arrive one command per point and are sharded onto a fixed set of group keys,
 * so a busy exporter parks many points behind one shard — one tiny event_log
 * insert each, which floods the log with small parts. Folding a shard's queued
 * points into a single multi-row insert keeps the producer off the per-item
 * write path. Matches {@link METRIC_MAP_COALESCE_MAX_BATCH} so both stages of
 * this pipeline fold at the same width; the drain's byte bound backs it up.
 */
export const METRIC_COMMAND_COALESCE_MAX_BATCH = 256;
export const MAX_CANONICAL_METRIC_PAYLOAD_BYTES = 256 * 1024;
export const DEFAULT_METRIC_COMMAND_SHARDS = 16;
export const MIN_METRIC_COMMAND_SHARDS = 1;
export const MAX_METRIC_COMMAND_SHARDS = 128;
