import type { Event } from "../domain/types";
import type { ReactorOptions } from "./reactor.types";

/** The payload a reactor's job-id and group-key functions receive. */
export type ReactorJobPayload = { event: Event; foldState: unknown };

/**
 * Options that make a reactor fire at most once per window per job id.
 *
 * A reactor that sets only `makeJobId` + `ttl` does NOT get a window. Its
 * `delay` is 0, so the job dispatches on the first event; dispatch takes the
 * job out of staging, the next event's dedup lookup therefore misses, and the
 * key is deleted and restaged. Every event gets its own job and the TTL never
 * bites. A window needs a `delay` — the dedup key is what collapses events,
 * but only for as long as the job is still waiting to dispatch.
 *
 * `extend: false` is the load-bearing choice. A reactor's queue score is the
 * event's own `createdAt`, so dispatch lands at `createdAt + delay`. Extending
 * on every event would re-arm that deadline against the newest event and a
 * continuously-streaming aggregate would push its own job forward forever,
 * never firing while the stream lasts. Pinning the deadline to the event that
 * opened the window turns it into a throttle: it fires `windowMs` after the
 * first event, carrying the newest payload (`replace` stays on), and the next
 * event opens a fresh window.
 *
 * `shouldSurviveDispatch` defaults to false, and callers should think hard before
 * setting it. It discards triggers that arrive after dispatch while the TTL
 * runs, which is right for work that must not repeat, and wrong for anything
 * level-triggered: dropping the LAST event of an aggregate leaves whatever
 * partial state the previous one wrote as the final answer. Only set it when
 * the handler reads nothing from the event it was given.
 *
 * `makeJobId` is deliberately reused as the deduplication id. They are read by
 * two different layers — the router collapses a coalesced batch by `makeJobId`
 * before staging, the queue squashes by `deduplication.makeId` after — and the
 * two layers disagreeing would silently stage duplicates the collapse thought
 * it had already removed. Taking one function and using it for both makes them
 * impossible to drift apart.
 */
export function throttledPerWindow({
  makeJobId,
  windowMs,
  dedupTtlMs = windowMs,
  shouldSurviveDispatch = false,
}: {
  makeJobId: (payload: ReactorJobPayload) => string;
  /** How long to hold events before firing, and the default dedup TTL. */
  windowMs: number;
  /** Override when the suppression window must outlast the firing delay. */
  dedupTtlMs?: number;
  shouldSurviveDispatch?: boolean;
}): Pick<ReactorOptions, "delay" | "makeJobId" | "deduplication"> {
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
