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

  if (cost >= 1_000) {
    return `${prefix}${compactNumber({ value: cost, currency: "USD" })}`;
  }

  if (cost < 0.01) {
    return `${prefix}$${cost.toFixed(4)}`;
  }

  return `${prefix}$${cost.toFixed(2)}`;
}

export function formatTokens(tokens: number, locale?: string): string {
  if (tokens === 0) {
    return "—";
  }

  if (Math.abs(tokens) >= 1_000) {
    return compactNumber({ value: tokens, locale });
  }

  return `${tokens}`;
}

/** Scales to the right unit (3e9 reads "3B", never "3000M") in the viewer's locale. */
export function compactNumber({
  value,
  locale,
  currency,
}: {
  value: number;
  locale?: string;
  currency?: string;
}): string {
  return new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
    ...(currency ? { style: "currency", currency } : {}),
  }).format(value);
}

/** The same value through every lens a hover popover lists. */
export function describeNumber({
  value,
  locale,
  currency,
}: {
  value: number;
  locale?: string;
  currency?: string;
}) {
  const style = currency ? { style: "currency" as const, currency } : {};
  return {
    compact: compactNumber({ value, locale, currency }),
    integer: new Intl.NumberFormat(locale, { ...style, maximumFractionDigits: 0 }).format(value),
    precise: new Intl.NumberFormat(locale, {
      ...style,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value),
  };
}
