/**
 * A requested `max_tokens` cut down to what the model will actually accept.
 * `undefined` or a non-positive/unknown ceiling passes through unchanged,
 * rather than being clamped to a number nobody chose.
 */
export function clampMaxTokens(
  value: number | undefined,
  ceiling: number | undefined,
): number | undefined {
  if (value === undefined) return undefined;
  if (ceiling === undefined || ceiling <= 0) return value;
  return Math.min(value, ceiling);
}
