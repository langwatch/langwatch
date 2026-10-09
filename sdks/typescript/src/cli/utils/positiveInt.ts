/**
 * Parse a whole-number flag or argument (a version, a limit) into a positive
 * safe integer. Returns null when the value is not one, so each caller owns its
 * own message and exit.
 *
 * `Number`, never `parseInt`: `parseInt` stops at the first character it cannot
 * read, so "1abc" and "1.5" both become 1 and the command acts on a number the
 * user never wrote. `Number` reads the whole value or gives NaN.
 */
export const parsePositiveIntOrNull = (value: string): number | null => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};
