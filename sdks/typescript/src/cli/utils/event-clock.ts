/**
 * Timestamps for the chronological listings the CLI prints one line at a time:
 * `sessions events` and `traces transcript`.
 *
 * Local time, because the reader compares these stamps against their own shell
 * history and their own memory of when something happened. A UTC clock with no
 * marker on it reads as their wall clock, silently shifted by their offset.
 *
 * The date is not on every line, which would be noise on a listing where nearly
 * every entry shares one. A listing prints it once at the top and again
 * whenever the local day rolls over, so two stamps either side of midnight are
 * still told apart.
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
