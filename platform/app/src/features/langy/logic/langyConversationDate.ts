const DAY_MS = 24 * 60 * 60 * 1_000;

/** Compact, scannable date for a history row; the full timestamp stays native. */
export function formatLangyConversationDate(
  timestampMs: number,
  nowMs = Date.now(),
): string {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return "Unknown date";

  const date = new Date(timestampMs);
  const now = new Date(nowMs);
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const startOfDate = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
  const dayDifference = Math.round((startOfToday - startOfDate) / DAY_MS);

  if (dayDifference === 0) return "Today";
  if (dayDifference === 1) return "Yesterday";

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear()
      ? {}
      : { year: "numeric" as const }),
  }).format(date);
}
