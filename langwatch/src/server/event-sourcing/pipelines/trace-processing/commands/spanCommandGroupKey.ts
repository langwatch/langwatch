/**
 * Span-command sharding for the trace-processing pipeline.
 *
 * `recordSpan` commands are grouped on the GroupQueue by a key derived from the
 * trace id (`getAggregateId`). Every span of a trace therefore lands in one
 * group and drains one at a time behind a single worker — fine for an ordinary
 * trace, but a trace that accumulates thousands of spans (reused trace_id, a
 * runaway agent loop) builds a multi-minute backlog while each span's per-span
 * work (PII redaction, cost enrichment, token estimation, content-drop) runs
 * serially.
 *
 * The command handler reads no trace-level state — it is a pure per-span
 * transform that emits one `span_received` event stamped `aggregateId =
 * traceId`. So the *command* need not serialise on the trace; only the
 * trace-summary *fold* does, and that runs on its own aggregate-keyed queue,
 * untouched by this key (see ProjectionRouter.initializeFoldQueues). Splitting
 * the command key into `traceId:<shard>` lets a hot trace's spans drain across
 * up to `shardCount` groups in parallel while the fold stays ordered per trace.
 *
 * `shardCount <= 1` returns the bare trace id — byte-identical to the historic
 * key — so the feature is off until an operator raises the count. The per-tenant
 * soft-cap still bounds how many of a tenant's groups run at once, so a fanned-out
 * hot trace cannot starve its neighbours (see specs/event-sourcing/tenant-soft-cap.feature).
 */

/**
 * Upper bound on the shard count. A hot trace never needs more parallelism than
 * this, and keeping it small bounds the number of GroupQueue groups (and parked
 * entries under the tenant soft-cap) a single trace can create.
 */
export const MAX_SPAN_SHARD_COUNT = 128;

// FNV-1a (32-bit) constants. A span's bucket must be deterministic across
// processes and restarts — a span's retries and its dedup squash window must
// keep landing in the same group — and this is bucket placement, not security,
// so a fast non-crypto rolling hash is the right tool and avoids a crypto digest
// on the span-ingest hot path.
const FNV_OFFSET_BASIS = 2166136261;
const FNV_PRIME = 16777619;

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
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < spanId.length; i++) {
    hash ^= spanId.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  // `>>> 0` folds the signed 32-bit imul result to an unsigned int before the
  // modulo, so the bucket is always non-negative.
  return (hash >>> 0) % shardCount;
}

/**
 * GroupQueue domain key for a `recordSpan` command.
 *
 * Returns `traceId` when sharding is disabled (`shardCount <= 1`) — identical to
 * the historic `getAggregateId`-derived key — and `traceId:<shard>` otherwise.
 * The framework prepends `<tenantId>/command/recordSpan/trace:` around this, so
 * the tenant prefix (and `tenantIdFromGroupId`) is unaffected.
 */
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

/**
 * Resolve the operator-configured shard count from an env value, clamped to a
 * safe range. Non-integer, below-one, or absent values fall back to `1`
 * (sharding disabled) rather than throwing on the ingest path; values above
 * {@link MAX_SPAN_SHARD_COUNT} are clamped down.
 *
 * Read once at pipeline composition from `TRACE_SPAN_PROCESSING_SHARDS`,
 * mirroring how `GLOBAL_QUEUE_CONCURRENCY` tunes the GroupQueue.
 */
export function resolveSpanCommandShardCount(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return 1;
  return Math.min(parsed, MAX_SPAN_SHARD_COUNT);
}
