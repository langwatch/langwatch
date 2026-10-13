/**
 * Window in which a trace is treated as "live" — spans may still be arriving,
 * so the drawer follows the live stream. Older traces are considered settled
 * and rely on read hints + manual refresh.
 */
export const LIVE_WINDOW_MS = 3 * 60 * 1000;
