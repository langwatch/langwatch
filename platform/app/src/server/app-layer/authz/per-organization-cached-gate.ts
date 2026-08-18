/**
 * The shape ./cutover-gate.ts and ./legacy-fallback-gate.ts both are: a
 * boolean answer, asked once per permission check, cached per organization
 * with a TTL so a rollback or a finalization takes effect fleet-wide without
 * a deploy. This module owns that shape once; each gate supplies only its own
 * query and its own TTLs.
 *
 * Two behaviours live here that the two gates used to (not) have on their
 * own:
 *
 *   - A read that throws is LOGGED, not swallowed. A silent catch turned a
 *     genuine outage into "the fallback is still on" or "not cut over yet"
 *     with no trace anywhere that the projection was actually unreadable -
 *     correct behaviour, invisible cause.
 *   - Concurrent asks for the same COLD key share one read. Without this, a
 *     burst of permission checks against an organization neither gate has
 *     cached yet each starts its own `findUnique`, which is the same
 *     stampede a cache exists to prevent - just deferred to the first
 *     request after every expiry instead of the first request ever.
 *
 * Browser-safety: no module-scope Prisma or Redis - callers hand in their own
 * client through `read`.
 */
import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:authz:per-organization-cached-gate");

type CacheEntry = { value: boolean; expiresAt: number };

export type PerOrganizationCachedFlag = {
  /**
   * The cached answer for one organization, reading through `read` on a
   * cache miss. Concurrent calls for the same organization while that read
   * is in flight all resolve to the SAME promise - `read` runs once.
   */
  get(args: {
    organizationId: string;
    read: () => Promise<boolean>;
  }): Promise<boolean>;
  /** Drop ONE organization's cached answer - pod-local, exactly as the TTL
   *  is pod-local; every other pod converges on the TTL. */
  invalidate(args: { organizationId: string }): void;
  /** The cache, dropped - for tests that flip an organization mid-suite. */
  resetForTesting(): void;
};

/**
 * One cached boolean per organization. `positiveTtlMs` and `negativeTtlMs`
 * are separate because the two gates need them separate (the cutover gate's
 * two directions cost the same; the fallback gate's positive answer is a
 * one-way latch and can be trusted far longer than its negative one) - a
 * single TTL is just both arguments given the same value.
 */
/**
 * Hard cap on distinct organizations one gate holds at once.
 *
 * An organization that is only ever read once (a stale customer, a
 * decommissioned tenant) would otherwise leave its entry in the map for the
 * life of the pod, since nothing revisits it to notice it expired. So a
 * write amortized-sweeps expired entries once size crosses this cap, and if
 * the map is still over it afterwards, the oldest entries (by insertion
 * order) are evicted until it is not.
 */
export const MAX_CACHE_ENTRIES = 5_000;

export function perOrganizationCachedFlag({
  name,
  positiveTtlMs,
  negativeTtlMs,
}: {
  /** Identifies the gate in the warn log - never used to key the cache
   *  (each gate gets its own map by having its own closure over this call). */
  name: string;
  positiveTtlMs: number;
  negativeTtlMs: number;
}): PerOrganizationCachedFlag {
  const cached = new Map<string, CacheEntry>();
  const inFlight = new Map<string, Promise<boolean>>();

  async function get({
    organizationId,
    read,
  }: {
    organizationId: string;
    read: () => Promise<boolean>;
  }): Promise<boolean> {
    const entry = cached.get(organizationId);
    if (entry !== undefined) {
      if (Date.now() < entry.expiresAt) return entry.value;
      cached.delete(organizationId);
    }

    const pending = inFlight.get(organizationId);
    if (pending !== undefined) return pending;

    const settling = settle({ organizationId, read });
    inFlight.set(organizationId, settling);
    try {
      return await settling;
    } finally {
      inFlight.delete(organizationId);
    }
  }

  async function settle({
    organizationId,
    read,
  }: {
    organizationId: string;
    read: () => Promise<boolean>;
  }): Promise<boolean> {
    let value = false;
    try {
      value = await read();
    } catch (error) {
      // Fail safe: the caller's `read` already means "false is the safe
      // direction" for its own gate (legacy stays on, not cut over yet), so
      // the fallback here is the same value either gate wants - only the
      // silence is new, and it is gone.
      logger.warn(
        { organizationId, gate: name, error },
        "could not read the per-organization gate; caching the failure briefly and answering false",
      );
      value = false;
    }
    if (cached.size >= MAX_CACHE_ENTRIES) evictUntilUnderCap();
    cached.set(organizationId, {
      value,
      expiresAt: Date.now() + (value ? positiveTtlMs : negativeTtlMs),
    });
    return value;
  }

  /**
   * Amortized-sweep expired entries, then fall back to evicting the oldest
   * (by insertion order) until the map is back under the cap - see
   * `MAX_CACHE_ENTRIES` for why the map is bounded at all.
   */
  function evictUntilUnderCap(): void {
    const now = Date.now();
    for (const [key, entry] of cached) {
      if (entry.expiresAt <= now) cached.delete(key);
    }
    while (cached.size >= MAX_CACHE_ENTRIES) {
      const oldestKey: string | undefined = cached.keys().next().value;
      if (oldestKey === undefined) break;
      cached.delete(oldestKey);
    }
  }

  function invalidate({ organizationId }: { organizationId: string }): void {
    cached.delete(organizationId);
  }

  function resetForTesting(): void {
    cached.clear();
    inFlight.clear();
  }

  return { get, invalidate, resetForTesting };
}
