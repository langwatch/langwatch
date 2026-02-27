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
