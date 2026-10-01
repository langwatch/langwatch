/**
 * "Last used" as somebody deciding whether to delete something needs it: relative
 * in the near past, a date in the far past, and nothing at all when no session
 * we still hold names it — absence is not "never used".
 */

import { type Instant, nowInstant, Temporal } from "@langwatch/time";

import { readableDate } from "../../../model/display-formatters.ts";

const DAY_MS = 86_400_000;

function instantsOf(isoTimestamp: string): Instant[] {
  try {
    return [Temporal.Instant.from(isoTimestamp)];
  } catch {
    return [];
  }
}

export function lastUsedLabel({
  isoTimestamp,
  now = nowInstant(),
}: {
  isoTimestamp: string | null | undefined;
  now?: Instant;
}): string | undefined {
  if (!isoTimestamp) return void 0;
  const [used] = instantsOf(isoTimestamp);
  if (!used) return void 0;

  const elapsedMs = now.epochMilliseconds - used.epochMilliseconds;
  const days = Math.floor(Math.max(0, elapsedMs) / DAY_MS);

  if (days === 0) return "Last used today";
  if (days === 1) return "Last used yesterday";
  if (days < 30) return `Last used ${days} days ago`;
  return `Last used ${readableDate(used.epochMilliseconds).toLocaleDateString(void 0, {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}`;
}
