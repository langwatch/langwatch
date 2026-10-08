import { format, nowInstant } from "@langwatch/time";

import { readableDate } from "../display-formatters.ts";

/**
 * A date as a table cell wants it: "Aug 3" within the current year, "Aug 3,
 * 2025" outside it. The year is what a reader needs to disambiguate an old
 * row, and repeating it on every current-year row is noise.
 */
export function formatShortDate({
  timestampMs,
  now = nowInstant().epochMilliseconds,
}: {
  timestampMs: number;
  now?: number;
}): string {
  if (!Number.isFinite(timestampMs)) return "";
  const date = readableDate(timestampMs);
  const isSameYear = date.getFullYear() === readableDate(now).getFullYear();
  return format(date, isSameYear ? "MMM d" : "MMM d, yyyy");
}
