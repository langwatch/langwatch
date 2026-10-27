import { z } from "zod";

export const cachedStorageBytesSchema = z
  .object({
    bytes: z.number().finite().nonnegative(),
    computedAt: z.number().finite(),
  })
  .strict();

export type CachedStorageBytes = z.infer<typeof cachedStorageBytesSchema>;

/** A cache read: the bytes held under the key, or a miss the caller computes. */
export type CachedStorageBytesLookup =
  | { kind: "hit"; value: CachedStorageBytes }
  | { kind: "miss" };

/** How long a measured total may be served at all, fresh or stale. */
export const STORAGE_METER_CACHE_TTL_MS = 30 * 60 * 1_000;

export abstract class StorageMeterCacheRepository {
  abstract get(key: string): Promise<CachedStorageBytesLookup>;
  abstract set(key: string, value: CachedStorageBytes): Promise<void>;
  abstract claim(key: string, value: number): Promise<boolean>;
}
