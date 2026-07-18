/**
 * Asks the durable store how far behind its slowest replica is for a set of
 * aggregates.
 *
 * This is the check that lets a cache entry be released. It must report the
 * LAGGARD, not the leader: reads are load-balanced across replicas, so
 * confirming against whichever node answered and then dropping the cache would
 * let a later read land on a replica that has not caught up — precisely the
 * loss the cache exists to prevent.
 *
 * It is deliberately not on the write path. Establishing the same guarantee
 * synchronously (`insert_quorum`, `select_sequential_consistency`) was shipped
 * and reverted — see #2751 and #2899, which measured ~200ms per fold step and
 * 10-14s read latencies respectively. Asking asynchronously costs nothing,
 * because a slow answer just means a cache entry lives a little longer.
 */
export interface FoldDurabilityProbe {
  /**
   * For each requested aggregate, the `UpdatedAt` held by the least-caught-up
   * replica.
   *
   * An aggregate MUST be omitted from the result when it cannot be shown to be
   * present on every replica — whether because a replica has not received it,
   * or because a replica did not answer. Omission means "not confirmed", which
   * retains the cache entry. Reporting a value for an aggregate that is missing
   * from some replica would release the cache entry and lose state, so the
   * safe direction is always to say nothing.
   */
  confirmedUpdatedAt(input: {
    tenantId: string;
    aggregateIds: readonly string[];
  }): Promise<Map<string, number>>;
}

/**
 * Probe for deployments where the table is not replicated: whatever the single
 * node reports is by definition what every replica holds.
 */
export interface SingleNodeDurabilityProbe extends FoldDurabilityProbe {}
