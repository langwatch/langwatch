import { formatBytes } from "~/components/ops/shared/formatters";
import type { DashboardData } from "~/server/app-layer/ops/types";
import { LinkedStat } from "./LinkedStat";

// CloudWatch defaults for ElastiCache: 80% memory, 70% engine CPU. The goal is
// to surface Redis saturation before an operator has to open the AWS console.
const MEMORY_WARN_PERCENT = 80;
const CPU_WARN_PERCENT = 70;

export function RedisStatTiles({
  data,
}: {
  data: Pick<
    DashboardData,
    | "redisMemoryUsedBytes"
    | "redisMemoryPeakBytes"
    | "redisMemoryMaxBytes"
    | "redisConnectedClients"
    | "redisEngineCpuPercent"
  >;
}) {
  // Compute the raw ratio for threshold checks, round only for display, so
  // 79.95% does not round up to 80.0 and falsely trigger the warning.
  const memoryPercentRaw =
    data.redisMemoryMaxBytes > 0
      ? (data.redisMemoryUsedBytes / data.redisMemoryMaxBytes) * 100
      : null;
  const memoryPercent =
    memoryPercentRaw === null
      ? null
      : Math.round(memoryPercentRaw * 10) / 10;

  const memoryWarning =
    memoryPercentRaw !== null && memoryPercentRaw >= MEMORY_WARN_PERCENT;
  const cpuWarning =
    data.redisEngineCpuPercent !== null &&
    data.redisEngineCpuPercent >= CPU_WARN_PERCENT;

  const memorySublabel =
    memoryPercent !== null
      ? `${memoryPercent}% of ${formatBytes(data.redisMemoryMaxBytes)}`
      : data.redisMemoryPeakBytes > 0
        ? `peak ${formatBytes(data.redisMemoryPeakBytes)}`
        : undefined;

  return (
    <>
      <LinkedStat
        label="Redis mem"
        value={formatBytes(data.redisMemoryUsedBytes)}
        sublabel={memorySublabel}
        color={memoryWarning ? "red.500" : undefined}
        testId="redis-memory-stat"
        warning={memoryWarning}
      />
      <LinkedStat
        label="Redis CPU"
        value={
          data.redisEngineCpuPercent === null
            ? "-"
            : `${data.redisEngineCpuPercent}%`
        }
        sublabel={
          data.redisEngineCpuPercent === null ? "sampling…" : "main-thread"
        }
        color={cpuWarning ? "red.500" : undefined}
        testId="redis-engine-cpu-stat"
        warning={cpuWarning}
      />
      <LinkedStat
        label="Redis conns"
        value={data.redisConnectedClients.toString()}
        sublabel="clients"
        testId="redis-clients-stat"
      />
    </>
  );
}
