// Shard-bucketing helper for trace-processing command group key; keeps bucket
// byte-stable and deterministic across processes and restarts

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

// Clamp shard count to [1, maxShardCount]; non-integer or below-one values
// fall back to 1 (sharding disabled) on ingest path
export function clampShardCount(n: number, maxShardCount: number): number {
  if (!Number.isInteger(n) || n < 1) return 1;
  return Math.min(n, maxShardCount);
}
