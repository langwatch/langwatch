import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { TraceListItem } from "../../types/trace";

interface TraceStatistics {
  /**
   * 95th-percentile duration across the currently visible page. The
   * duration column bar scales to this rather than `max(...)` so a
   * single 30s outlier doesn't compress every normal row into a
   * thumbnail. Falls back to 1ms when there are no rows to avoid
   * divide-by-zero downstream.
   */
  p95DurationMs: number;
  /** True when stats are computed from real rows (vs the loading placeholder). */
  hasData: boolean;
}

const DEFAULT_STATS: TraceStatistics = {
  p95DurationMs: 1,
  hasData: false,
};

const TraceStatisticsContext = createContext<TraceStatistics>(DEFAULT_STATS);

/** Plain percentile (linear interpolation). */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo]!;
  const frac = rank - lo;
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}

interface TraceStatisticsProviderProps {
  traces: TraceListItem[];
  /**
   * Skip computing stats while the table is rendering loading
   * placeholders — they're synthetic rows with zero durations and
   * would drag the p95 to 0.
   */
  skip?: boolean;
  children: ReactNode;
}

export function TraceStatisticsProvider({
  traces,
  skip = false,
  children,
}: TraceStatisticsProviderProps) {
  const value = useMemo<TraceStatistics>(() => {
    if (skip || traces.length === 0) return DEFAULT_STATS;
    const durations = traces
      .map((t) => t.durationMs)
      .filter((d) => d > 0)
      .sort((a, b) => a - b);
    if (durations.length === 0) return DEFAULT_STATS;
    return {
      p95DurationMs: Math.max(1, percentile(durations, 95)),
      hasData: true,
    };
  }, [traces, skip]);
  return (
    <TraceStatisticsContext.Provider value={value}>
      {children}
    </TraceStatisticsContext.Provider>
  );
}

export function useTraceStatistics(): TraceStatistics {
  return useContext(TraceStatisticsContext);
}
