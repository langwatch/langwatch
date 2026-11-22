/**
 * Cross-replica coordination for clustering: the per-project bootstrap gate and the legacy
 * seeds' claims and done markers. Keys keep main's spelling, so markers already written stand.
 */
export interface TopicClusteringClaimRepository {
  /** Takes the key for `ttlSeconds` only when nobody holds it; true when this caller took it. */
  claim(input: { key: string; ttlSeconds: number }): Promise<boolean>;
  release(input: { key: string }): Promise<void>;
  /** Writes a permanent marker. */
  mark(input: { key: string; value: string }): Promise<void>;
  isMarked(input: { key: string }): Promise<boolean>;
}
