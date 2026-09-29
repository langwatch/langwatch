/** The usage percentages a warning fires at, ascending, so the last one passed is the highest. */
export const USAGE_WARNING_THRESHOLDS = [50, 70, 90, 95, 100] as const;

/** The highest warning threshold this month's count has crossed, or nothing below them all. */
export function findCrossedUsageThreshold({
  currentMonthMessagesCount,
  maxMonthlyUsageLimit,
}: {
  currentMonthMessagesCount: number;
  maxMonthlyUsageLimit: number;
}): (typeof USAGE_WARNING_THRESHOLDS)[number] | undefined {
  const usagePercentage =
    maxMonthlyUsageLimit > 0 ? (currentMonthMessagesCount / maxMonthlyUsageLimit) * 100 : 0;
  let crossed: (typeof USAGE_WARNING_THRESHOLDS)[number] | undefined;
  for (const threshold of USAGE_WARNING_THRESHOLDS) {
    if (usagePercentage >= threshold) crossed = threshold;
  }
  return crossed;
}
