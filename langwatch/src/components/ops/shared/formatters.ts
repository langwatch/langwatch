export function formatRate(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  if (value >= 100) return value.toFixed(0);
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

export function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toString();
}

export function formatMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms.toFixed(0)}ms`;
}

/**
 * Format duration between two timestamps, or elapsed time from start until now.
 * When `completedAt` is null/undefined, computes elapsed from `startedAt` to now.
 */
export function formatDuration(
  startedAt: string,
  completedAt?: string | null,
): string {
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const ms = end - new Date(startedAt).getTime();
  if (ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hours}h ${remainMins}m ${secs}s`;
}

export function formatTimeAgo(ms: number | null): string {
  if (ms === null) return "—";
  const diff = Date.now() - ms;
  const absDiff = Math.abs(diff);
  const seconds = Math.floor(absDiff / 1000);
  const isFuture = diff < 0;
  const prefix = isFuture ? "in " : "";
  const suffix = isFuture ? "" : " ago";
  if (seconds < 60) return `${prefix}${seconds}s${suffix}`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${prefix}${minutes}m${suffix}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${prefix}${hours}h${suffix}`;
  const days = Math.floor(hours / 24);
  return `${prefix}${days}d${suffix}`;
}
