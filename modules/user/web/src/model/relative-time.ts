import { nowInstant } from "@langwatch/time";
import { readableDate } from "./display-formatters.ts";
/**
 * Relative time since an event, coarsening with distance.
 * Returns "Never" if the timestamp is absent.
 */
export function formatRelativeTime(ms: number | null | undefined): string {
  if (!ms) return "Never";

  const sec = Math.floor((nowInstant().epochMilliseconds - ms) / 1000);
  if (sec < 60) return `${sec}s ago`;

  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;

  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;

  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;

  return readableDate(ms).toLocaleDateString();
}
