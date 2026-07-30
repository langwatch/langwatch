/**
 * `log-processing` — the canonical OTLP log pipeline (ADR-098, ADR-099,
 * ADR-100, ADR-105, ADR-106; specs/otlp/canonical-log-ingestion.feature).
 *
 * A greenfield rewrite of `event-sourcing.old/pipelines/log-processing/`
 * onto `@langwatch/event-sourcing` and `@langwatch/clickhouse`: one
 * `defineAggregate` declaration replaces the old `schemas/` directory, the
 * dispatch-plane group key is a checked descriptor rather than a hand-joined
 * string, the map projection's mount is validated against ADR-106's legality
 * table at composition, and the store is built from a `defineTable`
 * declaration instead of a hand-written repository wrapper.
 *
 * What this file exports is the composition surface a future
 * `pipeline.ts` / composition root needs — this rewrite does not itself
 * build `definePipeline`/`withMapProjection`/a command bus, none of which
 * exist yet in `@langwatch/event-sourcing` (verified against its
 * `src/index.ts`, per this task's instruction to read the real API rather
 * than guess it). See `aggregate.ts`'s docblock for the corresponding gap in
 * `defineAggregate` itself (no `aggregateId` extractor, despite ADR-105's own
 * example showing one).
 */

export { logRecord, logRecordAggregateId } from "./aggregate";

export {
  type CanonicalAnyValue,
  type CanonicalAttribute,
  type CanonicalizationResult,
  canonicalizeLogRequest,
  type LogRedactionService,
  MAX_CANONICAL_LOG_PAYLOAD_BYTES,
  type PreparedCanonicalLogRecord,
} from "./canonicalize";
export {
  canonicalLogStorageGroupKey,
  DEFAULT_LOG_SHARD_COUNT,
  logRecordCommandGroupKey,
  logRecordShard,
  MAX_LOG_SHARD_COUNT,
  MIN_LOG_SHARD_COUNT,
  resolveLogShardCount,
} from "./groupKey";
export {
  assertCanonicalLogStorageMountIsLegal,
  canonicalLogStorageMount,
} from "./mount";
export { createCanonicalLogStorageProjection } from "./projection";
export {
  checkLogProcessingRatchet,
  currentLogProcessingTypeStrings,
  LOG_PROCESSING_TYPE_STRING_SNAPSHOT,
} from "./ratchet";
export {
  type CanonicalLogRecord,
  canonicalLogRecordSchema,
  type LogCorrelationSource,
  type LogProviderKind,
  type PIIRedactionLevel,
  piiRedactionLevelSchema,
} from "./schema";
export { createCanonicalLogStore } from "./store";
export { logRecordsTable, logUsageEstimatesTable } from "./table";
