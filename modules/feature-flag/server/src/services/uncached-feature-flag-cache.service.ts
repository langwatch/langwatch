import type { FeatureFlagCache, FeatureFlagCacheSlot } from "../app/feature-flag.app.ts";

/**
 * The shared cache tier, absent. Every read past the five-second
 * per-process window goes to the repository — no deployment ever wired a
 * cross-process store here, so the App builds the same no-op instead.
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
