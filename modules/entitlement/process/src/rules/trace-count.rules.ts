import type { TraceCountState } from "../repositories/trace-count.repository.ts";

const HOUR_MS = 3_600_000;

/** The month's traces: the seeded base plus every first sighting at or after its cut. */
export function traceCountOf(state: TraceCountState): number {
  const cutAt = state.seeded?.cutAt ?? Number.NEGATIVE_INFINITY;
  let live = 0;
  for (const [hour, count] of Object.entries(state.liveByHour)) {
    if (Number(hour) >= cutAt) live += count;
  }
  return (state.seeded?.traces ?? 0) + live;
}

/**
 * One trace first seen: counted in its hour, unless the seed already counted it. Facts are
 * idempotency-keyed by trace and month, and the executor drops redelivered event ids.
 */
export function countFirstSighting({
  state,
  firstSeenAt,
}: {
  state: TraceCountState;
  firstSeenAt: number;
}): TraceCountState {
  if (state.seeded && firstSeenAt < state.seeded.cutAt) return state;
  const hour = String(Math.floor(firstSeenAt / HOUR_MS) * HOUR_MS);
  return {
    ...state,
    liveByHour: { ...state.liveByHour, [hour]: (state.liveByHour[hour] ?? 0) + 1 },
  };
}

/**
 * Sets the seeded base. The latest cut wins whatever the arrival order, and hours before it are
 * dropped: the seed counted them. Trace cuts on a whole hour, so no hour straddles the cut.
 */
export function setSeededBase({
  state,
  traces,
  cutAt,
}: {
  state: TraceCountState;
  traces: number;
  cutAt: number;
}): TraceCountState {
  if (state.seeded && cutAt < state.seeded.cutAt) return state;
  const liveByHour = Object.fromEntries(
    Object.entries(state.liveByHour).filter(([hour]) => Number(hour) >= cutAt),
  );
  return { ...state, seeded: { traces, cutAt }, liveByHour };
}
