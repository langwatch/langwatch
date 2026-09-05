/**
 * The colour of a target in a comparison.
 * @see specs/features/agent-testing/comparison-mode.feature
 */

export const TARGET_COLORS = [
  "#3b82f6",
  "#f97316",
  "#10b981",
  "#ec4899",
  "#8b5cf6",
  "#ef4444",
  "#0891b2",
  "#ca8a04",
] as const;

/** The colour of the target at this position; the palette wraps after eight. */
export function targetColor(index: number): string {
  return TARGET_COLORS[index % TARGET_COLORS.length] ?? TARGET_COLORS[0];
}
