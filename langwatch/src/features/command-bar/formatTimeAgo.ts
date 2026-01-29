/**
 * Format a timestamp as a relative time string (e.g., "2m ago", "1h ago").
 *
 * @param timestamp - Unix timestamp in milliseconds
 * @returns A human-readable relative time string
 *
 * @example
 * formatTimeAgo(Date.now() - 30000) // "now"
 * formatTimeAgo(Date.now() - 5 * 60 * 1000) // "5m ago"
 * formatTimeAgo(Date.now() - 2 * 60 * 60 * 1000) // "2h ago"
 */
export function formatTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}
