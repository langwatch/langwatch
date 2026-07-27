/**
 * Shared number and date formatting.
 *
 * Ops numbers get abbreviated hard — a phone screen has room for "1.2M", not
 * "1,234,567", and an operator scanning for an order of magnitude is better
 * served by the short form anyway.
 */

export function formatCount(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude < 1_000) return String(value);
  if (magnitude < 1_000_000) return trimmed(value / 1_000, "k");
  if (magnitude < 1_000_000_000) return trimmed(value / 1_000_000, "M");
  return trimmed(value / 1_000_000_000, "B");
}

export function formatRate(value: number): string {
  if (value === 0) return "0";
  if (Math.abs(value) < 10) return value.toFixed(1);
  return formatCount(Math.round(value));
}

export function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

export function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let size = value / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size < 10 ? size.toFixed(1) : Math.round(size)} ${units[unit]}`;
}

export function formatMilliseconds(value: number): string {
  if (value < 1) return "<1ms";
  if (value < 1_000) return `${Math.round(value)}ms`;
  return `${(value / 1_000).toFixed(1)}s`;
}

/** A duration written the way an operator says it out loud: 4m, 3h, 2d. */
export function formatDuration(seconds: number): string {
  const value = Math.abs(seconds);
  if (value < 60) return `${Math.round(value)}s`;
  if (value < 3_600) return `${Math.floor(value / 60)}m`;
  if (value < 86_400) return `${Math.floor(value / 3_600)}h`;
  return `${Math.floor(value / 86_400)}d`;
}

/**
 * "4m ago", or "just now" inside the first few seconds so a screen that has just
 * refreshed does not flicker "0s ago".
 */
export function formatRelative(date: Date, now: Date = new Date()): string {
  const elapsedMs = now.getTime() - date.getTime();
  if (elapsedMs < 0) return `in ${formatDuration(-elapsedMs / 1000)}`;
  if (elapsedMs < 5_000) return "just now";
  return `${formatDuration(elapsedMs / 1000)} ago`;
}

/** Unix milliseconds, as the ops payloads carry them. */
export function formatRelativeMs(ms: number, now: Date = new Date()): string {
  return formatRelative(new Date(ms), now);
}

export function formatDateTime(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    // Better to show whatever the instance sent than to render an em dash and
    // lose the only information there was.
    return typeof value === "string" ? value : "—";
  }
  return date.toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function trimmed(value: number, suffix: string): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded)
    ? `${rounded}${suffix}`
    : `${rounded.toFixed(1)}${suffix}`;
}
