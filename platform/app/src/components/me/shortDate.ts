import { format } from "date-fns";

/**
 * A date as a table cell wants it: "Aug 3" within the current year, "Aug 3,
 * 2025" outside it. The year is what a reader needs to disambiguate an old
 * row, and repeating it on every current-year row is noise.
 */
export function formatShortDate({
  timestampMs,
  now = Date.now(),
}: {
  timestampMs: number;
  now?: number;
}): string {
  const date = new Date(timestampMs);
  if (Number.isNaN(date.getTime())) return "";
  const isSameYear = date.getFullYear() === new Date(now).getFullYear();
  return format(date, isSameYear ? "MMM d" : "MMM d, yyyy");
}
