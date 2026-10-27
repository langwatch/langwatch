// Span-command sharding for trace processing; shard hot traces across multiple
// groups while keeping fold ordered per trace

import { clampShardCount, shardIndexFor } from "./trace-command-shard.rules.ts";

/**
 * Upper bound on the shard count. A hot trace never needs more parallelism than
 * this, and keeping it small bounds the number of GroupQueue groups (and parked
 * entries under the tenant soft-cap) a single trace can create.
 */
export const MAX_SPAN_SHARD_COUNT = 128 as const;

/**
 * Deterministic bucket in `[0, shardCount)` for a span id. Callers must pass
 * `shardCount >= 1`; `spanCommandGroupKey` guarantees this.
 */
export function spanShardIndex({
  spanId,
  shardCount,
}: {
  spanId: string;
  shardCount: number;
}): number {
  return shardIndexFor(spanId, shardCount);
}

// GroupQueue domain key for recordSpan; returns traceId when sharding disabled,
// traceId:<shard> otherwise
export function spanCommandGroupKey({
  traceId,
  spanId,
  shardCount,
}: {
  traceId: string;
  spanId: string;
  shardCount: number;
}): string {
  if (shardCount <= 1) return traceId;
  return `${traceId}:${spanShardIndex({ spanId, shardCount })}`;
}

// Clamp shard count to [1, MAX_SPAN_SHARD_COUNT]; defense-in-depth so direct
// pipeline construction can't explode GroupQueue group count
export function clampSpanShardCount(shardCount: number): number {
  return clampShardCount(shardCount, MAX_SPAN_SHARD_COUNT);
}

// Resolve operator-configured shard count from TRACE_SPAN_PROCESSING_SHARDS env
// value, clamped to safe range
export function resolveSpanCommandShardCount(raw: string | undefined): number {
  return clampSpanShardCount(Number(raw));
}
