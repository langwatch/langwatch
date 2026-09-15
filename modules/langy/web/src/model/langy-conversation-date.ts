import { nowInstant, startOfDay } from "@langwatch/time";
import { readableDate } from "./langy-row-format.ts";

const DAY_MS = 24 * 60 * 60 * 1_000;

/** Compact, scannable date for a history row; the full timestamp stays native. */
export function formatLangyConversationDate(
  timestampMs: number,
  nowMs = nowInstant().epochMilliseconds,
): string {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return "Unknown date";

  const date = readableDate(timestampMs);
  const now = readableDate(nowMs);
  const startOfToday = startOfDay(now).getTime();
  const startOfDate = startOfDay(date).getTime();
  const dayDifference = Math.round((startOfToday - startOfDate) / DAY_MS);

  if (dayDifference === 0) return "Today";
  if (dayDifference === 1) return "Yesterday";

  const options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
  };
  const isAnotherYear = date.getFullYear() !== now.getFullYear();
  if (isAnotherYear) {
    options.year = "numeric";
  }

  return new Intl.DateTimeFormat(void 0, options).format(date);
}
