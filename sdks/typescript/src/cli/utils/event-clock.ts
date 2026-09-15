/**
 * Timestamps for CLI listings (`sessions events`, `traces transcript`), in
 * the reader's local time — a bare UTC stamp would silently read as their own
 * wall clock. The date prints once at the top and again on each local-day
 * rollover, not on every line, since most entries share one.
 */

const pad = (value: number): string => String(value).padStart(2, "0");

/** `14:03:22`, in the reader's own timezone, always 24 hour. */
export const clockTime = (atMs: number): string => {
  const at = new Date(atMs);
  return `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
};

/**
 * The reader's calendar day for an instant, as a comparable key. Only ever
 * compared against another one of these, so it is deliberately not a display
 * format.
 */
export const localDay = (atMs: number): string => {
  const at = new Date(atMs);
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
};

/** The date heading a listing prints when the reader's day changes. */
export const dayHeading = (atMs: number): string =>
  new Date(atMs).toLocaleDateString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
