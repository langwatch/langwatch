import { nowInstant } from "@langwatch/time";
/**
 * "16d ago", for the sample spans under the cost-rule regex field. `@langwatch/trace-web` holds
 * an unpublished copy from the trace explorer; stated locally since there's no shared home yet.
 */

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

/**
 * How long ago a moment was, compactly.
 *
 * No space between the number and the unit so it stays tight at the preview
 * row's size, and an explicit "ago" so a reader scanning a dense row is not
 * left wondering whether `16d` is an age or a duration.
 */
export function formatRelativeTimeAgo(timestamp: number): string {
  const elapsed = nowInstant().epochMilliseconds - timestamp;
  if (elapsed < MS_PER_MINUTE) return "just now";
  if (elapsed < MS_PER_HOUR) return `${Math.floor(elapsed / MS_PER_MINUTE)}m ago`;
  if (elapsed < MS_PER_DAY) return `${Math.floor(elapsed / MS_PER_HOUR)}h ago`;
  return `${Math.floor(elapsed / MS_PER_DAY)}d ago`;
}
