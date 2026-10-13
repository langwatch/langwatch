/**
 * Parse a whole-number flag/arg into a positive safe integer, or null.
 * `Number`, never `parseInt`: `parseInt` stops at the first bad character, so
 * "1abc" silently becomes 1. `Number` reads the whole value or gives NaN.
 */
export const parsePositiveIntOrNull = (value: string): number | null => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};
