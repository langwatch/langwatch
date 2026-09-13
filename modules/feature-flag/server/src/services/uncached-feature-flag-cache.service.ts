import type { FeatureFlagCache, FeatureFlagCacheSlot } from "../app/feature-flag.app.ts";

/**
 * The shared cache tier, absent. Every read past {@link CachedFeatureFlagRowAdapter}'s
 * own five-second per-process window goes to the repository. Ported from
 * `installApiFeatureFlag`'s `UncachedApiFeatureFlags` (deleted by b383462d96):
 * no deployment ever wired a cross-process store behind this tier, so the
 * App builds the same no-op rather than inventing a new cache implementation.
 */
export class UncachedFeatureFlagCacheAdapter implements FeatureFlagCache {
  static create(): UncachedFeatureFlagCacheAdapter {
    return new UncachedFeatureFlagCacheAdapter();
  }

  findSlot(_key: string): Promise<FeatureFlagCacheSlot | undefined> {
    return Promise.resolve(undefined);
  }

  set(_key: string, _slot: FeatureFlagCacheSlot): Promise<void> {
    return Promise.resolve();
  }

  delete(_key: string): Promise<void> {
    return Promise.resolve();
  }
}
