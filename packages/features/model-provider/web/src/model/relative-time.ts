/**
 * "16d ago", for the sample spans under the cost-rule regex field.
 *
 * Recovered with the preview from `platform/app`, where it came out of the
 * trace explorer's display formatters. `@langwatch/trace-web` still holds that
 * copy and does not publish it, and the Design System publishes `formatCost`
 * and `formatTokens` — which the preview does import from there — but nothing
 * for relative time. Four lines with one dependency and no home to share, so it
 * is stated here rather than pulled through a package boundary that does not
 * exist yet.
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
  const elapsed = Date.now() - timestamp;
  if (elapsed < MS_PER_MINUTE) return "just now";
  if (elapsed < MS_PER_HOUR) return `${Math.floor(elapsed / MS_PER_MINUTE)}m ago`;
  if (elapsed < MS_PER_DAY) return `${Math.floor(elapsed / MS_PER_HOUR)}h ago`;
  return `${Math.floor(elapsed / MS_PER_DAY)}d ago`;
}
