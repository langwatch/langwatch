/**
 * Shared formatters for displaying evaluation metrics
 *
 * Used by:
 * - Evaluations V3 workbench
 * - Batch evaluation results page
 */

/**
 * Formats a score for display with 2 decimal places.
 */
export const formatScore = (score: number | null): string => {
  if (score === null) return "-";
  return score.toFixed(2);
};

/**
 * Formats a cost in USD for display.
 * Uses more decimal places for smaller amounts for precision.
 */
export const formatCost = (cost: number | null): string => {
  if (cost === null) return "-";
  if (cost < 0.01) {
    return `$${cost.toFixed(6)}`;
  }
  if (cost < 1) {
    return `$${cost.toFixed(4)}`;
  }
  return `$${cost.toFixed(2)}`;
};

/**
 * Formats latency (duration) in milliseconds for display.
 * Uses "ms" for sub-second, "s" for seconds.
 */
export const formatLatency = (latencyMs: number | null): string => {
  if (latencyMs === null) return "-";
  if (latencyMs < 1000) {
    return `${Math.round(latencyMs)}ms`;
  }
  return `${(latencyMs / 1000).toFixed(1)}s`;
};

/**
 * Formats a percentage (0-1 scale) for display.
 */
export const formatPercentage = (value: number | null): string => {
  if (value === null) return "-";
  return `${(value * 100).toFixed(0)}%`;
};

/**
 * Formats a duration in milliseconds with full precision for detailed views.
 */
export const formatDuration = (durationMs: number | null): string => {
  if (durationMs === null) return "-";
  if (durationMs < 1000) {
    return `${Math.round(durationMs)}ms`;
  }
  if (durationMs < 60000) {
    return `${(durationMs / 1000).toFixed(1)}s`;
  }
  const minutes = Math.floor(durationMs / 60000);
  const seconds = Math.floor((durationMs % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
};
