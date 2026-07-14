/**
 * Log-command sharding for the trace-processing pipeline.
 *
 * `recordLog` commands are grouped on the GroupQueue by a key derived from the
 * trace id (`getAggregateId`). Every log record of a trace therefore lands in
 * one group and drains one at a time behind a single worker - fine for an
 * ordinary trace, but one Claude Code agentic turn can drive thousands of
 * tool/model calls, each of which becomes a `recordLog` command FIFO'd into that
 * single per-trace group. Observed live: ~2,000+ recordLog jobs pending on one
 * turn's group while every other trace's logs waited behind it.
 *
 * The command handler reads no trace-level state - it is a pure per-log
 * transform (PII redaction + oversized-field cap) that emits one
 * `log_record_received` event stamped `aggregateId = traceId`. So the *command*
 * need not serialise on the trace; only the aggregate-keyed *folds* (trace
 * summary, coding-agent session) do, and they run on their own aggregate-keyed
 * queue, untouched by this key. Splitting the command key into `traceId:<shard>`
 * lets a hot turn's logs drain across up to `shardCount` groups in parallel
 * while the folds stay ordered per trace.
 *
 * The trace id MUST stay the whole-turn `traceId` as the aggregate: a tool
 * call's output is not carried on its own log record - it is recovered from the
 * NEXT model call's request body within the SAME trace's record set (see
 * canonicalisation/extractors/claudeCode.ts and the coding-agent session fold).
 * That cross-record join only sees the whole turn because every record shares
 * the aggregate, so splitting a turn across traces would lose tool outputs.
 * Sharding here only fans the *command's* GroupQueue lane; the emitted event's
 * aggregate stays the turn's single trace, so the folds and UI are untouched.
 *
 * `shardCount <= 1` returns the bare trace id - byte-identical to the historic
 * key - so the feature is off until an operator raises the count. The per-tenant
 * soft-cap still bounds how many of a tenant's groups run at once, so a
 * fanned-out hot turn cannot starve its neighbours (see
 * specs/event-sourcing/tenant-soft-cap.feature). Mirrors spanCommandGroupKey.ts.
 */

import { clampShardCount, shardIndexFor } from "./commandShardKey";

/**
 * Upper bound on the shard count. A hot turn never needs more parallelism than
 * this, and keeping it small bounds the number of GroupQueue groups (and parked
 * entries under the tenant soft-cap) a single turn can create.
 */
export const MAX_LOG_SHARD_COUNT = 128 as const;

/**
 * Deterministic bucket in `[0, shardCount)` for a span id. Callers must pass
 * `shardCount >= 1`; `logCommandGroupKey` guarantees this.
 */
export function logShardIndex({
  spanId,
  shardCount,
}: {
  spanId: string;
  shardCount: number;
}): number {
  return shardIndexFor(spanId, shardCount);
}

/**
 * GroupQueue domain key for a `recordLog` command.
 *
 * Returns `traceId` when sharding is disabled (`shardCount <= 1`) - identical to
 * the historic `getAggregateId`-derived key - and `traceId:<shard>` otherwise.
 * The framework prepends `<tenantId>/command/recordLog/trace:` around this, so
 * the tenant prefix (and `tenantIdFromGroupId`) is unaffected.
 *
 * Buckets on the span id so all of one span's log records share a lane; an empty
 * or missing span id (a customer SDK can send arbitrary strings) still hashes to
 * a stable bucket, so bucketing stays total. The turn's aggregate - the emitted
 * event's `aggregateId` - remains the whole `traceId`, never a shard, so the
 * cross-record tool-output join in the span-sync reactor is preserved.
 */
export function logCommandGroupKey({
  traceId,
  spanId,
  shardCount,
}: {
  traceId: string;
  spanId: string;
  shardCount: number;
}): string {
  if (shardCount <= 1) return traceId;
  return `${traceId}:${logShardIndex({ spanId, shardCount })}`;
}

/**
 * Clamp a numeric shard count to the safe range `[1, MAX_LOG_SHARD_COUNT]`.
 * Non-integer or below-one values fall back to `1` (sharding disabled) rather
 * than throwing on the ingest path; values above {@link MAX_LOG_SHARD_COUNT} are
 * clamped down.
 *
 * Applied as defense-in-depth wherever a shard count enters the pipeline - not
 * only from env - so a caller that constructs the pipeline directly (a test or a
 * future composition root) can't explode the number of GroupQueue groups.
 */
export function clampLogShardCount(shardCount: number): number {
  return clampShardCount(shardCount, MAX_LOG_SHARD_COUNT);
}

/**
 * Sharding is ON by default: one agentic Claude Code turn streaming thousands
 * of log records into a single FIFO lane is the 2026-07-10 outage shape, so
 * the protection must not depend on an operator remembering an env var.
 * `TRACE_LOG_PROCESSING_SHARDS` stays as optional tuning: raise it for wider
 * fan-out, set `1` to disable.
 */
export const DEFAULT_LOG_COMMAND_SHARD_COUNT = 4;

/**
 * Resolve the operator-configured shard count from an env value, clamped to
 * the safe range. Absent, non-numeric, or out-of-range values fall back to
 * {@link DEFAULT_LOG_COMMAND_SHARD_COUNT}; `1` disables sharding.
 *
 * Read once at pipeline composition from `TRACE_LOG_PROCESSING_SHARDS`,
 * mirroring how `TRACE_SPAN_PROCESSING_SHARDS` tunes the recordSpan lane.
 */
export function resolveLogCommandShardCount(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_LOG_COMMAND_SHARD_COUNT;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return DEFAULT_LOG_COMMAND_SHARD_COUNT;
  }
  return clampLogShardCount(parsed);
}
