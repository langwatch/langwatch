export function formatDuration(ms: number): string {
  if (ms < 1_000) {
    return `${Math.round(ms)}ms`;
  }

  return `${(ms / 1_000).toFixed(1)}s`;
}

/**
 * Four decimals would print a sub-cent call as "$0.0000", which reads as a
 * model with no price. Below a tenth of a cent the cost is rounded to its two
 * leading digits instead, with no padding after them.
 */
export function formatCost(cost: number, estimated?: boolean): string {
  if (cost === 0) {
    return "—";
  }

  const prefix = estimated ? "~" : "";
  if (cost > 0 && cost < 0.001) {
    // 100 is the most decimals toFixed accepts.
    const decimals = Math.min(1 - Math.floor(Math.log10(cost)), 100);
    const rounded = cost.toFixed(decimals);
    // A cost that rounds up to a tenth of a cent reads like one.
    if (Number(rounded) < 0.001) {
      return `${prefix}$${rounded.replace(/0+$/, "")}`;
    }
  }

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
