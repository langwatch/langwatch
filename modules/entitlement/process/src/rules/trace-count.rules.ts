import type { TraceCountState } from "../repositories/trace-count.repository.ts";

const MINUTE_MS = 60_000;

/** The first instant of the UTC minute an instant falls in. */
function minuteOf(epochMs: number): number {
  return Math.floor(epochMs / MINUTE_MS) * MINUTE_MS;
}

/** The month's traces: the seeded base plus the running total of first sightings. */
export function traceCountOf(state: TraceCountState): number {
  return (state.seeded?.traces ?? 0) + state.live;
}

/**
 * One trace first seen. After the seed it counts only from the cut's next whole minute on, since
 * trace's seed counted up to that minute; before the seed it is also kept by minute.
 */
export function countFirstSighting({
  state,
  firstSeenAt,
}: {
  state: TraceCountState;
  firstSeenAt: number;
}): TraceCountState {
  const minute = minuteOf(firstSeenAt);
  if (state.seeded) {
    return minute >= state.seeded.cutAt ? { ...state, live: state.live + 1 } : state;
  }
  const key = String(minute);
  return {
    ...state,
    live: state.live + 1,
    liveByMinute: { ...state.liveByMinute, [key]: (state.liveByMinute[key] ?? 0) + 1 },
  };
}

/**
 * Sets the seeded base once: the minutes before its cut are dropped, since the seed counted them,
 * and the rest become the running total. A later seed of the same month changes nothing.
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
  if (state.seeded) return state;
  let live = 0;
  for (const [minute, count] of Object.entries(state.liveByMinute)) {
    if (Number(minute) >= cutAt) live += count;
  }
  return { ...state, seeded: { traces, cutAt }, live, liveByMinute: {} };
}
