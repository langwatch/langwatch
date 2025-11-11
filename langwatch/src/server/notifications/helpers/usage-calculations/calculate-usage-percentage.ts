/**
 * Calculate usage percentage from current usage and limit
 */
export function calculateUsagePercentage({
  currentUsage,
  limit,
}: {
  currentUsage: number;
  limit: number;
}): number {
  if (limit <= 0) {
    return 0;
  }
  return (currentUsage / limit) * 100;
}

