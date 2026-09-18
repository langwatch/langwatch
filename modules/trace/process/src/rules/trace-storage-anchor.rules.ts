import { nowInstant } from "@langwatch/time";

import { isValidTimestamp } from "./span-timing.rules.ts";

// Storage-anchor rule of ADR-071; shared by every trace-processing fold that
// writes PARTITION BY / TTL column. Frozen on first usable business time.

// Max future skew for producer-supplied business time; freezing the anchor makes
// the value permanent, so bound belongs to the freeze
export const MAX_ANCHOR_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;

// Usable storage anchor: valid timestamp not implausibly far in future.
// Injected now for testability; narrowing is load-bearing at call sites.
export function isUsableAnchorMs(value: number | undefined, now: number): value is number {
  return isValidTimestamp(value) && value <= now + MAX_ANCHOR_FUTURE_SKEW_MS;
}

// First usable candidate from isUsableAnchorMs, falling back to now. Every
// step validated so partition column never becomes epoch.
export function firstUsableAnchor({
  candidates,
  now,
}: {
  candidates: readonly (number | undefined)[];
  now: number;
}): number {
  for (const candidate of candidates) {
    if (isUsableAnchorMs(candidate, now)) return candidate;
  }
  // The terminal step is checked too, so the invariant is structural rather
  // than a convention every caller has to keep. No production caller injects
  // `now`, but one that injected 0 would otherwise land the row in 196952 -
  // the single outcome this whole rule exists to prevent.
  return isUsableAnchorMs(now, now) ? now : nowInstant().epochMilliseconds;
}

/** The two time fields every anchored trace-processing fold state carries. */
export interface AnchorableTraceState {
  /** The frozen storage anchor, epoch ms. 0 / undefined = nothing frozen yet. */
  storageAnchorMs?: number;
  /** The span timing baseline, epoch ms. Span-seeded only; 0 = no span folded. */
  occurredAt: number;
}

// Freeze storage anchor on first usable business time @see ADR-071. First-observed
// never min/max. Span start time wins over envelope's occurredAt.
export function anchorStorageTime<State extends AnchorableTraceState>({
  state,
  eventOccurredAtMs,
  now = nowInstant().epochMilliseconds,
}: {
  state: State;
  eventOccurredAtMs: number | undefined;
  now?: number;
}): State {
  if ((state.storageAnchorMs ?? 0) > 0) return state;
  const candidate = isUsableAnchorMs(state.occurredAt, now) ? state.occurredAt : eventOccurredAtMs;
  if (!isUsableAnchorMs(candidate, now)) return state;
  return { ...state, storageAnchorMs: candidate };
}
