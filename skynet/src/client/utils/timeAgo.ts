export function timeAgo(ms: number | null): string {
  if (!ms) return "-";
  const diff = Date.now() - ms;
  if (diff < 0) {
    const a = -diff;
    if (a < 1000) return "in <1s";
    if (a < 60000) return `in ${Math.floor(a / 1000)}s`;
    if (a < 3600000) return `in ${Math.floor(a / 60000)}m`;
    return `in ${Math.floor(a / 3600000)}h`;
  }
  if (diff < 1000) return "<1s ago";
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}
