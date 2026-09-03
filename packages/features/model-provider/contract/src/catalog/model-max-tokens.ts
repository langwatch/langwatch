/**
 * A requested `max_tokens` cut down to what the model will actually accept.
 *
 * `undefined` in means the caller did not ask for one, and an absent or
 * non-positive ceiling means the catalogue does not know a limit for this
 * model — in both cases the request passes through unchanged rather than being
 * clamped to a number nobody chose.
 */
export function clampMaxTokens(
  value: number | undefined,
  ceiling: number | undefined,
): number | undefined {
  if (value === undefined) return undefined;
  if (ceiling === undefined || ceiling <= 0) return value;
  return Math.min(value, ceiling);
}
