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
 *   - `invalidate` beats a racing read. Dropping only the cached entry left
 *     a hole: a read that started (or coalesced) just before a projection
 *     write could settle just after it and cache the pre-write answer for a
 *     further TTL. Invalidation therefore also detaches the in-flight read
 *     and strips its right to cache - its already-coalesced callers still
 *     get its answer once, but nothing remembers it.
 *
 * Browser-safety: no module-scope Prisma or Redis - callers hand in their own
 * client through `read`.
 */
import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:authz:per-organization-cached-gate");

type CacheEntry = { value: boolean; expiresAt: number };

/**
 * One in-flight read, plus the right to cache what it resolves. `invalidate`
 * flips `stale` on the entry it removes, so a read that started BEFORE the
 * invalidation still answers the callers already coalesced onto it (that
 * answer was unavoidable - the read had begun) but never writes the cache:
 * without the flag, a read racing a projection write could settle AFTER the
 * invalidation and re-cache the pre-write answer for a further TTL.
 */
type InFlightEntry = { promise: Promise<boolean>; stale: boolean };

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
  /** Drop ONE organization's cached answer AND its in-flight read's right
   *  to cache: a read racing the invalidation may still answer its own
   *  callers with the old value, but it will not cache it, and the next
   *  `get` starts a fresh read. Pod-local, exactly as the TTL is pod-local;
   *  every other pod converges on the TTL. */
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
  const inFlight = new Map<string, InFlightEntry>();

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
    if (pending !== undefined) return pending.promise;

    const flight: InFlightEntry = {
      stale: false,
      promise: Promise.resolve(false),
    };
    flight.promise = settle({ organizationId, read, flight });
    inFlight.set(organizationId, flight);
    try {
      return await flight.promise;
    } finally {
      // An invalidation may already have removed this flight and a NEWER one
      // may have taken the slot - deleting unconditionally would tear that
      // newer read's coalescing down.
      if (inFlight.get(organizationId) === flight) {
        inFlight.delete(organizationId);
      }
    }
  }

  async function settle({
    organizationId,
    read,
    flight,
  }: {
    organizationId: string;
    read: () => Promise<boolean>;
    flight: InFlightEntry;
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
    // Invalidated while this read was in flight: the value predates the
    // write that invalidated it, so hand it to the callers already waiting
    // (they coalesced before the invalidation) but never cache it - the next
    // `get` re-reads the source.
    if (flight.stale) return value;
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
    const pending = inFlight.get(organizationId);
    if (pending !== undefined) {
      pending.stale = true;
      inFlight.delete(organizationId);
    }
  }

  function resetForTesting(): void {
    cached.clear();
    inFlight.clear();
  }

  return { get, invalidate, resetForTesting };
}
