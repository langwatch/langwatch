import { prisma } from "../db";
import { createLogger } from "~/utils/logger/server";
import { KILL_SWITCH_CACHE_TTL_MS } from "./constants";
import { TtlCache } from "../utils/ttlCache";

/**
 * Postgres-backed flag value store with a thin Redis/in-memory cache.
 *
 * The store sits in front of the FeatureFlag Prisma table. Resolution
 * order at the service layer is `env -> store.get() -> registry.default`
 * for SYSTEM flags; this class is the middle hop.
 *
 * Caching uses the existing TtlCache (Redis primary, per-pod memory
 * fallback) at `KILL_SWITCH_CACHE_TTL_MS` (60 s). That window is chosen
 * to match the existing kill-switch TTL: an operator flipping a flag
 * from the Ops UI sees it propagate cluster-wide within a minute, and
 * misses fall back to a single SELECT against postgres per pod per
 * minute per flag — orders of magnitude below the PostHog cost the
 * SYSTEM scope is replacing.
 *
 * "Not set" is a distinct state from "set to false" — registry defaults
 * apply only when there is no row. We cache the tri-state explicitly so
 * a cache hit for an absent row doesn't shadow a registry default with
 * `false`.
 */
type CachedValue = { enabled: boolean | null };

const CACHE_PREFIX = "feature_flag_store:";
// Local in-process TTL: kept much shorter than the Redis TTL so a
// killed flag still propagates within seconds, but long enough that
// per-event reactor calls collapse to a Map lookup on the hot path.
const LOCAL_TTL_MS = 5_000;

export class FeatureFlagStorePostgres {
  private readonly logger = createLogger("langwatch:feature-flag-store");
  private readonly cache = new TtlCache<CachedValue>(
    KILL_SWITCH_CACHE_TTL_MS,
    CACHE_PREFIX,
  );
  // Per-pod in-process cache. Sits in front of Redis so the trace-
  // processing reactor (called per event) does not generate a Redis GET
  // per event. Map + timestamp is plenty — no LRU bound because the key
  // space is bounded by the registry size.
  private readonly local = new Map<string, { value: boolean | null; expiresAt: number }>();

  /**
   * Read the operator-set value for `key`. Returns `null` when no row
   * exists in postgres (caller should fall through to the registry
   * default).
   */
  async get(key: string): Promise<boolean | null> {
    const localHit = this.local.get(key);
    const now = Date.now();
    if (localHit && localHit.expiresAt > now) {
      return localHit.value;
    }
    const cached = await this.cache.get(key);
    if (cached !== undefined) {
      this.local.set(key, { value: cached.enabled, expiresAt: now + LOCAL_TTL_MS });
      return cached.enabled;
    }
    try {
      const row = await prisma.featureFlag.findUnique({
        where: { key },
        select: { enabled: true },
      });
      const value = row?.enabled ?? null;
      await this.cache.set(key, { enabled: value });
      this.local.set(key, { value, expiresAt: now + LOCAL_TTL_MS });
      return value;
    } catch (error) {
      this.logger.warn(
        { key, error: error instanceof Error ? error.message : error },
        "feature flag store read failed, falling back to registry default",
      );
      return null;
    }
  }

  /**
   * Operator write — invalidates the per-pod cache entry immediately so
   * subsequent reads on this pod see the new value; other pods catch up
   * within `KILL_SWITCH_CACHE_TTL_MS` via natural TTL expiry. No pub/sub
   * channel by design (kept the Redis load minimal; the 60 s lag is
   * acceptable for kill switches and operator UI ops).
   */
  async set(
    key: string,
    enabled: boolean,
    lastEditedBy: string | null,
  ): Promise<void> {
    await prisma.featureFlag.upsert({
      where: { key },
      create: { key, enabled, lastEditedBy },
      update: { enabled, lastEditedBy },
    });
    await this.cache.delete(key);
    this.local.delete(key);
  }

  async clear(key: string, lastEditedBy: string | null): Promise<void> {
    await prisma.featureFlag
      .delete({ where: { key } })
      .catch(() => undefined);
    await this.cache.delete(key);
    this.local.delete(key);
    this.logger.debug({ key, lastEditedBy }, "feature flag cleared");
  }

  /**
   * Bulk read for the Ops UI listing. Returns every row currently in
   * postgres regardless of registry status — operators need to see
   * orphaned rows from removed flags so they can clean them up.
   */
  async listAll(): Promise<
    Array<{ key: string; enabled: boolean; lastEditedBy: string | null; updatedAt: Date }>
  > {
    const rows = await prisma.featureFlag.findMany({
      select: { key: true, enabled: true, lastEditedBy: true, updatedAt: true },
      orderBy: { key: "asc" },
    });
    return rows;
  }
}

let _instance: FeatureFlagStorePostgres | null = null;
export function getFeatureFlagStore(): FeatureFlagStorePostgres {
  if (!_instance) {
    _instance = new FeatureFlagStorePostgres();
  }
  return _instance;
}
