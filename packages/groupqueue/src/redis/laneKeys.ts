/**
 * Every key for one lane, derived by appending a suffix after `groupKey`'s
 * closing hash-tag brace. Redis Cluster hashes only the first `{…}`, so every
 * suffixed key still lands on the same slot as the bare group key
 * (`packages/event-sourcing/src/dispatch/groupKey.ts` renders that tag).
 */
export interface LaneKeys {
  readonly z: string;
  readonly h: string;
  readonly b: string;
  readonly seq: string;
  readonly lease: string;
  readonly ready: string;
  readonly parked: string;
}

export function laneKeys(groupKey: string): LaneKeys {
  return {
    z: `${groupKey}:z`,
    h: `${groupKey}:h`,
    b: `${groupKey}:b`,
    seq: `${groupKey}:seq`,
    lease: `${groupKey}:lease`,
    ready: `${groupKey}:ready`,
    parked: `${groupKey}:parked`,
  };
}

/** Registry of every lane ever staged into, so `claim` can enumerate
 * candidates without an O(keyspace) SCAN. Not hash-tagged: it is touched only
 * by single-key commands, never inside a lane's multi-key script. */
export const LANE_REGISTRY_KEY = "groupqueue:lanes";

/** One tenant's currently-leased lanes: member = groupKey, score = the
 * lease's own expiry, so a dead worker's slot ages out on its own without an
 * explicit release (ADR-108 decision 5's soft cap, realised here as a
 * defense-in-depth circuit breaker independent of scheduler.ts's own policy —
 * both may run; this one only ever narrows what claim() considers). */
export function tenantInFlightKey(tenantId: string): string {
  return `groupqueue:tenant-inflight:${tenantId}`;
}
