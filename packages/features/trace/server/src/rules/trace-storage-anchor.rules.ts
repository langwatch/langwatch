import { isValidTimestamp } from "./span-timing.rules";

/**
 * The storage-anchor rule of ADR-071, shared by every trace-processing fold that
 * writes a `PARTITION BY` / TTL column.
 *
 * A storage anchor is written ONCE. It holds a row's partition, its place in the
 * sort key and its TTL deadline still, so the fold freezes it on the first
 * contribution that carries a usable business time and never moves it again.
 * It is deliberately NOT the same value as the span timing baseline: only spans
 * ever seed that one, so sharing a column between the two jobs is what filed a
 * log-only trace (Claude Code / Codex "Path B") in partition `196952` with a TTL
 * deadline of `1970 + retention`, already years past.
 *
 * Extracted from `traceAnalytics.foldProjection.ts`, where it landed first
 * (migration 00061), so `traceSummary` (migration 00072, ADR-087) applies the
 * same rule rather than a second copy of it.
 */

/**
 * How far ahead of fold time a producer-supplied business time may still be
 * taken as the storage anchor.
 *
 * The anchor is producer-controlled where it matters: a span's own
 * `startTimeUnixMs`, which the collector accepts as any 13-digit epoch-ms value,
 * bounding only the PAST edge (`SPAN_MAX_PAST_MS`). (The other candidates are not
 * producer times - a log's envelope carries `record.acceptedAt` and a span's
 * carries ingest `Date.now()` - so the span start is the one that needs a bound,
 * and it is the one a span-led trace anchors on.) Unbounded on the future edge,
 * one span claiming to start in 2286 would fix that row's partition and its
 * `TTL toDateTime(<anchor>) + retention` deadline in 2286: a row that outlives its
 * tenant's retention policy indefinitely, that `ttlReconciler` cannot reach
 * because it anchors on the same column, and that sits outside every read window
 * so every delivery pays an unwindowed scan.
 *
 * Before the freeze this self-corrected - `min(span start)` pulled the live row
 * back into a real partition as soon as a sane span arrived, leaving only
 * orphaned versions stranded. Freezing the anchor is exactly what makes the
 * producer's value permanent, so the bound belongs to the freeze that needs it.
 *
 * A day, not an hour: client clock skew of minutes is routine and a whole day
 * still lands inside the folds' ±7-day read window, so a legitimately skewed
 * trace anchors on its own time rather than being pushed onto fold time.
 */
export const MAX_ANCHOR_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;

/**
 * Usable as a storage anchor: a valid timestamp (finite, strictly positive -
 * the same predicate `SpanTimingService` applies to span times) that is not
 * implausibly far in the future ({@link MAX_ANCHOR_FUTURE_SKEW_MS}).
 *
 * `now` is injected rather than read here so folds stay testable; callers pass
 * `Date.now()`, which is what `AbstractFoldProjection.apply` already uses to
 * stamp `updatedAt`.
 *
 * Positional, unlike the rest of this module: a type predicate has to name a
 * parameter, so it cannot be written against a destructured binding, and the
 * narrowing is load-bearing at both call sites below - each returns or stores
 * the candidate as a `number` on the strength of it.
 */
export function isUsableAnchorMs(value: number | undefined, now: number): value is number {
  return isValidTimestamp(value) && value <= now + MAX_ANCHOR_FUTURE_SKEW_MS;
}

/**
 * The first candidate that survives {@link isUsableAnchorMs}, falling back to
 * `now`. Written as a chain rather than nested ternaries because the point is
 * that EVERY step is validated: the partition column must never be the epoch,
 * and a fallback that is trusted rather than checked is how it would become one.
 */
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
  return isUsableAnchorMs(now, now) ? now : Date.now();
}

/** The two time fields every anchored trace-processing fold state carries. */
export interface AnchorableTraceState {
  /** The frozen storage anchor, epoch ms. 0 / undefined = nothing frozen yet. */
  storageAnchorMs?: number;
  /** The span timing baseline, epoch ms. Span-seeded only; 0 = no span folded. */
  occurredAt: number;
}

/**
 * Freeze the storage anchor on the first contribution that carries a usable
 * business time (ADR-071). First-observed, never `min` and never `max`: the
 * anchor's whole job is to hold a row's partition, sort position and TTL
 * deadline still, and every consequence ADR-071 prices comes from the column
 * moving rather than from which column it is.
 *
 * A span's own start time wins over the envelope's `occurredAt` when the fold
 * has one, because `span_received` stamps the envelope at ingest - a
 * long-running span's start can predate it by the span's whole duration, and
 * anchoring on ingest would move every span trace's partition off the value
 * written before the split. `state.occurredAt` holds exactly that start once
 * `SpanTimingService` has seen the span, so it is read from there rather than
 * re-derived.
 *
 * A time implausibly far in the future is refused rather than frozen
 * ({@link MAX_ANCHOR_FUTURE_SKEW_MS}) - the anchor is producer-controlled, and
 * freezing is what would make a bad one permanent. Refusing simply leaves the
 * state un-anchored, so the next contribution gets to try and, failing that, the
 * write falls back through {@link firstUsableAnchor} to fold time.
 *
 * Handles no event itself - each fold's `apply` calls it once per event, after
 * the handler, so every contribution type anchors without every handler
 * remembering to.
 *
 * An anchor that is already positive is left alone even when it fails the future
 * bound. That is deliberate: re-freezing it here would move a committed row's
 * partition on an ordinary delivery, whereas the write path re-validates it once
 * and rewrites it exactly once (see each fold's projection function).
 */
export function anchorStorageTime<State extends AnchorableTraceState>({
  state,
  eventOccurredAtMs,
  now = Date.now(),
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
