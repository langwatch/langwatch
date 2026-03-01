import { useState, useCallback, useRef } from "react";
import type { DashboardData } from "../../shared/types.ts";
import { useSSE, type ConnectionStatus } from "./useSSE.ts";

const INITIAL: DashboardData = {
  totalGroups: 0,
  blockedGroups: 0,
  totalPendingJobs: 0,
  throughputStagedPerSec: 0,
  totalCompleted: 0,
  totalFailed: 0,
  completedPerSec: 0,
  failedPerSec: 0,
  peakCompletedPerSec: 0,
  peakFailedPerSec: 0,
  peakStagedPerSec: 0,
  redisMemoryUsed: "-",
  redisMemoryPeak: "-",
  redisMemoryUsedBytes: 0,
  redisMemoryPeakBytes: 0,
  redisMemoryMaxBytes: 0,
  redisConnectedClients: 0,
  processCpuPercent: 0,
  processMemoryUsedMb: 0,
  processMemoryTotalMb: 0,
  throughputHistory: [],
  pipelineTree: [],
  queues: [],
  latencyP50Ms: 0,
  latencyP99Ms: 0,
  peakLatencyP50Ms: 0,
  peakLatencyP99Ms: 0,
  phases: {
    commands: { pending: 0, active: 0, completedPerSec: 0, failedPerSec: 0, latencyP50Ms: 0, latencyP99Ms: 0, peakCompletedPerSec: 0, peakFailedPerSec: 0, peakLatencyP50Ms: 0, peakLatencyP99Ms: 0 },
    projections: { pending: 0, active: 0, completedPerSec: 0, failedPerSec: 0, latencyP50Ms: 0, latencyP99Ms: 0, peakCompletedPerSec: 0, peakFailedPerSec: 0, peakLatencyP50Ms: 0, peakLatencyP99Ms: 0 },
    reactions: { pending: 0, active: 0, completedPerSec: 0, failedPerSec: 0, latencyP50Ms: 0, latencyP99Ms: 0, peakCompletedPerSec: 0, peakFailedPerSec: 0, peakLatencyP50Ms: 0, peakLatencyP99Ms: 0 },
  },
  jobNameMetrics: [],
};

export function useDashboardData(pausedRef: React.RefObject<boolean>): {
  data: DashboardData;
  status: ConnectionStatus;
  flush: () => void;
} {
  const [data, setData] = useState<DashboardData>(INITIAL);
  const bufferedEvent = useRef<DashboardData | null>(null);

  const flush = useCallback(() => {
    if (bufferedEvent.current) {
      setData(bufferedEvent.current);
      bufferedEvent.current = null;
    }
  }, []);

  const onEvent = useCallback((event: string, payload: unknown) => {
    if (event === "dashboard") {
      if (pausedRef.current) {
        // Buffer — only keep the latest
        bufferedEvent.current = payload as DashboardData;
      } else {
        bufferedEvent.current = null;
        setData(payload as DashboardData);
      }
    }
  }, [pausedRef]);

  const status = useSSE({ url: "/api/sse", onEvent });

  return { data, status, flush };
}
