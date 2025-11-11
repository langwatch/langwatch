/**
 * Determines progress bar color based on usage percentage
 * 
 * @param usagePercentage - Current usage as a percentage of limit
 * @returns Hex color code for the progress bar
 */
export function getProgressBarColor(usagePercentage: number): string {
  if (usagePercentage >= 95) {
    return "#dc2626"; // red
  }
  if (usagePercentage >= 90) {
    return "#f59e0b"; // orange
  }
  if (usagePercentage >= 70) {
    return "#f59e0b"; // orange
  }
  return "#10b981"; // green
}

