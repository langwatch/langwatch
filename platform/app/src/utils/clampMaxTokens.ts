export function clampMaxTokens(
  value: number | undefined,
  ceiling: number | undefined,
): number | undefined {
  if (value === undefined) return undefined;
  if (ceiling === undefined || ceiling <= 0) return value;
  return Math.min(value, ceiling);
}
