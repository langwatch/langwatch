import type { GroupKey } from "@langwatch/event-sourcing";

/**
 * `recordSpan`'s optional sharding (specs/event-sourcing/span-command-sharding).
 * A hot trace can otherwise serialise every one of its spans into one command
 * lane; sharding on the span's own id spreads them while keeping the trace id
 * as the first part, so the folds' per-trace lanes are untouched.
 */

const FNV_OFFSET_BASIS = 2166136261;
const FNV_PRIME = 16777619;

export const MIN_SPAN_SHARD_COUNT = 1;
export const MAX_SPAN_SHARD_COUNT = 128;

/** FNV-1a 32-bit, carried forward from the old pipeline so shards do not move. */
export function shardIndexFor(key: string, shardCount: number): number {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return (hash >>> 0) % shardCount;
}

function clampShardCount(value: number): number {
  if (
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < MIN_SPAN_SHARD_COUNT
  ) {
    return MIN_SPAN_SHARD_COUNT;
  }
  return Math.min(MAX_SPAN_SHARD_COUNT, value);
}

/** Anything unusable resolves to disabled, never to a partial rollout. */
export function resolveSpanCommandShardCount(raw: string | undefined): number {
  if (!raw) return MIN_SPAN_SHARD_COUNT;
  const parsed = Number(raw);
  return Number.isFinite(parsed)
    ? clampShardCount(parsed)
    : MIN_SPAN_SHARD_COUNT;
}

/**
 * Disabled (the default) keeps the historic trace-only key, so turning
 * sharding on only ever adds parallelism.
 */
export function recordSpanCommandGroupKey(args: {
  readonly tenantId: string;
  readonly traceId: string;
  readonly spanId: string;
  readonly shardCount?: number;
}): GroupKey {
  const shardCount = clampShardCount(args.shardCount ?? MIN_SPAN_SHARD_COUNT);
  if (shardCount <= 1) {
    return {
      tenantId: args.tenantId,
      lane: { kind: "command", name: "recordSpan" },
      scope: {
        kind: "aggregate",
        aggregateType: "trace",
        aggregateId: args.traceId,
      },
    };
  }
  return {
    tenantId: args.tenantId,
    lane: { kind: "command", name: "recordSpan" },
    scope: {
      kind: "partition",
      parts: [args.traceId, String(shardIndexFor(args.spanId, shardCount))],
    },
  };
}
