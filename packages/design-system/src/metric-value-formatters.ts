export const formatScore = (score: number | null): string => {
  if (score === null) {
    return "-";
  }

  return score.toFixed(2);
};

export const formatCost = (cost: number | null): string => {
  if (cost === null) {
    return "-";
  }

  if (cost < 0.01) {
    return `$${cost.toFixed(6)}`;
  }

  if (cost < 1) {
    return `$${cost.toFixed(4)}`;
  }

  return `$${cost.toFixed(2)}`;
};

export const formatLatency = (latencyMs: number | null): string => {
  if (latencyMs === null) {
    return "-";
  }

  if (latencyMs < 1000) {
    return `${Math.round(latencyMs)}ms`;
  }

  return `${(latencyMs / 1000).toFixed(1)}s`;
};

export const formatPercentage = (value: number | null): string => {
  if (value === null) {
    return "-";
  }

  return `${(value * 100).toFixed(0)}%`;
};

export const formatDuration = (durationMs: number | null): string => {
  if (durationMs === null) {
    return "-";
  }

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
