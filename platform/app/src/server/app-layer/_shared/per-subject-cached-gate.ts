/**
 * The cache behind the authz engine gate (../authz/engine-gate.ts) and the
 * identity write gate (../identity/identifier-write-gate.ts): a boolean
 * answer, asked once per check, cached per SUBJECT - an organization for
 * authz, a user for identity - with a TTL so a finishing migration takes
 * effect fleet-wide without a deploy. Each gate owns its question; this
 * module owns the caching once.
 *
 * Three behaviours live here that the hand-rolled caches this replaced did
 * not have:
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

const logger = createLogger("langwatch:app-layer:per-subject-cached-gate");

type CacheEntry = { isOn: boolean; expiresAt: number };

/**
 * One in-flight read, plus the right to cache what it resolves. `invalidate`
 * flips `isStale` on the entry it removes, so a read that started BEFORE the
 * invalidation still answers the callers already coalesced onto it (that
 * answer was unavoidable - the read had begun) but never writes the cache:
 * without the flag, a read racing a projection write could settle AFTER the
 * invalidation and re-cache the pre-write answer for a further TTL.
 */
type InFlightEntry = { promise: Promise<boolean>; isStale: boolean };

export type PerSubjectCachedFlag = {
  /**
   * The cached answer for one subject, reading through `read` on a
   * cache miss. Concurrent calls for the same subject while that read
   * is in flight all resolve to the SAME promise - `read` runs once.
   */
  get(args: {
    subject: string;
    read: () => Promise<boolean>;
  }): Promise<boolean>;
  /** Drop ONE subject's cached answer AND its in-flight read's right
   *  to cache: a read racing the invalidation may still answer its own
   *  callers with the old value, but it will not cache it, and the next
   *  `get` starts a fresh read. Pod-local, exactly as the TTL is pod-local;
   *  every other pod converges on the TTL. */
  invalidate(args: { subject: string }): void;
  /** The cache, dropped - for tests that flip a subject mid-suite. */
  resetForTesting(): void;
};

/**
 * Default hard cap on distinct subjects one gate holds at once.
 *
 * A subject that is only ever read once (a stale customer, a
 * decommissioned tenant, a user who never returns) would otherwise leave its entry in the map for the
 * life of the pod, since nothing revisits it to notice it expired. So a
 * write amortized-sweeps expired entries once size crosses this cap, and if
 * the map is still over it afterwards, the oldest entries (by insertion
 * order) are evicted until it is not.
 */
export const MAX_CACHE_ENTRIES = 5_000;

/** One gate's closed-over state - the maps plus what settles/evicts them. */
type GateState = {
  name: string;
  ttlMs: number;
  maxEntries: number;
  cached: Map<string, CacheEntry>;
  inFlight: Map<string, InFlightEntry>;
};

/** One cached boolean per subject (an organization for authz, a user for
 *  identity), both directions on one bound. */
export function perSubjectCachedFlag({
  name,
  ttlMs,
  maxEntries = MAX_CACHE_ENTRIES,
}: {
  /** Identifies the gate in the warn log - never used to key the cache
   *  (each gate gets its own map by having its own closure over this call). */
  name: string;
  ttlMs: number;
  /**
   * Hard cap on distinct subjects this gate holds at once (default
   * `MAX_CACHE_ENTRIES`). Size it to the subject's cardinality: a
   * high-cardinality subject (a user) warrants a larger cap than a
   * low-cardinality one (an organization), or hot subjects evict each
   * other and every check re-reads the source.
   */
  maxEntries?: number;
}): PerSubjectCachedFlag {
  const state: GateState = {
    name,
    ttlMs,
    maxEntries,
    cached: new Map(),
    inFlight: new Map(),
  };
  return {
    get: (args) => get({ state, ...args }),
    invalidate: ({ subject }) => invalidate({ state, subject }),
    resetForTesting: () => {
      state.cached.clear();
      state.inFlight.clear();
    },
  };
}

async function get({
  state,
  subject,
  read,
}: {
  state: GateState;
  subject: string;
  read: () => Promise<boolean>;
}): Promise<boolean> {
  const entry = state.cached.get(subject);
  if (entry !== undefined) {
    if (Date.now() < entry.expiresAt) return entry.isOn;
    state.cached.delete(subject);
  }

  const pending = state.inFlight.get(subject);
  if (pending !== undefined) return pending.promise;

  const flight: InFlightEntry = {
    isStale: false,
    promise: Promise.resolve(false),
  };
  flight.promise = settle({ state, subject, read, flight });
  state.inFlight.set(subject, flight);
  try {
    return await flight.promise;
  } finally {
    // An invalidation may already have removed this flight and a NEWER one
    // may have taken the slot - deleting unconditionally would tear that
    // newer read's coalescing down.
    if (state.inFlight.get(subject) === flight) {
      state.inFlight.delete(subject);
    }
  }
}

async function settle({
  state,
  subject,
  read,
  flight,
}: {
  state: GateState;
  subject: string;
  read: () => Promise<boolean>;
  flight: InFlightEntry;
}): Promise<boolean> {
  let isOn = false;
  try {
    isOn = await read();
  } catch (error) {
    // Fail safe: the caller's `read` already means "false is the safe
    // direction" for its own gate (legacy stays on, not cut over yet), so
    // the fallback here is the same value either gate wants - only the
    // silence is new, and it is gone.
    logger.warn(
      { subject, gate: state.name, error },
      "could not read the per-subject gate; caching the failure briefly and answering false",
    );
    isOn = false;
  }
  // Invalidated while this read was in flight: the value predates the
  // write that invalidated it, so hand it to the callers already waiting
  // (they coalesced before the invalidation) but never cache it - the next
  // `get` re-reads the source.
  if (flight.isStale) return isOn;
  if (state.cached.size >= state.maxEntries) evictUntilUnderCap({ state });
  state.cached.set(subject, { isOn, expiresAt: Date.now() + state.ttlMs });
  return isOn;
}

/**
 * Amortized-sweep expired entries, then fall back to evicting the oldest
 * (by insertion order) until the map is back under the cap - see
 * `MAX_CACHE_ENTRIES` for why the map is bounded at all.
 */
function evictUntilUnderCap({ state }: { state: GateState }): void {
  const now = Date.now();
  for (const [key, entry] of state.cached) {
    if (entry.expiresAt <= now) state.cached.delete(key);
  }
  while (state.cached.size >= state.maxEntries) {
    const oldestKey: string | undefined = state.cached.keys().next().value;
    if (oldestKey === undefined) break;
    state.cached.delete(oldestKey);
  }
}

function invalidate({
  state,
  subject,
}: {
  state: GateState;
  subject: string;
}): void {
  state.cached.delete(subject);
  const pending = state.inFlight.get(subject);
  if (pending !== undefined) {
    pending.isStale = true;
    state.inFlight.delete(subject);
  }
}
