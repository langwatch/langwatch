/**
 * Shared shard-bucketing helper for the trace-processing command group keys.
 *
 * `spanCommandGroupKey` (recordSpan) and `logCommandGroupKey` (recordLog) both
 * fan a hot trace's records across `traceId:<shard>` lanes on the GroupQueue.
 * They bucket on the record's span id with the SAME rolling hash and the SAME
 * clamp shape; this module holds that one implementation so the two callers stay
 * byte-identical. Each caller keeps its own public API and its own
 * `MAX_*_SHARD_COUNT` constant (both 128 today, but independently tunable).
 */

// FNV-1a (32-bit) constants. A record's bucket must be deterministic across
// processes and restarts - a record's retries and its dedup squash window must
// keep landing in the same group - and this is bucket placement, not security,
// so a fast non-crypto rolling hash is the right tool and avoids a crypto digest
// on the ingest hot path.
const FNV_OFFSET_BASIS = 2166136261;
const FNV_PRIME = 16777619;

/**
 * Deterministic bucket in `[0, shardCount)` for a string key (a span id).
 * Callers must pass `shardCount >= 1`; the group-key wrappers guarantee this.
 */
export function shardIndexFor(key: string, shardCount: number): number {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  // `>>> 0` folds the signed 32-bit imul result to an unsigned int before the
  // modulo, so the bucket is always non-negative.
  return (hash >>> 0) % shardCount;
}

/**
 * Clamp a numeric shard count to the safe range `[1, maxShardCount]`. Non-integer
 * or below-one values fall back to `1` (sharding disabled) rather than throwing
 * on the ingest path; values above `maxShardCount` are clamped down. Callers pass
 * their own `MAX_*_SHARD_COUNT`.
 */
export function clampShardCount(n: number, maxShardCount: number): number {
  if (!Number.isInteger(n) || n < 1) return 1;
  return Math.min(n, maxShardCount);
}
