import type { Event } from "../domain/types.ts";
import type { SubscriberDispatchOptions } from "./subscriber.types.ts";

/** The payload a subscriber's job-id and group-key functions receive. */
export type SubscriberJobPayload = { event: Event; foldState: unknown };

/**
 * Fire at most once per window per job id; delay + dedup strategy ensure no
 * duplicate dispatch. extend:false pins deadline to first event for throttling.
 */
export function throttledWindow<E extends Event>({
  makeId,
  windowMs,
  dedupTtlMs = windowMs,
  shouldSurviveDispatch = false,
}: {
  makeId: (event: E, state?: unknown) => string;
  /** How long to hold events before firing, and the default dedup TTL. */
  windowMs: number;
  /** Override when the suppression window must outlast the firing delay. */
  dedupTtlMs?: number;
  shouldSurviveDispatch?: boolean;
}): {
  delay: number;
  dedup: {
    /**
     * Keeps the caller's `(event, state?)` arity: `staticBuilder` forwards the
     * committed fold state here, so narrowing this to `(event)` would make a
     * direct consumer unable to pass what the builder already passes.
     */
    makeId: (event: E, state?: unknown) => string;
    ttlMs: number;
    extend: false;
    replace: true;
    shouldSurviveDispatch: boolean;
  };
} {
  return {
    delay: windowMs,
    dedup: {
      makeId,
      ttlMs: dedupTtlMs,
      extend: false,
      replace: true,
      shouldSurviveDispatch,
    },
  };
}

export function throttledPerWindow({
  makeJobId,
  windowMs,
  dedupTtlMs = windowMs,
  shouldSurviveDispatch = false,
}: {
  makeJobId: (payload: SubscriberJobPayload) => string;
  /** How long to hold events before firing, and the default dedup TTL. */
  windowMs: number;
  /** Override when the suppression window must outlast the firing delay. */
  dedupTtlMs?: number;
  shouldSurviveDispatch?: boolean;
}): Pick<SubscriberDispatchOptions, "delay" | "makeJobId" | "deduplication"> {
  return {
    delay: windowMs,
    // Kept alongside `deduplication` on purpose: the queue reads the latter,
    // but the router's pre-staging batch collapse only knows about this one.
    makeJobId,
    deduplication: {
      makeId: makeJobId,
      ttlMs: dedupTtlMs,
      extend: false,
      replace: true,
      shouldSurviveDispatch,
    },
  };
}
