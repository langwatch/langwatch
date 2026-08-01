export const CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE =
  "lw.obs.log.record_received" as const;
export const CANONICAL_LOG_RECORD_RECEIVED_EVENT_VERSION_LATEST =
  "2026-07-17" as const;

export const LOG_PROCESSING_EVENT_TYPES = [
  CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE,
] as const;

export const RECORD_CANONICAL_LOG_COMMAND_TYPE =
  "lw.obs.log.record_canonical_log" as const;
export const LOG_PROCESSING_COMMAND_TYPES = [
  RECORD_CANONICAL_LOG_COMMAND_TYPE,
] as const;

export const MAX_CANONICAL_LOG_PAYLOAD_BYTES = 1024 * 1024;
export const DEFAULT_LOG_COMMAND_SHARDS = 16;
export const MIN_LOG_COMMAND_SHARDS = 1;
export const MAX_LOG_COMMAND_SHARDS = 128;
export const LOG_MAP_COALESCE_MAX_BATCH = 256;
