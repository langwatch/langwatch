const RELATIVE_UNITS: Record<string, number> = {
  h: 3600000,
  d: 86400000,
  w: 604800000,
  m: 2592000000,
};

/**
 * Parses a date string that can be either a relative duration (e.g. "24h", "7d")
 * or an ISO date string. Throws on invalid input rather than silently falling back.
 *
 * @returns epoch milliseconds
 * @throws Error if the input is not a valid relative duration or parseable date string
 */
export function parseRelativeDate(input: string): number {
  if (input === "now") return Date.now();

  const match = input.match(/^(\d+)(h|d|w|m)$/);
  if (match) {
    const [, amount, unit] = match;
    return Date.now() - parseInt(amount!) * (RELATIVE_UNITS[unit!] ?? 86400000);
  }

  const parsed = Date.parse(input);
  if (Number.isNaN(parsed)) {
    throw new Error(
      `Invalid date: "${input}". Use a relative duration (e.g. "24h", "7d", "4w") or an ISO date string.`
    );
  }
  return parsed;
}
