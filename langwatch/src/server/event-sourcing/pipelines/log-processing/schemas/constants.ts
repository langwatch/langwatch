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

/**
 * Append-coalescing bound for recordLogRecord (ADR-066 pillar 2). Log records
 * arrive one command per record and are sharded onto a fixed set of group keys,
 * so a busy exporter parks many records behind one shard — one tiny event_log
 * insert each, which floods the log with small parts. Folding a shard's queued
 * records into a single multi-row insert keeps the producer off the per-item
 * write path. Matches {@link LOG_MAP_COALESCE_MAX_BATCH} so both stages of this
 * pipeline fold at the same width.
 *
 * The count is the only bound you can rely on here. The drain's byte budget
 * sums the *stored* size of each staged job, so it does not see a body the
 * envelope offloaded to the blob store — a batch of records near
 * {@link MAX_CANONICAL_LOG_PAYLOAD_BYTES} is bounded by this count, not by
 * bytes, whenever envelope writes are on. Pre-existing and shared with the map
 * stage above; making the budget payload-aware is a groupQueue change that has
 * to cover both.
 */
export const LOG_COMMAND_COALESCE_MAX_BATCH = 256;
