import { createLogger } from "@langwatch/observability";
import type { FeatureFlagCachePort, FeatureFlagRow } from "../ports/feature-flag-cache.port";
import type { FeatureFlagRepository } from "../repositories/feature-flag.repository";

/**
 * Per-process window in front of the shared cache. The trace-processing
 * subscriber resolves flags per event, so without this tier every event
 * costs a shared-cache round trip.
 */
const LOCAL_TTL_MS = 5_000;
const LOCAL_MAX_KEYS = 5_000;

type LocalEntry = { row: FeatureFlagRow | null; expiresAt: number };

/**
 * Two-tier read of one operator row: per-process map, then the shared
 * cache, then the repository.
 *
 * A repository failure degrades to "no row" and is logged, so an unhealthy
 * database makes flags resolve to their registry defaults rather than
 * failing the caller.
 */
export class FeatureFlagRowStore {
  private readonly logger = createLogger("langwatch:feature-flag-store");
  private readonly local = new Map<string, LocalEntry>();

  private constructor(
    private readonly repository: FeatureFlagRepository,
    private readonly cache: FeatureFlagCachePort,
    private readonly now: () => number,
  ) {}

  static create(options: {
    repository: FeatureFlagRepository;
    cache: FeatureFlagCachePort;
    now: () => number;
  }): FeatureFlagRowStore {
    return new FeatureFlagRowStore(options.repository, options.cache, options.now);
  }

  async tryGetRow(key: string): Promise<FeatureFlagRow | null> {
    const now = this.now();
    const localHit = this.local.get(key);
    if (localHit) {
      if (localHit.expiresAt > now) return localHit.row;
      this.local.delete(key);
    }

    const cached = await this.cache.tryGet(key);
    if (cached !== undefined) {
      this.writeLocal(key, cached.row, now);
      return cached.row;
    }

    try {
      const row = await this.repository.tryFindByKey(key);
      await this.cache.set(key, { row });
      this.writeLocal(key, row, now);
      return row;
    } catch (error) {
      this.logger.warn(
        { key, error: error instanceof Error ? error.message : error },
        "feature flag store read failed, falling back to registry default",
      );
      return null;
    }
  }

  async invalidate(key: string): Promise<void> {
    await this.cache.delete(key);
    this.local.delete(key);
  }

  private writeLocal(key: string, row: FeatureFlagRow | null, now: number): void {
    this.local.set(key, { row, expiresAt: now + LOCAL_TTL_MS });
    if (this.local.size <= LOCAL_MAX_KEYS) return;

    for (const [candidate, entry] of this.local) {
      if (entry.expiresAt <= now) this.local.delete(candidate);
    }
    if (this.local.size <= LOCAL_MAX_KEYS) return;

    const overflow = this.local.size - LOCAL_MAX_KEYS;
    let dropped = 0;
    for (const candidate of this.local.keys()) {
      this.local.delete(candidate);
      dropped += 1;
      if (dropped >= overflow) break;
    }
  }
}
