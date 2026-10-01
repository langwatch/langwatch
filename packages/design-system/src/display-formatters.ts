export function formatDuration(ms: number): string {
  if (ms < 1_000) {
    return `${Math.round(ms)}ms`;
  }

  return `${(ms / 1_000).toFixed(1)}s`;
}

export function formatCost(cost: number, estimated?: boolean): string {
  if (cost === 0) {
    return "—";
  }

  const prefix = estimated ? "~" : "";
  if (cost < 0.01) {
    return `${prefix}$${cost.toFixed(4)}`;
  }

  return `${prefix}$${cost.toFixed(2)}`;
}

export function formatTokens(tokens: number): string {
  if (tokens === 0) {
    return "—";
  }

  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }

  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`;
  }

  return `${tokens}`;
}
