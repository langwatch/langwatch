export const formatMilliseconds = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  if (ms >= 1000 && ms < 10000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms >= 10000 && ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms >= 60000 && ms < 3600000) return `${Math.round(ms / 60000)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
};
