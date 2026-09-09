/**
 * A duration, at the precision the reader can act on.
 *
 * `platform/app`'s `formatMilliseconds`, taken rather than imported for the
 * usual reason — a feature-web package may not reach into the application, and
 * the application's copy is gone. `@langwatch/analytics-web` and
 * `@langwatch/trace-web` each keep the same ladder for the same reason.
 */
export const formatMilliseconds = (ms: number): string => {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms >= 1000 && ms < 10000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms >= 10000 && ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms >= 60000 && ms < 3600000) return `${(ms / 60000).toFixed(1)}min`;
  return `${(ms / 3600000).toFixed(1)}h`;
};
