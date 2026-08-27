import type { FeatureFlagRules } from "@langwatch/feature-flag-contract";

/** The operator row as the cache carries it. */
export type FeatureFlagRow = { enabled: boolean; rules: FeatureFlagRules };

/**
 * One cache entry.
 *
 * The row is wrapped so a cached absence (`row: null`) stays distinct from
 * a cache miss (`undefined`). Without the wrapper a hit for an absent row
 * would shadow the registry default with `false`.
 */
export type FeatureFlagCacheSlot = { row: FeatureFlagRow | null };

/**
 * Cross-process cache for operator rows.
 *
 * The composition root owns the backing store, its key prefix and its TTL.
 * Entries hold the row rather than a pre-evaluated boolean, so one entry
 * serves every tenant and targeting stays a per-call computation.
 */
export abstract class FeatureFlagCachePort {
  abstract tryGet(key: string): Promise<FeatureFlagCacheSlot | undefined>;
  abstract set(key: string, slot: FeatureFlagCacheSlot): Promise<void>;
  abstract delete(key: string): Promise<void>;
}
