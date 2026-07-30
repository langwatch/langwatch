import type { GroupKey } from "@langwatch/event-sourcing";

/**
 * Dispatch-plane keys for the `trace` aggregate (ADR-100). Rendering is the
 * dispatch runtime's job; nothing here calls `renderGroupKey`.
 */

// ---------------------------------------------------------------------------
// recordSpan command sharding
// ---------------------------------------------------------------------------

/**
 * FNV-1a 32-bit — the same hash the old pipeline used
 * (`commandShardKey.ts`), carried forward because nothing about the hash
 * function itself was ever named as a defect; only the group-key SHAPE (a
 * hand-joined string) was.
 */
const FNV_OFFSET_BASIS = 2166136261;
const FNV_PRIME = 16777619;

export function shardIndexFor(key: string, shardCount: number): number {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return (hash >>> 0) % shardCount;
}

export const MIN_SPAN_SHARD_COUNT = 1;
export const MAX_SPAN_SHARD_COUNT = 128;

function clampShardCount(value: number): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < MIN_SPAN_SHARD_COUNT) {
    return MIN_SPAN_SHARD_COUNT;
  }
  return Math.min(MAX_SPAN_SHARD_COUNT, value);
}

/** Resolves the configured shard count, falling back to disabled (1) on anything unusable. */
export function resolveSpanCommandShardCount(raw: string | undefined): number {
  if (!raw) return MIN_SPAN_SHARD_COUNT;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? clampShardCount(parsed) : MIN_SPAN_SHARD_COUNT;
}

/**
 * `recordSpan`'s group key. Sharding disabled (`shardCount <= 1`, the
 * default) keeps the historic trace-only key — `scope: aggregate`, which is
 * ADR-100's default and needs no override. Enabled, the command shards on the
 * SPAN's own id within a `partition` scope whose first part is still the
 * trace id, so a shard count of 1 and a disabled/absent config produce
 * byte-identical routing behaviour to the aggregate-scoped form (both are
 * "one lane per trace"), and enabling sharding only ever ADDS parallelism,
 * never changes it for shardCount<=1.
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
      scope: { kind: "aggregate", aggregateType: "trace", aggregateId: args.traceId },
    };
  }
  const shard = shardIndexFor(args.spanId, shardCount);
  return {
    tenantId: args.tenantId,
    lane: { kind: "command", name: "recordSpan" },
    scope: { kind: "partition", parts: [args.traceId, String(shard)] },
  };
}

/** Every other command is aggregate-scoped, the ADR-100 default. */
export function traceCommandGroupKey(args: {
  readonly tenantId: string;
  readonly traceId: string;
  readonly name: string;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "command", name: args.name },
    scope: { kind: "aggregate", aggregateType: "trace", aggregateId: args.traceId },
  };
}

// ---------------------------------------------------------------------------
// Fold lanes — always aggregate-scoped, unaffected by command sharding
// ---------------------------------------------------------------------------

export function traceSummaryFoldGroupKey(args: {
  readonly tenantId: string;
  readonly traceId: string;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "fold", name: "traceSummary" },
    scope: { kind: "aggregate", aggregateType: "trace", aggregateId: args.traceId },
  };
}

export function traceAnalyticsFoldGroupKey(args: {
  readonly tenantId: string;
  readonly traceId: string;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "fold", name: "traceAnalytics" },
    scope: { kind: "aggregate", aggregateType: "trace", aggregateId: args.traceId },
  };
}

// ---------------------------------------------------------------------------
// spanStorage map — event-scoped (per span), matching the old
// `groupKeyFn: (event) => \`span:${event.id}\`` shape, just as a typed
// descriptor. `bulkAppend` is what lets many event-scoped lanes still
// coalesce into one insert (ADR-100 §4) — see spanStorage.ts.
// ---------------------------------------------------------------------------

export function spanStorageGroupKey(args: {
  readonly tenantId: string;
  readonly eventId: string;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "map", name: "spanStorage" },
    scope: { kind: "event", eventId: args.eventId },
  };
}

// ---------------------------------------------------------------------------
// traceAnalyticsRollup fold — bucket-keyed (see traceAnalyticsRollup.ts)
// ---------------------------------------------------------------------------

export function traceAnalyticsRollupFoldGroupKey(args: {
  readonly tenantId: string;
  readonly bucketKey: string;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "fold", name: "traceAnalyticsRollup" },
    scope: { kind: "aggregate", aggregateType: "trace_rollup_bucket", aggregateId: args.bucketKey },
  };
}
