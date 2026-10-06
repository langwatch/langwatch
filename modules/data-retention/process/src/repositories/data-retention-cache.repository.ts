import type { ResolvedRetention } from "@langwatch/data-retention-contract";

/** A cache read: the retention held under the key, or a miss the caller resolves. */
export type CachedRetentionLookup = { kind: "hit"; value: ResolvedRetention } | { kind: "miss" };

/** Internal cache port; cache implementation and wiring stay server-owned. */
export abstract class DataRetentionCacheRepository {
  abstract get(key: string): Promise<CachedRetentionLookup>;
  abstract set(key: string, value: ResolvedRetention): Promise<void>;
  abstract delete(key: string): Promise<void>;
}

/** How long a resolved retention may be served before the cascade is read again. */
export const DATA_RETENTION_CACHE_TTL_MS = 60_000;
