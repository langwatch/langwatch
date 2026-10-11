import type { TraceCountState } from "../repositories/trace-count.repository.ts";

/** The month's traces: the upgrade's count plus one per new-trace event. */
export function traceCountOf(state: TraceCountState): number {
  return state.counted + state.live;
}

/** One new-trace event. */
export function addNewTrace(state: TraceCountState): TraceCountState {
  return { ...state, live: state.live + 1 };
}

/** The upgrade's count for the month; the same event again sets the same value. */
export function setMonthCount({
  state,
  traces,
}: {
  state: TraceCountState;
  traces: number;
}): TraceCountState {
  return { ...state, counted: traces };
}
