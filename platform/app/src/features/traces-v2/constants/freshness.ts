/**
 * Window in which a trace is treated as "live" — spans may still be arriving,
 * so the drawer polls on the live cadence. Older traces are considered settled
 * and rely on focus + manual refresh.
 */
export const LIVE_WINDOW_MS = 3 * 60 * 1000;

/** Refetch cadence for live (recent) traces in the drawer. */
export const LIVE_REFETCH_MS = 10_000;
