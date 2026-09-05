/**
 * The cache behind the authz engine gate and the identity write gate: a boolean answer, cached
 * per SUBJECT with a TTL so a finishing migration takes effect fleet-wide without a deploy.
 */
import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:app-layer:per-subject-cached-gate");

type CacheEntry = { isOn: boolean; expiresAt: number };

/**
 * One in-flight read, plus the right to cache what it resolves.
 */
type InFlightEntry = { promise: Promise<boolean>; isStale: boolean };

export type PerSubjectCachedFlag = {
  /**
   * The cached answer for one subject, reading through `read` on a
   * cache miss. Concurrent calls for the same subject while that read
   * is in flight all resolve to the SAME promise - `read` runs once.
   */
  get(args: { subject: string; read: () => Promise<boolean> }): Promise<boolean>;
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
   * Hard cap on distinct subjects this gate holds at once (default `MAX_CACHE_ENTRIES`).
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
      // Same reason `invalidate` marks: a read still in flight must not
      // land in the map the reset just emptied.
      for (const pending of state.inFlight.values()) pending.isStale = true;
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
  let isOn: boolean;
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

function invalidate({ state, subject }: { state: GateState; subject: string }): void {
  state.cached.delete(subject);
  const pending = state.inFlight.get(subject);
  if (pending !== undefined) {
    pending.isStale = true;
    state.inFlight.delete(subject);
  }
}
